const mockGenerateStructured = jest.fn();

jest.mock('../../src/utils/structured-llm', () => ({
  generateStructured: mockGenerateStructured,
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
  saveOutline,
  EmptyMaterialError,
  NoOutlineError,
  InvalidOutlineError,
} = require('../../src/services/material-outline');
const { OUTLINE_MAX_CONTENT_CHARS } = require('../../src/constants/app-constants');

const OUTLINE = { topics: [{ title: 'Topic A', keyPoints: ['Point one'] }], notes: '' };

const storedMaterial = (overrides = {}) => ({
  sourceId: 'src-1',
  courseId: 'course-1',
  documentTitle: 'Lecture 3',
  fileContent: 'Some teachable course content about respiration.',
  outline: OUTLINE,
  outlineSource: 'generated',
  outlineEditedAt: null,
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
  });

  it('reports a malformed stored outline as absent', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: { topics: [] } })
    );

    await expect(getOutline('src-1')).resolves.toBeNull();
  });

  it('never reads settings', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(storedMaterial());

    await getOutline('src-1');

    expect(require('../../src/services/settings').getSettings).not.toHaveBeenCalled();
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
    expect(fields.outlineEditedAt).toBeNull();
  });

  // Structural guard: these fields were removed along with the staleness
  // mechanism they existed to power, and must not creep back in.
  it('never writes outlineModel, outlinePromptHash, or outlineGeneratedAt', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: undefined })
    );

    await generateOutline('src-1');

    const fields = materialService.setMaterialOutline.mock.calls[0][1];
    expect(fields).not.toHaveProperty('outlineModel');
    expect(fields).not.toHaveProperty('outlinePromptHash');
    expect(fields).not.toHaveProperty('outlineGeneratedAt');
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

  it('summarizes the full text for content between the batch and direct limits', async () => {
    // 90000 chars: over OUTLINE_BATCH_CHARS (80000), under
    // OUTLINE_DIRECT_MAX_CHARS (100000). Batching would drop the last 10000.
    const content = 'z'.repeat(90000);
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ fileContent: content, outline: undefined })
    );

    await generateOutline('src-1');

    expect(mockGenerateStructured).toHaveBeenCalledTimes(1);
    const prompt = mockGenerateStructured.mock.calls[0][0].prompt;
    expect(prompt).toContain(content);

    const stored = materialService.setMaterialOutline.mock.calls[0][1].outline;
    expect(stored.notes).not.toContain('were not summarized');
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

  it('trims model output with too many topics and records it in notes', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: undefined })
    );
    const topics = Array.from({ length: 45 }, (_, i) => ({
      title: `Topic ${i}`,
      keyPoints: ['A point'],
    }));
    mockGenerateStructured.mockResolvedValue({
      content: JSON.stringify({ topics, notes: '' }),
      usage: {},
    });

    const result = await generateOutline('src-1');

    expect(result.outline.topics).toHaveLength(40);
    expect(result.outline.notes).toContain('5 topics');
    expect(result.outline.notes).toContain('trimmed');
  });

  it('trims a topic with too many key points and records it in notes', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: undefined })
    );
    const keyPoints = Array.from({ length: 25 }, (_, i) => `Point ${i}`);
    mockGenerateStructured.mockResolvedValue({
      content: JSON.stringify({ topics: [{ title: 'Topic A', keyPoints }], notes: '' }),
      usage: {},
    });

    const result = await generateOutline('src-1');

    expect(result.outline.topics[0].keyPoints).toHaveLength(20);
    expect(result.outline.notes).toContain('5 key points');
  });

  it('drops trailing topics when output exceeds the character cap', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: undefined })
    );
    // 5 topics x ~6000 chars each is well within the topic/key-point caps but
    // far over the 20000-char total cap, so whole topics must be dropped.
    const topics = Array.from({ length: 5 }, (_, i) => ({
      title: `Topic ${i}`,
      keyPoints: ['x'.repeat(6000)],
    }));
    mockGenerateStructured.mockResolvedValue({
      content: JSON.stringify({ topics, notes: '' }),
      usage: {},
    });

    const result = await generateOutline('src-1');

    expect(result.outline.topics.length).toBeGreaterThan(0);
    expect(result.outline.topics.length).toBeLessThan(5);
    expect(JSON.stringify(result.outline).length).toBeLessThanOrEqual(20000);
    expect(result.outline.notes).toContain('trimmed');
    expect(result.outline.notes).toContain('topic');
  });

  it('leaves output within all caps untouched with no cap note', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: undefined })
    );
    mockGenerateStructured.mockResolvedValue({
      content: JSON.stringify(OUTLINE),
      usage: {},
    });

    const result = await generateOutline('src-1');

    expect(result.outline).toEqual(OUTLINE);
    expect(result.outline.notes).toBe('');
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
    expect(result.outline).toEqual(OUTLINE);
  });
});

