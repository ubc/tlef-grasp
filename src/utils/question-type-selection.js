const { QUESTION_TYPES, DEFAULT_BLOOM_TYPE_PREFERENCES } = require('../constants/app-constants');

const VALID_TYPES = new Set(Object.values(QUESTION_TYPES));

/**
 * Decide which question type to generate for a given Bloom level.
 *
 * When the caller pins a specific `requestedType` (e.g. the Question Bank
 * add-question wizard, where the instructor picks the type before choosing to
 * generate with AI), that type wins for every question. Otherwise the type is
 * derived from the course's Bloom→type preferences, falling back to
 * multiple-choice.
 *
 * @param {Object} params
 * @param {string} [params.requestedType] - Instructor-pinned question type, if any.
 * @param {string} [params.bloomLevel] - Bloom level for this question.
 * @param {Object} [params.bloomTypePreferences] - Course Bloom→type preference map.
 * @returns {string} A value from QUESTION_TYPES.
 */
function resolveGenerationQuestionType({ requestedType, bloomLevel, bloomTypePreferences } = {}) {
  if (requestedType && VALID_TYPES.has(requestedType)) {
    return requestedType;
  }
  const prefs = bloomTypePreferences || DEFAULT_BLOOM_TYPE_PREFERENCES;
  const forLevel = prefs[bloomLevel];
  if (Array.isArray(forLevel) && forLevel.length > 0) {
    return forLevel[0];
  }
  return QUESTION_TYPES.MULTIPLE_CHOICE;
}

module.exports = { resolveGenerationQuestionType };
