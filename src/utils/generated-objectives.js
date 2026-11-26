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
      // Only generation from course materials asks for these; attributed by
      // resolveSourceMaterialIds.
      ...(Array.isArray(obj.sourceMaterialIds) ? { sourceMaterialIds: obj.sourceMaterialIds } : {}),
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

// Compare objective text the way a reader would: case, punctuation and
// spacing differences do not make two objectives different.
function normalizeObjectiveText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Drop generated objectives that repeat ones already saved. The prompt already
 * tells the model not to, so this is the safety net for when it does anyway:
 * any granular objective whose text matches an existing granular objective is
 * dropped. An objective whose name matches an existing one keeps only its new
 * granular objectives, which go under the existing objective: it comes back
 * with that objective's name, `existingObjectiveId` and `existingMaterialIds`
 * so the caller adds to it rather than saving a second copy. An objective left
 * with no granular objectives is dropped. Only exact repeats (after
 * normalizeObjectiveText) are caught; rewordings are the prompt's job.
 *
 * @param {Array} objectives cleaned objectives (cleanGeneratedObjectives)
 * @param {Array<{ _id?: *, name: string, granularObjectives?: Array<{ name?: string }>,
 *   materialSourceIds?: string[] }>} existing saved parent objectives, with their
 *   granular objectives and linked materials
 * @returns {Array} the objectives and granular objectives that are new
 */
function dropExistingObjectives(objectives, existing) {
  const existingByName = new Map();
  const existingGranulars = new Set();
  for (const objective of existing || []) {
    const key = normalizeObjectiveText(objective.name);
    if (key && !existingByName.has(key)) existingByName.set(key, objective);
    for (const granular of objective.granularObjectives || []) {
      existingGranulars.add(normalizeObjectiveText(granular.name || granular.text));
    }
  }
  existingGranulars.delete('');

  return (objectives || [])
    .map((objective) => {
      const granularObjectives = objective.granularObjectives.filter(
        (granular) => !existingGranulars.has(normalizeObjectiveText(granular.text))
      );
      const match = existingByName.get(normalizeObjectiveText(objective.name));
      if (!match) return { ...objective, granularObjectives };
      return {
        ...objective,
        name: match.name,
        granularObjectives,
        existingObjectiveId: String(match._id),
        existingMaterialIds: (match.materialSourceIds || []).map(String),
      };
    })
    .filter((objective) => objective.granularObjectives.length > 0);
}

/**
 * The block appended to an objective-generation prompt when the selected
 * materials already have saved objectives, so the model adds to them rather
 * than rewording them. Appended rather than templated: course prompts are
 * editable in Settings and saved ones have no placeholder for it.
 *
 * @param {Array<{ name: string, granularObjectives?: Array<{ name?: string }> }>} existing
 * @returns {string} empty when there is nothing to show
 */
function existingObjectivesPromptBlock(existing) {
  if (!existing || existing.length === 0) return '';
  const list = existing
    .map((objective, index) => {
      const granulars = (objective.granularObjectives || [])
        .map((granular) => `   - ${granular.name || granular.text}`)
        .join('\n');
      return `${index + 1}. ${objective.name}${granulars ? `\n${granulars}` : ''}`;
    })
    .join('\n');
  return `

EXISTING LEARNING OBJECTIVES
These learning objectives are already saved for the selected materials:
${list}

Do not repeat or reword any of them. Only create learning objectives for content in the materials that the existing ones do not already cover. If the existing objectives already cover the materials, return an empty objectives array. Keep materialIsRelevant about whether the materials are course content, not about whether new objectives are needed.`;
}

/**
 * The selected materials an objective should be linked to: the ones the model
 * said it draws on, in selection order. Ids that were not selected are
 * ignored, and with none left the objective is linked to every selected
 * material, so it is never linked to nothing.
 *
 * @param {string[]|undefined} sourceMaterialIds what the model returned
 * @param {string[]} selectedIds the materials selected for the run
 */
function resolveSourceMaterialIds(sourceMaterialIds, selectedIds) {
  const named = new Set((Array.isArray(sourceMaterialIds) ? sourceMaterialIds : []).map(String));
  const kept = selectedIds.map(String).filter((id) => named.has(id));
  return kept.length > 0 ? kept : selectedIds.map(String);
}

/**
 * The block appended to an objective-generation prompt asking which selected
 * materials each objective draws on. Appended for the same reason as
 * existingObjectivesPromptBlock: saved course prompts have no placeholder.
 *
 * @param {string[]} materialIds the selected materials' source ids
 */
function sourceMaterialsPromptBlock(materialIds) {
  return `

SOURCE MATERIALS
For each meta learning objective, set sourceMaterialIds to the SOURCE ID of each material its content comes from. The selected materials are: ${materialIds.join(', ')}. Use one id when the objective comes from a single material. List several only when the objective's content is genuinely covered in each of them. Do not list a material just because it was selected.`;
}

module.exports = {
  cleanGeneratedObjectives,
  resolveSourceMaterialIds,
  sourceMaterialsPromptBlock,
  dropExistingObjectives,
  existingObjectivesPromptBlock,
  normalizeObjectiveText,
};
