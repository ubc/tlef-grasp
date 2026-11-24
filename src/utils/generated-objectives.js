// Tidy up the learning objectives a model returned, before they reach an
// instructor. Shared by generation from course materials and from Panopto
// transcripts, so both hand the client exactly the same shape.

const {
  BLOOM_LEVELS,
  DEFAULT_BLOOM_TYPE_PREFERENCES,
  QUESTION_TYPES,
  SUGGESTED_QUESTION_TYPES,
} = require('../constants/app-constants');
const { normalizeQuestionTypes } = require('./question-type-selection');

/**
 * Drop unnamed objectives and empty granular objectives, keep only known Bloom
 * levels (defaulting to Understand), and make sure every Bloom level has at
 * least one suggested question type.
 *
 * @param {Array} objectives the model's `objectives` array
 * @returns {Array<{ name: string, granularObjectives: Array<{ text: string,
 *   bloomTaxonomies: string[], questionTypes: Array }> }>} only objectives that
 *   still have at least one granular objective
 */
function cleanGeneratedObjectives(objectives) {
  return (Array.isArray(objectives) ? objectives : [])
    .filter((obj) => obj && obj.name && obj.name.trim() && Array.isArray(obj.granularObjectives))
    .map((obj) => ({
      name: obj.name.trim(),
      granularObjectives: obj.granularObjectives
        .filter((go) => go && (typeof go === 'string' ? go.trim() : go.text && go.text.trim()))
        .map((go) => {
          const text = typeof go === 'string' ? go.trim() : go.text.trim();
          let bloomTaxonomies = ['Understand']; // default
          if (go.bloomTaxonomies && Array.isArray(go.bloomTaxonomies)) {
            const mappedBlooms = go.bloomTaxonomies.filter((b) => BLOOM_LEVELS.includes(b));
            if (mappedBlooms.length > 0) bloomTaxonomies = mappedBlooms;
          }

          // Keep only entries whose bloomLevel survived the filter above
          // and whose type/count are valid. Any Bloom level left with no
          // valid entry gets a default type so the UI never shows an
          // empty per-type breakdown for a selected level.
          // Only types objective generation may suggest: a model that
          // ignores the schema's enum still never suggests multiple answer.
          const suggestedTypes = (Array.isArray(go.questionTypes) ? go.questionTypes : [])
            .filter((qt) => qt && SUGGESTED_QUESTION_TYPES.includes(qt.questionType));
          const questionTypes = normalizeQuestionTypes(suggestedTypes, {
            allowedBloomLevels: bloomTaxonomies,
          });
          bloomTaxonomies.forEach((level) => {
            if (!questionTypes.some((qt) => qt.bloomLevel === level)) {
              // The schema asks the model for a type per Bloom level but
              // cannot enforce it, so this is the only place a type is
              // chosen for a level it skipped. The instructor adjusts it
              // per level in the generation step, which is why there is no
              // course-wide override to consult here.
              const fallbackType = (DEFAULT_BLOOM_TYPE_PREFERENCES[level] || [])[0]
                || QUESTION_TYPES.MULTIPLE_CHOICE;
              questionTypes.push({ bloomLevel: level, questionType: fallbackType, count: 1 });
            }
          });

          return { text, bloomTaxonomies, questionTypes };
        }),
    }))
    .filter((obj) => obj.granularObjectives.length > 0);
}

module.exports = { cleanGeneratedObjectives };
