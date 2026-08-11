/**
 * Pure helpers for material outlines: splitting source text into
 * summarizable batches, validating an outline (whether model- or
 * instructor-authored), and rendering one for a prompt.
 *
 * Nothing here touches the database, the LLM, or the RAG service, so all of it
 * is testable directly.
 */

/** Matches the "Page N:" markers the PDF parser writes at each page start. */
const PAGE_MARKER = /(?=^Page \d+:$)/m;

/**
 * Split text into batches of at most `batchChars`, preferring page boundaries so
 * a batch does not straddle a page mid-sentence. Stops after `maxBatches` and
 * reports the truncation rather than silently dropping the remainder.
 */
const batchContent = (text, { batchChars, maxBatches }) => {
  const source = typeof text === 'string' ? text : '';
  const totalChars = source.length;

  if (!source.trim()) {
    return { batches: [], totalChars, coveredChars: 0, truncated: false };
  }

  // Split at page markers where the parser produced them; otherwise one segment.
  const segments = source
    .split(PAGE_MARKER)
    .filter((segment) => segment.length > 0);

  // A segment longer than a batch is hard-split; nothing else can be done.
  const units = [];
  segments.forEach((segment) => {
    for (let i = 0; i < segment.length; i += batchChars) {
      units.push(segment.slice(i, i + batchChars));
    }
  });

  // Greedily pack units into batches without exceeding batchChars.
  const batches = [];
  let current = '';
  units.forEach((unit) => {
    if (current && current.length + unit.length > batchChars) {
      batches.push(current);
      current = unit;
    } else {
      current += unit;
    }
  });
  if (current) batches.push(current);

  const kept = batches.slice(0, maxBatches);
  const coveredChars = kept.reduce((sum, batch) => sum + batch.length, 0);

  return {
    batches: kept,
    totalChars,
    coveredChars,
    truncated: batches.length > maxBatches,
  };
};

/**
 * Validate and normalize an outline. Used for both model output and instructor
 * edits, so it must not assume a trustworthy source.
 */
const validateOutline = (outline, { maxTopics, maxKeyPoints, maxChars }) => {
  if (!outline || typeof outline !== 'object') {
    return { ok: false, error: 'Outline must be an object.' };
  }
  if (!Array.isArray(outline.topics)) {
    return { ok: false, error: 'Outline must have a topics array.' };
  }
  if (outline.topics.length === 0) {
    return { ok: false, error: 'An outline needs at least one topic.' };
  }
  if (outline.topics.length > maxTopics) {
    return { ok: false, error: `An outline may have at most ${maxTopics} topics.` };
  }

  const topics = [];
  for (const topic of outline.topics) {
    if (!topic || typeof topic !== 'object') {
      return { ok: false, error: 'Each topic must be an object.' };
    }
    if (typeof topic.title !== 'string' || !topic.title.trim()) {
      return { ok: false, error: 'Every topic needs a non-empty title.' };
    }
    if (topic.keyPoints !== undefined && !Array.isArray(topic.keyPoints)) {
      return { ok: false, error: `Key points for "${topic.title}" must be an array.` };
    }
    const rawPoints = topic.keyPoints || [];
    if (rawPoints.length > maxKeyPoints) {
      return {
        ok: false,
        error: `Topic "${topic.title}" may have at most ${maxKeyPoints} key points.`,
      };
    }
    const keyPoints = [];
    for (const point of rawPoints) {
      if (typeof point !== 'string' || !point.trim()) {
        return { ok: false, error: `Key points for "${topic.title}" must be non-empty text.` };
      }
      keyPoints.push(point.trim());
    }
    topics.push({ title: topic.title.trim(), keyPoints });
  }

  const notes = typeof outline.notes === 'string' ? outline.notes.trim() : '';

  const size = JSON.stringify({ topics, notes }).length;
  if (size > maxChars) {
    return { ok: false, error: `An outline may be at most ${maxChars} characters.` };
  }

  return { ok: true, outline: { topics, notes } };
};

/**
 * Render one material's outline as a prompt block. The header and separator
 * format matches what the retrieval path emits, so the objective prompt's
 * expectations do not change.
 */
const renderOutlineBlock = ({ documentTitle, sourceId, outline }) => {
  const title = (documentTitle || '').trim() || 'Untitled material';
  const lines = [`### MATERIAL: ${title} (SOURCE ID: ${sourceId})`];

  outline.topics.forEach((topic) => {
    lines.push(`## ${topic.title}`);
    topic.keyPoints.forEach((point) => lines.push(`- ${point}`));
  });

  if (outline.notes) {
    lines.push('', `NOTES: ${outline.notes}`);
  }

  return lines.join('\n');
};

/** Deterministic note recorded when coverage was capped. */
const truncationNote = (coveredChars, totalChars) =>
  `This outline covers the first ${coveredChars} of ${totalChars} characters of the material; later sections were not summarized.`;

/**
 * Deterministic note recorded when a generated outline exceeded the topic,
 * key-point, or character caps and was trimmed to fit them. Sibling of
 * truncationNote: same "record it, never drop it silently" pattern.
 */
const capNote = (droppedTopics, droppedKeyPoints) => {
  const parts = [];
  if (droppedTopics > 0) {
    parts.push(`${droppedTopics} topic${droppedTopics === 1 ? '' : 's'}`);
  }
  if (droppedKeyPoints > 0) {
    parts.push(`${droppedKeyPoints} key point${droppedKeyPoints === 1 ? '' : 's'}`);
  }
  return `This outline exceeded the size limits and was trimmed: ${parts.join(' and ')} dropped.`;
};

module.exports = {
  batchContent,
  validateOutline,
  renderOutlineBlock,
  truncationNote,
  capNote,
};
