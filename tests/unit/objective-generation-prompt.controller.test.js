const mockGenerateStructured = jest.fn();
const mockGetRagContentFromMaterials = jest.fn();

jest.mock('../../src/services/rag', () => ({
  getRagContentFromMaterials: mockGetRagContentFromMaterials,
  getOrCreateInstance: jest.fn().mockResolvedValue({ retrieveContext: jest.fn() }),
}));
jest.mock('../../src/services/llm', () => ({ isReady: jest.fn(() => true) }));
jest.mock('../../src/services/settings', () => ({
  getSettings: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/utils/co-instructor-permissions', () => ({
  assertCoInstructorPermission: jest.fn().mockResolvedValue(true),
  PERMISSION_KEYS: { QUESTION_GENERATION: 'questionGeneration' },
}));
jest.mock('../../src/utils/ta-permissions', () => ({
  assertTaPermission: jest.fn().mockResolvedValue(true),
  TA_PERMISSION_KEYS: { QUESTION_GENERATION: 'questionGeneration' },
}));
jest.mock('../../src/utils/llm-provider', () => ({
  getLLMModel: jest.fn(() => 'test-model'),
  getReviewModel: jest.fn(() => 'test-review-model'),
  getLLMProvider: jest.fn(() => 'openai'),
}));
jest.mock('../../src/utils/structured-llm', () => ({
  generateStructured: mockGenerateStructured,
}));
jest.mock('../../src/services/material-outline', () => ({
  getOutline: jest.fn(),
  generateOutline: jest.fn(),
}));
jest.mock('../../src/services/material', () => ({
  getMaterialBySourceId: jest.fn(),
  getMaterialCourseId: jest.fn(),
}));

const { generateLearningObjectivesHandler } = require('../../src/controllers/rag-llm');
const outlineService = require('../../src/services/material-outline');
const materialService = require('../../src/services/material');

const validObjectives = {
  materialIsRelevant: true,
  objectives: [
    {
      name: 'Explain mass–energy equivalence',
      granularObjectives: [{ text: 'State the relation', bloomTaxonomies: ['Understand'] }],
    },
  ],
};

const buildRequest = (overrides = {}) => ({
  user: { id: 'user-1' },
  body: {
    courseId: 'course-1',
    courseName: 'Physics',
    materialIds: ['material-a', 'material-b'],
    ...overrides,
  },
});

const buildResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

const promptFromFirstCall = () => mockGenerateStructured.mock.calls[0][0].prompt;

