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
  findMaterialsOutsideCourse: jest.fn().mockResolvedValue([]),
}));
// No saved objectives unless a test says otherwise.
jest.mock('../../src/services/objective', () => ({
  getObjectiveWithMaterials: jest.fn(),
  getDetailedObjectives: jest.fn().mockResolvedValue([]),
}));

const { generateLearningObjectivesHandler } = require('../../src/controllers/rag-llm');
const outlineService = require('../../src/services/material-outline');
const materialService = require('../../src/services/material');
const objectiveService = require('../../src/services/objective');

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

// Objective generation never suggests multiple answer (instructors add it
// themselves), even from a model that ignores the schema's enum.
describe('objective generation suggested question types', () => {
  beforeEach(() => {
    mockGenerateStructured.mockReset();
    mockGetRagContentFromMaterials.mockReset();
    mockGetRagContentFromMaterials.mockResolvedValue('### MATERIAL: Notes (SOURCE ID: material-a)\nMass and energy.');
  });

  it('drops a multiple-answer suggestion and falls back to the level default', async () => {
    mockGenerateStructured.mockResolvedValue({
      content: JSON.stringify({
        materialIsRelevant: true,
        objectives: [
          {
            name: 'Explain mass–energy equivalence',
            granularObjectives: [
              {
                text: 'State the relation',
                bloomTaxonomies: ['Understand', 'Apply'],
                questionTypes: [
                  { bloomLevel: 'Understand', questionType: 'multiple-answer', count: 2 },
                  { bloomLevel: 'Apply', questionType: 'calculation', count: 1 },
                ],
              },
            ],
          },
        ],
      }),
      usage: {},
    });
    const res = buildResponse();

    await generateLearningObjectivesHandler(buildRequest(), res);

    const [granular] = res.json.mock.calls[0][0].objectives[0].granularObjectives;
    expect(granular.questionTypes).toEqual([
      { bloomLevel: 'Apply', questionType: 'calculation', count: 1 },
      { bloomLevel: 'Understand', questionType: 'multiple-choice', count: 1 },
    ]);
  });
});

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

  // The prompt used to hard-code "3-8 main objectives" and "2-5 granular
  // objectives", calibrated for 200 shuffled chunks where the model had no way
  // to know how many distinct topics existed. Outlines enumerate topics
  // directly, so a fixed range no longer belongs in the prompt.
  it('imposes no fixed objective count', async () => {
    outlineService.getOutline.mockImplementation(async (sourceId) =>
      outlineFor(`Topic ${sourceId}`)
    );

    await generateLearningObjectivesHandler(buildRequest(), buildResponse());

    const prompt = promptFromFirstCall();
    expect(prompt).not.toContain('3-8');
    expect(prompt).not.toContain('2-5');
  });

  it('instructs merging topics that appear in more than one material', async () => {
    outlineService.getOutline.mockImplementation(async (sourceId) =>
      outlineFor(`Topic ${sourceId}`)
    );

    await generateLearningObjectivesHandler(buildRequest(), buildResponse());

    const prompt = promptFromFirstCall();
    expect(prompt).toContain(
      'produce ONE meta learning objective for that topic rather than a near-duplicate objective per material'
    );
  });

  it('requires every outline topic to be covered', async () => {
    outlineService.getOutline.mockImplementation(async (sourceId) =>
      outlineFor(`Topic ${sourceId}`)
    );

    await generateLearningObjectivesHandler(buildRequest(), buildResponse());

    const prompt = promptFromFirstCall();
    expect(prompt).toContain(
      'Every topic in every provided outline must be covered by at least one meta learning objective'
    );
  });
});

