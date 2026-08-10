const mockGenerateStructured = jest.fn();

jest.mock('../../src/utils/structured-llm', () => ({
  generateStructured: mockGenerateStructured,
}));
jest.mock('../../src/utils/llm-provider', () => ({
  getLLMModel: jest.fn(() => 'test-model'),
}));
jest.mock('../../src/services/settings', () => ({
  getSettings: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../src/services/material', () => ({
  getMaterialBySourceId: jest.fn(),
  setMaterialOutline: jest.fn(),
  clearMaterialOutline: jest.fn(),
}));

const materialService = require('../../src/services/material');
const {
  getOutline,
  generateOutline,
  promptHashFor,
  EmptyMaterialError,
} = require('../../src/services/material-outline');
const { MATERIAL_OUTLINE_PROMPT } = require('../../src/constants/app-constants');

const OUTLINE = { topics: [{ title: 'Topic A', keyPoints: ['Point one'] }], notes: '' };

const storedMaterial = (overrides = {}) => ({
  sourceId: 'src-1',
  courseId: 'course-1',
  documentTitle: 'Lecture 3',
  fileContent: 'Some teachable course content about respiration.',
  outline: OUTLINE,
  outlineSource: 'generated',
  outlineGeneratedAt: new Date('2026-08-01'),
  outlineModel: 'test-model',
  outlinePromptHash: promptHashFor(MATERIAL_OUTLINE_PROMPT),
  ...overrides,
});

beforeEach(() => {
  mockGenerateStructured.mockReset();
  mockGenerateStructured.mockResolvedValue({
    content: JSON.stringify(OUTLINE),
    usage: {},
  });
  // Jest's clearMocks resets call records but not implementations, so a test
  // that overrides getSettings would otherwise leak its custom prompt into
  // every test that runs after it.
  require('../../src/services/settings').getSettings.mockResolvedValue(null);
});

describe('getOutline', () => {
  it('never invokes the LLM', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(storedMaterial());

    await getOutline('src-1');

    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it('returns null when the material has no outline', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: undefined })
    );

    await expect(getOutline('src-1')).resolves.toBeNull();
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it('returns null when the material does not exist', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(null);
    await expect(getOutline('nope')).resolves.toBeNull();
  });

  it('returns the stored outline with provenance', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(storedMaterial());

    const result = await getOutline('src-1');

    expect(result.outline).toEqual(OUTLINE);
    expect(result.source).toBe('generated');
    expect(result.stale).toBe(false);
  });

  it('reports a malformed stored outline as absent', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: { topics: [] } })
    );

    await expect(getOutline('src-1')).resolves.toBeNull();
  });

  it('marks stale on a model mismatch', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outlineModel: 'some-older-model' })
    );

    await expect(getOutline('src-1')).resolves.toMatchObject({ stale: true });
  });

  it('marks stale on a prompt-hash mismatch', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outlinePromptHash: 'deadbeefdeadbeef' })
    );

    await expect(getOutline('src-1')).resolves.toMatchObject({ stale: true });
  });

  // An edited outline no longer reflects the prompt or model that produced it,
  // so comparing against them is meaningless — and nagging the instructor to
  // regenerate would invite discarding their own work.
  it('never marks an edited outline stale', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({
        outlineSource: 'edited',
        outlineModel: 'some-older-model',
        outlinePromptHash: 'deadbeefdeadbeef',
      })
    );

    await expect(getOutline('src-1')).resolves.toMatchObject({
      source: 'edited',
      stale: false,
    });
  });
});

describe('generateOutline', () => {
  it('summarizes a small material in one call and stores provenance', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: undefined })
    );

    const result = await generateOutline('src-1');

    expect(mockGenerateStructured).toHaveBeenCalledTimes(1);
    expect(mockGenerateStructured.mock.calls[0][0].prompt).toContain(
      'Some teachable course content about respiration.'
    );
    expect(result.outline).toEqual(OUTLINE);
    expect(result.source).toBe('generated');

    const [sourceId, fields] = materialService.setMaterialOutline.mock.calls[0];
    expect(sourceId).toBe('src-1');
    expect(fields.outline).toEqual(OUTLINE);
    expect(fields.outlineSource).toBe('generated');
    expect(fields.outlineModel).toBe('test-model');
    expect(fields.outlinePromptHash).toBe(promptHashFor(MATERIAL_OUTLINE_PROMPT));
    expect(fields.outlineGeneratedAt).toBeInstanceOf(Date);
    expect(fields.outlineEditedAt).toBeNull();
  });

  it('overwrites an edited outline and resets provenance to generated', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outlineSource: 'edited', outlineEditedAt: new Date('2026-08-05') })
    );

    const result = await generateOutline('src-1');

    expect(result.source).toBe('generated');
    expect(materialService.setMaterialOutline.mock.calls[0][1].outlineSource).toBe('generated');
    expect(materialService.setMaterialOutline.mock.calls[0][1].outlineEditedAt).toBeNull();
  });

  it('rejects a material with no extractable text', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ fileContent: '   ' })
    );

    await expect(generateOutline('src-1')).rejects.toMatchObject({
      code: 'EMPTY_MATERIAL',
    });
    expect(mockGenerateStructured).not.toHaveBeenCalled();
    expect(materialService.setMaterialOutline).not.toHaveBeenCalled();
  });

  it('rejects a missing material', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(null);

    await expect(generateOutline('nope')).rejects.toMatchObject({
      code: 'EMPTY_MATERIAL',
    });
  });

  it('propagates model output that fails validation instead of storing it', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: undefined })
    );
    mockGenerateStructured.mockResolvedValue({
      content: JSON.stringify({ topics: [], notes: '' }),
      usage: {},
    });

    await expect(generateOutline('src-1')).rejects.toThrow();
    expect(materialService.setMaterialOutline).not.toHaveBeenCalled();
  });

  it('prefers a course-specific prompt from settings', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: undefined })
    );
    require('../../src/services/settings').getSettings.mockResolvedValue({
      prompts: { materialOutline: 'CUSTOM {materialContent}' },
    });

    const result = await generateOutline('src-1');

    expect(mockGenerateStructured.mock.calls[0][0].prompt).toContain('CUSTOM ');
    expect(materialService.setMaterialOutline.mock.calls[0][1].outlinePromptHash).toBe(
      promptHashFor('CUSTOM {materialContent}')
    );
    expect(result.stale).toBe(false);
  });
});