describe('objective-generation prompt assembly', () => {
  beforeEach(() => {
    mockGenerateStructured.mockReset();
    mockGetRagContentFromMaterials.mockReset();
    mockGenerateStructured.mockResolvedValue({
      content: JSON.stringify(validObjectives),
      usage: {},
    });
  });

  // The context used to be cut at 100k chars. Because material blocks are laid
  // out sequentially, that silently deleted whichever materials sorted last —
  // undoing the per-material retrieval guarantee at the prompt boundary.
  // RAG_OBJECTIVE_CHUNK_LIMIT is now the only bound.
  it('sends the whole retrieved context, however large', async () => {
    const firstMaterial = `### MATERIAL: Deck (SOURCE ID: material-a)\n${'a'.repeat(120000)}`;
    const lastMaterial = `### MATERIAL: Chapter (SOURCE ID: material-b)\n${'b'.repeat(120000)}`;
    mockGetRagContentFromMaterials.mockResolvedValue(
      `${firstMaterial}\n\n---\n\n${lastMaterial}`
    );

    await generateLearningObjectivesHandler(buildRequest(), buildResponse());

    const prompt = promptFromFirstCall();
    expect(prompt).not.toContain('[... content truncated ...]');
    // The trailing material must survive — it is the one the old cut removed.
    expect(prompt).toContain('### MATERIAL: Chapter (SOURCE ID: material-b)');
    expect(prompt).toContain('b'.repeat(120000));
  });

  // String.replace() interprets `$$`, `$&` and `` $` `` inside a replacement
  // string, so LaTeX in course material arrived at the model mangled.
  it('interpolates LaTeX in the material context verbatim', async () => {
    const latex = 'Display math: $$E = mc^2$$ plus $&, $` and $\' literals.';
    mockGetRagContentFromMaterials.mockResolvedValue(latex);

    await generateLearningObjectivesHandler(buildRequest(), buildResponse());

    expect(promptFromFirstCall()).toContain(latex);
  });

  it('interpolates LaTeX in instructor-supplied objectives verbatim', async () => {
    mockGetRagContentFromMaterials.mockResolvedValue('Some material content.');
    const userObjective = 'Derive $$F = ma$$ from first principles';

    await generateLearningObjectivesHandler(
      buildRequest({ userObjectives: [userObjective] }),
      buildResponse()
    );

    expect(promptFromFirstCall()).toContain(userObjective);
  });

  it('still rejects when no material content was retrieved', async () => {
    mockGetRagContentFromMaterials.mockResolvedValue('');
    const res = buildResponse();

    await generateLearningObjectivesHandler(buildRequest(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });
});

describe('objective generation from outlines', () => {
  const outlineFor = (title) => ({
    outline: { topics: [{ title, keyPoints: [`${title} point`] }], notes: '' },
    source: 'generated',
    generatedAt: new Date(),
    editedAt: null,
    stale: false,
  });

  beforeEach(() => {
    mockGenerateStructured.mockReset();
    mockGetRagContentFromMaterials.mockReset();
    mockGenerateStructured.mockResolvedValue({
      content: JSON.stringify(validObjectives),
      usage: {},
    });
    materialService.getMaterialBySourceId.mockImplementation(async (sourceId) => ({
      sourceId,
      documentTitle: `Title ${sourceId}`,
    }));
  });

  it('builds the prompt from outlines and makes no RAG call', async () => {
    outlineService.getOutline.mockImplementation(async (sourceId) =>
      outlineFor(`Topic ${sourceId}`)
    );

    await generateLearningObjectivesHandler(buildRequest(), buildResponse());

    expect(mockGetRagContentFromMaterials).not.toHaveBeenCalled();
    const prompt = promptFromFirstCall();
    expect(prompt).toContain('### MATERIAL: Title material-a (SOURCE ID: material-a)');
    expect(prompt).toContain('### MATERIAL: Title material-b (SOURCE ID: material-b)');
    expect(prompt).toContain('## Topic material-a');
    expect(prompt).toContain('\n\n---\n\n');
  });

  // Generating here is what would make every instructor's first objective
  // generation on every pre-existing material the slow one.
  it('never generates an outline', async () => {
    outlineService.getOutline.mockResolvedValue(null);
    mockGetRagContentFromMaterials.mockResolvedValue('Retrieved chunk text.');

    await generateLearningObjectivesHandler(buildRequest(), buildResponse());

    expect(outlineService.generateOutline).not.toHaveBeenCalled();
  });

  it('falls back to retrieval when any outline is missing', async () => {
    outlineService.getOutline.mockImplementation(async (sourceId) =>
      sourceId === 'material-a' ? outlineFor('Topic A') : null
    );
    mockGetRagContentFromMaterials.mockResolvedValue('Retrieved chunk text.');

    await generateLearningObjectivesHandler(buildRequest(), buildResponse());

    expect(mockGetRagContentFromMaterials).toHaveBeenCalledTimes(1);
    expect(promptFromFirstCall()).toContain('Retrieved chunk text.');
  });

  it('falls back to retrieval when reading an outline throws', async () => {
    outlineService.getOutline.mockRejectedValue(new Error('mongo down'));
    mockGetRagContentFromMaterials.mockResolvedValue('Retrieved chunk text.');

    await generateLearningObjectivesHandler(buildRequest(), buildResponse());

    expect(promptFromFirstCall()).toContain('Retrieved chunk text.');
  });
});