describe('generateOutline with large materials', () => {
  // Between OUTLINE_DIRECT_MAX_CHARS (100000) and OUTLINE_MAX_CONTENT_CHARS,
  // so it takes the batching path without hitting the refusal.
  const BIG = 'x'.repeat(200000);

  it('summarizes in batches and consolidates once', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ fileContent: BIG, outline: undefined })
    );
    mockGenerateStructured.mockResolvedValue({
      content: JSON.stringify(OUTLINE),
      usage: {},
    });

    await generateOutline('src-1');

    // 200000 chars / 80000 per batch = 3 batches, plus one consolidation call.
    expect(mockGenerateStructured).toHaveBeenCalledTimes(4);

    const consolidationPrompt =
      mockGenerateStructured.mock.calls[3][0].prompt;
    expect(consolidationPrompt).toContain('Topic A');
  });

  // Oversized materials used to be summarized up to the batch cap and the
  // shortfall recorded in notes — which meant paying for every batch and then
  // silently owning an outline that covered part of the document. Objectives
  // come from the outline, and questions from objectives, so the unread tail
  // became unreachable while still costing full price to ingest and embed.
  // Refusing before the first call spends nothing and puts the choice (split
  // the material) in front of the instructor.
  it('refuses a material larger than one outline can cover, before any LLM call', async () => {
    const huge = 'y'.repeat(OUTLINE_MAX_CONTENT_CHARS + 1);
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ fileContent: huge, outline: undefined })
    );

    await expect(generateOutline('src-1')).rejects.toMatchObject({
      code: 'MATERIAL_TOO_LARGE',
    });
    expect(mockGenerateStructured).not.toHaveBeenCalled();
    expect(materialService.setMaterialOutline).not.toHaveBeenCalled();
  });

  it('names the actual size and the limit so the message is actionable', async () => {
    const huge = 'y'.repeat(OUTLINE_MAX_CONTENT_CHARS + 1);
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ fileContent: huge, outline: undefined })
    );

    await expect(generateOutline('src-1')).rejects.toThrow(
      new RegExp(`${OUTLINE_MAX_CONTENT_CHARS + 1}[\\s\\S]*${OUTLINE_MAX_CONTENT_CHARS}`)
    );
  });

  // Objective generation falls back to retrieval when a material has no
  // outline, so refusing does not block the instructor — it quietly lowers the
  // quality of what they get next. The message says so, since nothing else in
  // the flow will.
  it('warns that objectives from this material may be less accurate', async () => {
    const huge = 'y'.repeat(OUTLINE_MAX_CONTENT_CHARS + 1);
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ fileContent: huge, outline: undefined })
    );

    const error = await generateOutline('src-1').catch((e) => e);

    expect(error.message).toMatch(/learning objectives/i);
    expect(error.message).toMatch(/less accurate/i);
  });

  // The message is read by an instructor deciding which upload to split, so it
  // has to name the document the way they see it in the UI, not by its id.
  it('identifies the material by title, not by source id', async () => {
    const huge = 'y'.repeat(OUTLINE_MAX_CONTENT_CHARS + 1);
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ fileContent: huge, outline: undefined, documentTitle: 'Linear Algebra Ch. 1-12' })
    );

    const error = await generateOutline('src-1').catch((e) => e);

    expect(error.message).toContain('Linear Algebra Ch. 1-12');
    expect(error.message).not.toContain('src-1');
    // Still carried for logging and for callers that need to act on it.
    expect(error.sourceId).toBe('src-1');
  });

  it('falls back to the source id when a material has no title', async () => {
    const huge = 'y'.repeat(OUTLINE_MAX_CONTENT_CHARS + 1);
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ fileContent: huge, outline: undefined, documentTitle: '' })
    );

    const error = await generateOutline('src-1').catch((e) => e);

    expect(error.message).toContain('src-1');
  });

  it('does not append a truncation note when everything was covered', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ fileContent: BIG, outline: undefined })
    );

    await generateOutline('src-1');

    const stored = materialService.setMaterialOutline.mock.calls[0][1].outline;
    expect(stored.notes).not.toContain('were not summarized');
  });
});

describe('saveOutline', () => {
  const edited = {
    topics: [{ title: 'Corrected topic', keyPoints: ['Instructor point'] }],
    notes: 'this should be ignored',
  };

  it('stores the edit and marks provenance', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: { ...OUTLINE, notes: 'model caveat' } })
    );

    const result = await saveOutline('src-1', edited);

    expect(result.source).toBe('edited');

    const [, fields] = materialService.setMaterialOutline.mock.calls[0];
    expect(fields.outlineSource).toBe('edited');
    expect(fields.outlineEditedAt).toBeInstanceOf(Date);
    expect(fields.outline.topics[0].title).toBe('Corrected topic');
  });

  // notes carries model caveats and the code-generated truncation sentence, so
  // it is state about how the outline was produced, not instructor content.
  it('keeps the stored notes and ignores caller-supplied notes', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: { ...OUTLINE, notes: 'model caveat' } })
    );

    await saveOutline('src-1', edited);

    const [, fields] = materialService.setMaterialOutline.mock.calls[0];
    expect(fields.outline.notes).toBe('model caveat');
  });

  it('does not let a caller overwrite generation provenance', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(storedMaterial());

    await saveOutline('src-1', {
      ...edited,
      outlineSource: 'generated',
      outlineEditedAt: new Date('1999-01-01'),
    });

    const [, fields] = materialService.setMaterialOutline.mock.calls[0];
    expect(fields.outlineSource).toBe('edited');
    expect(fields.outlineEditedAt).not.toEqual(new Date('1999-01-01'));
  });

  it('rejects an edit when the material has no outline yet', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: undefined })
    );

    await expect(saveOutline('src-1', edited)).rejects.toMatchObject({
      code: 'NO_OUTLINE',
    });
    expect(materialService.setMaterialOutline).not.toHaveBeenCalled();
  });

  it('rejects an invalid edit with a usable message', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(storedMaterial());

    await expect(saveOutline('src-1', { topics: [], notes: '' })).rejects.toMatchObject({
      code: 'INVALID_OUTLINE',
    });
    expect(materialService.setMaterialOutline).not.toHaveBeenCalled();
  });

  it('rejects an edit that exceeds the size cap', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(storedMaterial());
    const bloated = {
      topics: [{ title: 'T', keyPoints: ['z'.repeat(30000)] }],
      notes: '',
    };

    await expect(saveOutline('src-1', bloated)).rejects.toMatchObject({
      code: 'INVALID_OUTLINE',
    });
  });
});