// Generating again from materials that already have objectives used to save a
// fresh, slightly reworded copy every time. The model is now shown the saved
// objectives for the selected materials and told to add only what they don't
// cover; exact repeats it returns anyway are dropped, and a run with nothing
// new is answered as "already covered" rather than saved.
describe('objective generation with existing objectives', () => {
  const saved = (name, granulars, materialSourceIds) => ({
    _id: `obj-${name}`,
    name,
    granularObjectives: granulars.map((text) => ({ name: text })),
    materialSourceIds,
  });

  const respondWith = (objectives) =>
    mockGenerateStructured.mockResolvedValue({
      content: JSON.stringify({ materialIsRelevant: true, objectives }),
      usage: {},
    });

  beforeEach(() => {
    mockGenerateStructured.mockReset();
    mockGetRagContentFromMaterials.mockReset();
    mockGetRagContentFromMaterials.mockResolvedValue('### MATERIAL: Notes (SOURCE ID: material-a)\nMass and energy.');
    outlineService.getOutline.mockResolvedValue(null);
    objectiveService.getDetailedObjectives.mockResolvedValue([
      saved('Explain mass-energy equivalence', ['State the relation'], ['material-a']),
      saved('Describe orbital motion', ['Define an orbit'], ['material-z']),
    ]);
  });

  afterEach(() => objectiveService.getDetailedObjectives.mockResolvedValue([]));

  it('shows the model the objectives already saved for the selected materials, and only those', async () => {
    respondWith(validObjectives.objectives);

    await generateLearningObjectivesHandler(buildRequest(), buildResponse());

    const prompt = promptFromFirstCall();
    expect(prompt).toContain('EXISTING LEARNING OBJECTIVES');
    expect(prompt).toContain('1. Explain mass-energy equivalence');
    expect(prompt).toContain('   - State the relation');
    expect(prompt).toContain('Do not repeat or reword any of them');
    // Linked to a material that was not selected.
    expect(prompt).not.toContain('Describe orbital motion');
  });

  it('adds no existing-objectives block when the materials have none', async () => {
    objectiveService.getDetailedObjectives.mockResolvedValue([]);
    respondWith(validObjectives.objectives);

    await generateLearningObjectivesHandler(buildRequest(), buildResponse());

    expect(promptFromFirstCall()).not.toContain('EXISTING LEARNING OBJECTIVES');
  });

  it('drops exact repeats of saved objectives and keeps the new ones', async () => {
    respondWith([
      { name: 'Explain Mass–Energy Equivalence!', granularObjectives: [{ text: 'Anything', bloomTaxonomies: ['Understand'] }] },
      {
        name: 'Apply conservation of momentum',
        granularObjectives: [
          { text: 'state the relation.', bloomTaxonomies: ['Remember'] },
          { text: 'Solve a collision problem', bloomTaxonomies: ['Apply'] },
        ],
      },
    ]);
    const res = buildResponse();

    await generateLearningObjectivesHandler(buildRequest(), res);

    const { objectives } = res.json.mock.calls[0][0];
    // The repeated name keeps its new granular objective, under the saved objective.
    expect(objectives.map((o) => [o.name, o.existingObjectiveId])).toEqual([
      ['Explain mass-energy equivalence', 'obj-Explain mass-energy equivalence'],
      ['Apply conservation of momentum', undefined],
    ]);
    expect(objectives.map((o) => o.granularObjectives.map((g) => g.text))).toEqual([
      ['Anything'],
      ['Solve a collision problem'],
    ]);
  });

  it('answers "already covered" when nothing new is left, and saves nothing', async () => {
    respondWith([
      { name: 'Explain mass-energy equivalence', granularObjectives: [{ text: 'State the relation', bloomTaxonomies: ['Understand'] }] },
    ]);
    const res = buildResponse();

    await generateLearningObjectivesHandler(buildRequest(), res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, code: 'ALREADY_COVERED' }));
  });

  it('answers "already covered" when the model returns no objectives at all', async () => {
    respondWith([]);
    const res = buildResponse();

    await generateLearningObjectivesHandler(buildRequest(), res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ALREADY_COVERED' }));
  });
});

