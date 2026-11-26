// One AI learning-objective run: ask the LLM for objectives, then persist every
// one it returns.
//
// Generating and saving used to be two separate instructor actions with a
// preview in between. Instructors did not want the preview — they want to land
// on the editable page as soon as the LLM answers (#101) — so the two are now a
// single step, run from the Generate modal. Generating only ever adds: the
// server shows the model the objectives the materials already have and drops
// exact repeats, and nothing here replaces or deletes an objective. Each
// objective is linked only to the materials it was generated from.

import { api } from "../../lib/api";
import { MAX_MATERIALS_PER_OBJECTIVE } from "../../lib/constants";

async function saveNewObjective(course, objective, granularObjectives, materialIds) {
  const result = await api.post("/api/objective", {
    name: objective.name,
    courseId: course.id,
    materialIds,
    granularObjectives,
  });
  if (!result.success) {
    throw new Error(result.error || `Failed to save objective: ${objective.name}`);
  }
  return { objective: result.objective, granulars: result.granularObjectives, materialIds };
}

// A generated objective with the name of a saved one: its new granular
// objectives are added to the saved objective, and the materials they came
// from are linked to it too, so long as that stays within the cap. Links are
// only ever added here, never removed.
async function addToExistingObjective(objective, granularObjectives, sourceMaterialIds) {
  const id = objective.existingObjectiveId;
  const result = await api.post(`/api/objective/${id}/granular`, { granularObjectives });
  if (!result.success) {
    throw new Error(result.error || `Failed to add to objective: ${objective.name}`);
  }

  const linked = objective.existingMaterialIds || [];
  const merged = [...new Set([...linked, ...sourceMaterialIds])];
  let materialIds = linked;
  if (merged.length > linked.length && merged.length <= MAX_MATERIALS_PER_OBJECTIVE) {
    const links = await api.put(`/api/objective/${id}/materials`, { materialIds: merged });
    if (links?.success) materialIds = merged;
  }

  return { objective: result.objective, granulars: result.granularObjectives, materialIds };
}

/**
 * Generate objectives from the given materials and save each one.
 *
 * @param {{ course: object, materialIds: string[], materialTitles: object,
 *           userObjectives: string[] }} run the inputs of a single generation
 * @returns {Promise<{ saved: Array, failed: Array }>} `saved` entries carry the
 *   shape appendObjectiveGroups consumes; `failed` names the objectives whose
 *   save was rejected, so the caller can report them.
 * @throws when the generator itself fails or returns nothing — there is no
 *   partial result to land the instructor on in that case.
 */
export async function generateAndSaveObjectives({
  course,
  materialIds,
  materialTitles,
  userObjectives,
}) {
  const data = await api.post("/api/rag-llm/generate-learning-objectives", {
    courseId: course.id,
    courseName: course.name,
    materialIds,
    materialTitles,
    userObjectives,
  });
  if (!data.success || !data.objectives || data.objectives.length === 0) {
    throw new Error(data.error || "No objectives generated");
  }

  // One rejected save must not cost the instructor the rest of the run: what
  // saved is returned and lands on the page, what did not is named back.
  const saved = [];
  const failed = [];
  for (const objective of data.objectives) {
    // The materials this objective was generated from. A reply without them
    // (an older server) links it to every selected material, as before.
    const objectiveMaterialIds = objective.sourceMaterialIds?.length
      ? objective.sourceMaterialIds
      : materialIds;
    const granularObjectives = objective.granularObjectives.map((go) => ({
      text: typeof go === "string" ? go : go.text,
      bloomTaxonomies: typeof go === "string" ? [] : go.bloomTaxonomies || [],
      questionTypes: typeof go === "string" ? [] : go.questionTypes || [],
    }));
    try {
      saved.push(
        objective.existingObjectiveId
          ? await addToExistingObjective(objective, granularObjectives, objectiveMaterialIds)
          : await saveNewObjective(course, objective, granularObjectives, objectiveMaterialIds)
      );
    } catch (error) {
      console.error(`Error saving objective "${objective.name}":`, error);
      failed.push({ name: objective.name, error });
    }
  }

  return { saved, failed };
}
