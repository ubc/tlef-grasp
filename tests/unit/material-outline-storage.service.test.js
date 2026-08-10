jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));

const databaseService = require('../../src/services/database');
const { setMaterialOutline, clearMaterialOutline } = require('../../src/services/material');
const { MATERIAL_OUTLINE_SCHEMA } = require('../../src/constants/llm-schemas');
const {
  MATERIAL_OUTLINE_PROMPT,
  DEFAULT_PROMPTS,
  OUTLINE_DIRECT_MAX_CHARS,
  OUTLINE_BATCH_CHARS,
  OUTLINE_MAX_BATCHES,
  MAX_OUTLINE_TOPICS,
  MAX_OUTLINE_KEY_POINTS,
  MAX_OUTLINE_CHARS,
} = require('../../src/constants/app-constants');

describe('outline constants and schema', () => {
  it('exposes the documented numeric values', () => {
    expect(OUTLINE_DIRECT_MAX_CHARS).toBe(100000);
    expect(OUTLINE_BATCH_CHARS).toBe(80000);
    expect(OUTLINE_MAX_BATCHES).toBe(8);
    expect(MAX_OUTLINE_TOPICS).toBe(40);
    expect(MAX_OUTLINE_KEY_POINTS).toBe(20);
    expect(MAX_OUTLINE_CHARS).toBe(20000);
  });

  it('exposes a prompt with the placeholders the service fills', () => {
    expect(MATERIAL_OUTLINE_PROMPT).toContain('{materialContent}');
    expect(DEFAULT_PROMPTS.materialOutline).toBe(MATERIAL_OUTLINE_PROMPT);
  });

  it('constrains the schema to topics and notes', () => {
    expect(MATERIAL_OUTLINE_SCHEMA.properties.topics).toBeDefined();
    expect(MATERIAL_OUTLINE_SCHEMA.properties.notes).toBeDefined();
    expect(MATERIAL_OUTLINE_SCHEMA.additionalProperties).toBe(false);
    expect(MATERIAL_OUTLINE_SCHEMA.required).toEqual(
      expect.arrayContaining(['topics', 'notes'])
    );
  });
});

describe('outline storage', () => {
  let collection;

  beforeEach(() => {
    collection = { updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => {
        if (name === 'grasp_material') return collection;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    });
  });

  it('sets the outline fields for one material', async () => {
    const fields = { outline: { topics: [], notes: '' }, outlineSource: 'generated' };

    await setMaterialOutline('src-1', fields);

    expect(collection.updateOne).toHaveBeenCalledWith(
      { sourceId: 'src-1' },
      { $set: fields }
    );
  });

  it('unsets every outline field when clearing', async () => {
    await clearMaterialOutline('src-1');

    const [filter, update] = collection.updateOne.mock.calls[0];
    expect(filter).toEqual({ sourceId: 'src-1' });
    expect(Object.keys(update.$unset).sort()).toEqual([
      'outline',
      'outlineEditedAt',
      'outlineGeneratedAt',
      'outlineModel',
      'outlinePromptHash',
      'outlineSource',
    ]);
  });
});
