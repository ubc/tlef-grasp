/**
 * Material outlines: a structured summary of a course material, generated once
 * and reused by learning-objective generation.
 *
 * The read and write paths are deliberately separate functions. A single
 * get-or-create would let any caller trigger a multi-second LLM call by
 * accident, which is exactly how summarization would end up inside an
 * instructor's objective-generation click. `getOutline` never invokes the LLM.
 */
const { getMaterialBySourceId, setMaterialOutline } = require('./material');
const settingsService = require('./settings');
const { generateStructured } = require('../utils/structured-llm');
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
  capNote,
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
4. Leave notes as an empty string unless a partial outline reported a caveat worth keeping.
5. Produce at most {maxTopics} topics and at most {maxKeyPoints} key points per topic. Keep the outline concise — merge or drop the least important material rather than exceeding these limits.`;

/** Thrown when a material has no text to summarize. */
class EmptyMaterialError extends Error {
  constructor(sourceId) {
    super(`Material ${sourceId} has no extractable text to summarize.`);
    this.name = 'EmptyMaterialError';
    this.code = 'EMPTY_MATERIAL';
  }
}

/** Thrown when an edit is attempted on a material that has no outline. */
class NoOutlineError extends Error {
  constructor(sourceId) {
    super(`Material ${sourceId} has no outline to edit; generate one first.`);
    this.name = 'NoOutlineError';
    this.code = 'NO_OUTLINE';
  }
}

/** Thrown when a submitted outline fails validation. */
class InvalidOutlineError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'InvalidOutlineError';
    this.code = 'INVALID_OUTLINE';
  }
}

const resolvePromptTemplate = async (courseId) => {
  const settings = await settingsService.getSettings(courseId);
  return settings?.prompts?.materialOutline || DEFAULT_PROMPTS.materialOutline;
};

const present = (material, outline) => ({
  outline,
  source: material.outlineSource === 'edited' ? 'edited' : 'generated',
  editedAt: material.outlineEditedAt || null,
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

  return present(material, validated.outline);
};

/** Summarize one batch of material text into an outline. */
const summarizeBatch = async (template, content) => {
  const { content: raw } = await generateStructured({
    prompt: template
      .replace('{materialContent}', () => content)
      .replace('{maxTopics}', () => String(MAX_OUTLINE_TOPICS))
      .replace('{maxKeyPoints}', () => String(MAX_OUTLINE_KEY_POINTS)),
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
    prompt: CONSOLIDATION_PROMPT
      .replace('{partialOutlines}', () => rendered)
      .replace('{maxTopics}', () => String(MAX_OUTLINE_TOPICS))
      .replace('{maxKeyPoints}', () => String(MAX_OUTLINE_KEY_POINTS)),
    schema: MATERIAL_OUTLINE_SCHEMA,
    temperature: 0.2,
    schemaName: 'material_outline',
  });
  if (!raw) throw new Error('Empty response from the consolidation model.');
  return JSON.parse(raw);
};

/**
 * Trims a generated outline's topics and key points down to the stored caps.
 * The prompts tell the model the caps, but a model can still disobey them —
 * this degrades that output into something storable instead of rejecting it
 * outright, after every batch/consolidation LLM call has already been paid
 * for. Any trimming is recorded in notes via capNote, never applied silently.
 * Instructor edits go through validateOutline directly and are rejected
 * instead — this function is only for model output.
 */
const capGeneratedOutline = (outline) => {
  const sourceTopics = Array.isArray(outline.topics) ? outline.topics : [];
  let droppedTopics = Math.max(0, sourceTopics.length - MAX_OUTLINE_TOPICS);
  let droppedKeyPoints = 0;

  let topics = sourceTopics.slice(0, MAX_OUTLINE_TOPICS).map((topic) => {
    const keyPoints = Array.isArray(topic?.keyPoints) ? topic.keyPoints : [];
    if (keyPoints.length <= MAX_OUTLINE_KEY_POINTS) return topic;
    droppedKeyPoints += keyPoints.length - MAX_OUTLINE_KEY_POINTS;
    return { ...topic, keyPoints: keyPoints.slice(0, MAX_OUTLINE_KEY_POINTS) };
  });

  const baseNotes = outline.notes || '';
  const notesWithCapNote = () =>
    [
      baseNotes,
      droppedTopics > 0 || droppedKeyPoints > 0 ? capNote(droppedTopics, droppedKeyPoints) : '',
    ]
      .filter(Boolean)
      .join(' ');

  // Drop whole topics from the end until the outline fits the character cap.
  while (
    topics.length > 0 &&
    JSON.stringify({ topics, notes: notesWithCapNote() }).length > MAX_OUTLINE_CHARS
  ) {
    topics = topics.slice(0, -1);
    droppedTopics += 1;
  }

  return { ...outline, topics, notes: notesWithCapNote() };
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

  // The prompts state the caps, but a model can still disobey them. Trim down
  // to size before validating so validateOutline is a genuine invariant check
  // on generation, not a likely failure after every LLM call already ran.
  const capped = capGeneratedOutline({ ...raw, notes });
  const validated = validateOutline(capped, CAPS);
  if (!validated.ok) {
    throw new Error(`Generated outline was invalid: ${validated.error}`);
  }

  const fields = {
    outline: validated.outline,
    outlineSource: 'generated',
    outlineEditedAt: null,
  };
  await setMaterialOutline(sourceId, fields);

  return {
    outline: validated.outline,
    source: 'generated',
    editedAt: null,
  };
};

/**
 * Store an instructor's edit. The edit wins until an explicit regeneration —
 * there is no merging with model output, which is what would demand versioning
 * and conflict rules.
 *
 * `notes` and the generation provenance fields are deliberately not writable
 * here: they describe how the outline was produced, not what the instructor
 * authored.
 */
const saveOutline = async (sourceId, submitted) => {
  const material = await getMaterialBySourceId(sourceId);
  if (!material || !material.outline) {
    throw new NoOutlineError(sourceId);
  }

  const validated = validateOutline(submitted, CAPS);
  if (!validated.ok) {
    throw new InvalidOutlineError(validated.error);
  }

  const fields = {
    outline: { topics: validated.outline.topics, notes: material.outline.notes || '' },
    outlineSource: 'edited',
    outlineEditedAt: new Date(),
  };
  await setMaterialOutline(sourceId, fields);

  return {
    outline: fields.outline,
    source: 'edited',
    editedAt: fields.outlineEditedAt,
  };
};

module.exports = {
  getOutline,
  generateOutline,
  saveOutline,
  EmptyMaterialError,
  NoOutlineError,
  InvalidOutlineError,
};
