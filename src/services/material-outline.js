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

/**
 * Merges per-batch outlines into one. Kept local rather than instructor-editable:
 * it is a mechanical merge step, not a summarization style choice.
 */
const CONSOLIDATION_PROMPT = `You are merging several partial outlines of the same course material into one coherent outline.

PARTIAL OUTLINES:
{partialOutlines}

INSTRUCTIONS:
1. Combine topics that describe the same subject into a single topic, merging their key points.
2. Keep the order in which the topics first appear.
3. Do not invent topics or key points that are not in the partial outlines.
4. Leave notes as an empty string unless a partial outline reported a caveat worth keeping.`;

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

/** Merge per-batch outlines into one via a single consolidation call. */
const consolidateOutlines = async (partials) => {
  const rendered = partials
    .map((partial, index) => `Partial outline ${index + 1}:\n${JSON.stringify(partial)}`)
    .join('\n\n');

  const { content: raw } = await generateStructured({
    prompt: CONSOLIDATION_PROMPT.replace('{partialOutlines}', () => rendered),
    schema: MATERIAL_OUTLINE_SCHEMA,
    temperature: 0.2,
    schemaName: 'material_outline',
  });
  if (!raw) throw new Error('Empty response from the consolidation model.');
  return JSON.parse(raw);
};

/** Generate and store an outline, replacing whatever was there. */
const generateOutline = async (sourceId) => {
  const material = await getMaterialBySourceId(sourceId);
  if (!material || !material.fileContent || !material.fileContent.trim()) {
    throw new EmptyMaterialError(sourceId);
  }

  const template = await resolvePromptTemplate(material.courseId);

  let raw;
  let notes;
  if (material.fileContent.length <= OUTLINE_DIRECT_MAX_CHARS) {
    // Fits one call: summarize the full text. Batching here would silently
    // drop everything past the first batch.
    raw = await summarizeBatch(template, material.fileContent);
    notes = raw.notes || '';
  } else {
    const { batches, totalChars, coveredChars, truncated } = batchContent(
      material.fileContent,
      { batchChars: OUTLINE_BATCH_CHARS, maxBatches: OUTLINE_MAX_BATCHES }
    );
    // Batches are summarized sequentially: each is a full-size LLM request,
    // and running them concurrently would blow past the concurrency caps
    // used elsewhere in the codebase for the same reason.
    const partials = [];
    for (const batch of batches) {
      partials.push(await summarizeBatch(template, batch));
    }
    raw = partials.length === 1 ? partials[0] : await consolidateOutlines(partials);
    notes = [raw.notes || '', truncated ? truncationNote(coveredChars, totalChars) : '']
      .filter(Boolean)
      .join(' ');
  }

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
