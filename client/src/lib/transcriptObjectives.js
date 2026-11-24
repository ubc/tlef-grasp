// Learning objectives made from a Panopto transcript (issue #218), while the
// instructor edits them in TranscriptObjectivesModal and before they are saved.
//
// Draft shape, one per video:
//   [{ key, name, granulars: [{ key, text, bloomTaxonomies, questionTypes }] }]
// `key` only gives React a stable identity while rows are added and removed;
// it is never sent to the server.

import { defaultTypeForLevel } from "./questionTypes";

let lastKey = 0;
const nextKey = () => `draft-${++lastKey}`;

/** Bloom level of a sub-objective the instructor adds by hand. */
const ADDED_BLOOM_LEVEL = "Understand";

/** A blank sub-objective, set up like the generator's default. */
export function newGranular(text = "") {
  return {
    key: nextKey(),
    text,
    bloomTaxonomies: [ADDED_BLOOM_LEVEL],
    questionTypes: [
      { bloomLevel: ADDED_BLOOM_LEVEL, questionType: defaultTypeForLevel(ADDED_BLOOM_LEVEL), count: 1 },
    ],
  };
}

/** A blank objective with one blank sub-objective to type into. */
export function newObjective() {
  return { key: nextKey(), name: "", granulars: [newGranular()] };
}

/** Turn the generator's objectives into an editable draft. */
export function draftFromGenerated(objectives) {
  return (objectives || []).map((objective) => ({
    key: nextKey(),
    name: objective.name || "",
    granulars: (objective.granularObjectives || []).map((granular) => ({
      key: nextKey(),
      text: typeof granular === "string" ? granular : granular.text || "",
      bloomTaxonomies: Array.isArray(granular.bloomTaxonomies) ? granular.bloomTaxonomies : [],
      questionTypes: Array.isArray(granular.questionTypes) ? granular.questionTypes : [],
    })),
  }));
}

const filledGranulars = (objective) =>
  objective.granulars.filter((granular) => granular.text.trim());

/**
 * What stops a draft from being saved, worded for the instructor. Blank
 * sub-objectives are not a problem: they are left out when saving.
 */
export function draftProblems(draft) {
  const problems = [];
  (draft || []).forEach((objective, index) => {
    const label = objective.name.trim() ? `"${objective.name.trim()}"` : `Objective ${index + 1}`;
    if (!objective.name.trim()) problems.push(`Objective ${index + 1} needs a name.`);
    if (filledGranulars(objective).length === 0) {
      problems.push(`${label} needs at least one sub-objective.`);
    }
  });
  return problems;
}

/** The POST /api/objective bodies for one video's draft. */
export function objectivePayloads(draft, { courseId, materialId }) {
  return (draft || []).map((objective) => ({
    name: objective.name.trim(),
    courseId,
    materialIds: [materialId],
    granularObjectives: filledGranulars(objective).map((granular) => ({
      text: granular.text.trim(),
      bloomTaxonomies: granular.bloomTaxonomies,
      questionTypes: granular.questionTypes,
    })),
  }));
}

/**
 * The message shown for a failed generation. A 422 is a verdict, not a
 * failure: the model decided the video does not teach enough to build on.
 */
export function describeGenerationError(error) {
  const body = error?.body || {};
  if (body.code === "MATERIAL_NOT_RELEVANT") {
    return {
      kind: "not-relevant",
      message: [body.error, body.details].filter(Boolean).join(" "),
    };
  }
  return {
    kind: "failed",
    message: body.error || error?.message || "GRASP could not create learning objectives from this video.",
  };
}

/** Totals for the save button and the success message. */
export function countObjectives(drafts) {
  return (drafts || []).reduce((total, draft) => total + (draft?.length || 0), 0);
}
