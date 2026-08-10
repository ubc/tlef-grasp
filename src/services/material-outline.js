/**
 * Material outlines: a structured summary of a course material, generated once
 * and reused by learning-objective generation.
 *
 * The read and write paths are deliberately separate functions. A single
 * get-or-create would let any caller trigger a multi-second LLM call by
 * accident, which is exactly how summarization would end up inside an
 * instructor's objective-generation click. `getOutline` never invokes the LLM.
 */
const crypto = require('crypto');
const { getMaterialBySourceId, setMaterialOutline } = require('./material');
const settingsService = require('./settings');
const { generateStructured } = require('../utils/structured-llm');
const { getLLMModel } = require('../utils/llm-provider');
const { MATERIAL_OUTLINE_SCHEMA } = require('../constants/llm-schemas');
const {
  DEFAULT_PROMPTS,
  OUTLINE_DIRECT_MAX_CHARS,
  OUTLINE_BATCH_CHARS,
  OUTLINE_MAX_BATCHES,
  MAX_OUTLINE_TOPICS,
  MAX_OUTLINE_KEY_POINTS,
  MAX_OUTLINE_CHARS,
} = require('../constants/app-constants');
const {
  batchContent,
  validateOutline,
  truncationNote,
} = require('../utils/outline-text');

const CAPS = {
  maxTopics: MAX_OUTLINE_TOPICS,
  maxKeyPoints: MAX_OUTLINE_KEY_POINTS,
  maxChars: MAX_OUTLINE_CHARS,
};

/** Thrown when a material has no text to summarize. */
class EmptyMaterialError extends Error {
  constructor(sourceId) {
    super(`Material ${sourceId} has no extractable text to summarize.`);
    this.name = 'EmptyMaterialError';
    this.code = 'EMPTY_MATERIAL';
  }
}

/** Identifies the prompt an outline was produced with, for staleness checks. */
const promptHashFor = (template) =>
  crypto.createHash('sha256').update(String(template)).digest('hex').slice(0, 16);

const resolvePromptTemplate = async (courseId) => {
  const settings = await settingsService.getSettings(courseId);
  return settings?.prompts?.materialOutline || DEFAULT_PROMPTS.materialOutline;
};

/**
 * An outline is stale when the model or prompt behind it has changed. Edited
 * outlines are exempt: they no longer reflect either, and the instructor owns
 * them. Staleness only reports — it never triggers regeneration.
 */
const isStale = (material, currentPromptHash) => {
  if (material.outlineSource === 'edited') return false;
  if (material.outlineModel !== getLLMModel()) return true;
  return material.outlinePromptHash !== currentPromptHash;
};

const present = (material, outline) => ({
  outline,
  source: material.outlineSource === 'edited' ? 'edited' : 'generated',
  generatedAt: material.outlineGeneratedAt || null,
  editedAt: material.outlineEditedAt || null,
  stale: false,
});

/** Read the stored outline. Never generates, never calls the LLM. */
const getOutline = async (sourceId) => {
  const material = await getMaterialBySourceId(sourceId);
  if (!material || !material.outline) return null;

  const validated = validateOutline(material.outline, CAPS);
  if (!validated.ok) {
    console.warn(
      `⚠️ Stored outline for ${sourceId} is malformed (${validated.error}); reporting as absent.`
    );
    return null;
  }

  const template = await resolvePromptTemplate(material.courseId);
  return {
    ...present(material, validated.outline),
    stale: isStale(material, promptHashFor(template)),
  };
};

/** Summarize one batch of material text into an outline. */
const summarizeBatch = async (template, content) => {
  const { content: raw } = await generateStructured({
    prompt: template.replace('{materialContent}', () => content),
    schema: MATERIAL_OUTLINE_SCHEMA,
    temperature: 0.2,
    schemaName: 'material_outline',
  });
  if (!raw) throw new Error('Empty response from the summarization model.');
  return JSON.parse(raw);
};

/** Generate and store an outline, replacing whatever was there. */
const generateOutline = async (sourceId) => {
  const material = await getMaterialBySourceId(sourceId);
  if (!material || !material.fileContent || !material.fileContent.trim()) {
    throw new EmptyMaterialError(sourceId);
  }

  const template = await resolvePromptTemplate(material.courseId);
  const { batches, totalChars, coveredChars, truncated } = batchContent(
    material.fileContent,
    { batchChars: OUTLINE_BATCH_CHARS, maxBatches: OUTLINE_MAX_BATCHES }
  );

  const fitsOneCall =
    material.fileContent.length <= OUTLINE_DIRECT_MAX_CHARS || batches.length === 1;
  if (!fitsOneCall) {
    throw new Error('Multi-batch summarization is not implemented yet.');
  }

  const raw = await summarizeBatch(template, batches[0]);

  const notes = [raw.notes || '', truncated ? truncationNote(coveredChars, totalChars) : '']
    .filter(Boolean)
    .join(' ');

  const validated = validateOutline({ ...raw, notes }, CAPS);
  if (!validated.ok) {
    throw new Error(`Generated outline was invalid: ${validated.error}`);
  }

  const fields = {
    outline: validated.outline,
    outlineGeneratedAt: new Date(),
    outlineModel: getLLMModel(),
    outlinePromptHash: promptHashFor(template),
    outlineSource: 'generated',
    outlineEditedAt: null,
  };
  await setMaterialOutline(sourceId, fields);

  return {
    outline: validated.outline,
    source: 'generated',
    generatedAt: fields.outlineGeneratedAt,
    editedAt: null,
    stale: false,
  };
};

module.exports = {
  getOutline,
  generateOutline,
  promptHashFor,
  EmptyMaterialError,
};
