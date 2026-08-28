const {
  QUESTION_TYPES,
  DEFAULT_BLOOM_TYPE_PREFERENCES,
  BLOOM_LEVELS,
  MAX_QUESTIONS_PER_OBJECTIVE,
} = require('../constants/app-constants');

const VALID_TYPES = new Set(Object.values(QUESTION_TYPES));

/**
 * Decide which question type to generate for a given Bloom level.
 *
 * When the caller pins a specific `requestedType` (e.g. the Question Bank
 * add-question wizard, where the instructor picks the type before choosing to
 * generate with AI), that type wins for every question. Otherwise it comes from
 * the Bloom→type defaults, falling back to multiple-choice.
 *
 * There is no per-course override: instructors now choose types per (granular
 * objective, Bloom level) in the generation step, which supersedes a course-wide
 * mapping entirely. These defaults only seed that choice.
 *
 * @param {Object} params
 * @param {string} [params.requestedType] - Instructor-pinned question type, if any.
 * @param {string} [params.bloomLevel] - Bloom level for this question.
 * @returns {string} A value from QUESTION_TYPES.
 */
function resolveGenerationQuestionType({ requestedType, bloomLevel } = {}) {
  if (requestedType && VALID_TYPES.has(requestedType)) {
    return requestedType;
  }
  const forLevel = DEFAULT_BLOOM_TYPE_PREFERENCES[bloomLevel];
  if (Array.isArray(forLevel) && forLevel.length > 0) {
    return forLevel[0];
  }
  return QUESTION_TYPES.MULTIPLE_CHOICE;
}

/**
 * Clamp and validate a granular objective's (bloomLevel, questionType, count)
 * breakdown. Every caller that accepts one of these arrays from outside the
 * server — the LLM's objective response, the generation request body, and the
 * objective create/update payload — runs it through here, so the same values
 * cannot be clamped on one path and unbounded on another.
 *
 * Repeated (bloomLevel, questionType) pairs are merged into one entry. Nothing
 * upstream prevents them — JSON Schema cannot express "no two items share these
 * two property values", so the model may emit them and a request body may carry
 * them — and left alone they are ambiguous: two entries saying
 * (Analyze, multiple-choice) are not two different things to generate, they are
 * one thing said twice.
 *
 * The objective total is the only cap. How that total is divided between levels
 * and types is the instructor's call: twenty questions cost the same whether they
 * are one type at one level or spread across all of them. Counts are trimmed to
 * whatever headroom is left rather than scaled, so earlier entries survive intact
 * and the total lands exactly on the cap.
 *
 * @param {Array} questionTypes - Raw entries, any shape.
 * @param {Object} [options]
 * @param {string[]} [options.allowedBloomLevels] - Levels the entries may name.
 *   Defaults to every Bloom level; callers holding a specific objective pass its
 *   own levels so entries cannot reference a level it does not have.
 * @returns {Array<{bloomLevel: string, questionType: string, count: number}>}
 */
function normalizeQuestionTypes(questionTypes, { allowedBloomLevels } = {}) {
  if (!Array.isArray(questionTypes)) return [];
  const allowed = Array.isArray(allowedBloomLevels) ? allowedBloomLevels : BLOOM_LEVELS;

  // Keyed on the pair itself. JSON.stringify rather than a joined string so no
  // separator character can collide with a level or type name.
  const merged = new Map();
  let total = 0;
  for (const qt of questionTypes) {
    if (!qt || !allowed.includes(qt.bloomLevel) || !VALID_TYPES.has(qt.questionType)) continue;
    const room = MAX_QUESTIONS_PER_OBJECTIVE - total;
    if (room <= 0) break;

    const key = JSON.stringify([qt.bloomLevel, qt.questionType]);
    const existing = merged.get(key);
    const count = Math.min(Math.max(1, parseInt(qt.count, 10) || 1), room);

    if (existing) existing.count += count;
    else merged.set(key, { bloomLevel: qt.bloomLevel, questionType: qt.questionType, count });
    total += count;
  }
  return [...merged.values()];
}

module.exports = { resolveGenerationQuestionType, normalizeQuestionTypes };