// Every objective from a run used to be linked to every selected material,
// even one drawn from a single file, so a material looked covered by
// objectives that never came from it. The model now names the materials each
// objective draws on, and only those are linked.
describe('objective generation material attribution', () => {
  const granular = { text: 'State the relation', bloomTaxonomies: ['Understand'] };
  const respondWith = (objectives) =>
    mockGenerateStructured.mockResolvedValue({
      content: JSON.stringify({ materialIsRelevant: true, objectives }),
      usage: {},
    });
  const run = async (overrides) => {
    const res = buildResponse();
    await generateLearningObjectivesHandler(buildRequest(overrides), res);
    return res.json.mock.calls[0][0];
  };

  beforeEach(() => {
    mockGenerateStructured.mockReset();
    mockGetRagContentFromMaterials.mockReset();
    mockGetRagContentFromMaterials.mockResolvedValue(
      '### MATERIAL: A (SOURCE ID: material-a)\nMass.\n\n---\n\n### MATERIAL: B (SOURCE ID: material-b)\nEnergy.'
    );
    outlineService.getOutline.mockResolvedValue(null);
  });

  it('asks the model which selected materials each objective draws on', async () => {
    respondWith([{ name: 'Explain mass', granularObjectives: [granular], sourceMaterialIds: ['material-a'] }]);

    await run();

    const { prompt, schema } = mockGenerateStructured.mock.calls[0][0];
    expect(prompt).toContain('sourceMaterialIds');
    expect(prompt).toContain('material-a, material-b');
    const item = schema.properties.objectives.items;
    expect(item.required).toContain('sourceMaterialIds');
    expect(item.properties.sourceMaterialIds.items.enum).toEqual(['material-a', 'material-b']);
  });

  it('links an objective from one material to that material only', async () => {
    respondWith([{ name: 'Explain mass', granularObjectives: [granular], sourceMaterialIds: ['material-a'] }]);

    const body = await run();

    expect(body.objectives[0].sourceMaterialIds).toEqual(['material-a']);
  });

  it('links an objective covered in several materials to each of them', async () => {
    respondWith([
      { name: 'Relate mass and energy', granularObjectives: [granular], sourceMaterialIds: ['material-b', 'material-a', 'material-b'] },
    ]);

    const body = await run();

    expect(body.objectives[0].sourceMaterialIds).toEqual(['material-a', 'material-b']);
  });

  it('ignores ids that were not selected', async () => {
    respondWith([
      { name: 'Explain mass', granularObjectives: [granular], sourceMaterialIds: ['material-a', 'material-x'] },
    ]);

    const body = await run();

    expect(body.objectives[0].sourceMaterialIds).toEqual(['material-a']);
  });

  // An objective is never left linked to nothing: with no usable answer it is
  // linked to every selected material, as before.
  it.each([
    ['missing', undefined],
    ['empty', []],
    ['all unselected', ['material-x']],
  ])('falls back to every selected material when the ids are %s', async (_label, ids) => {
    respondWith([{ name: 'Explain mass', granularObjectives: [granular], sourceMaterialIds: ids }]);

    const body = await run();

    expect(body.objectives[0].sourceMaterialIds).toEqual(['material-a', 'material-b']);
  });
});

// Outlines are read by sourceId alone, so a material from another course used
// to reach the prompt. Every selected material must be in the course.
describe('objective generation from another course\'s material', () => {
  beforeEach(() => {
    mockGenerateStructured.mockReset();
    mockGetRagContentFromMaterials.mockReset();
  });
  afterEach(() => materialService.findMaterialsOutsideCourse.mockResolvedValue([]));

  it('refuses before reading any material or calling the model', async () => {
    materialService.findMaterialsOutsideCourse.mockResolvedValue(['material-b']);
    outlineService.getOutline.mockClear();
    const res = buildResponse();

    await generateLearningObjectivesHandler(buildRequest(), res);

    expect(materialService.findMaterialsOutsideCourse).toHaveBeenCalledWith(['material-a', 'material-b'], 'course-1');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'MATERIAL_NOT_FOUND' }));
    expect(outlineService.getOutline).not.toHaveBeenCalled();
    expect(mockGetRagContentFromMaterials).not.toHaveBeenCalled();
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });
});
