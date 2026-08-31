// One AI learning-objective run: ask the LLM for objectives, then persist every
// one it returns.
//
// Generating and saving used to be two separate instructor actions with a
// preview in between. Instructors did not want the preview — they want to land
// on the editable page as soon as the LLM answers (#101) — so the two are now a
// single step. The Generate modal and the page's Regenerate button run exactly
// the same thing, which is why it lives here rather than inside either of them.

import { api } from "../../lib/api";

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
    try {
      const result = await api.post("/api/objective", {
        name: objective.name,
        courseId: course.id,
        materialIds,
        granularObjectives: objective.granularObjectives.map((go) => ({
          text: typeof go === "string" ? go : go.text,
          bloomTaxonomies: typeof go === "string" ? [] : go.bloomTaxonomies || [],
          questionTypes: typeof go === "string" ? [] : go.questionTypes || [],
        })),
      });
      if (!result.success) {
        throw new Error(result.error || `Failed to save objective: ${objective.name}`);
      }
      saved.push({
        objective: result.objective,
        granulars: result.granularObjectives,
        materialIds,
      });
    } catch (error) {
      console.error(`Error saving objective "${objective.name}":`, error);
      failed.push({ name: objective.name, error });
    }
  }

  return { saved, failed };
}

/**
 * Drop the objectives a regenerate replaced.
 *
 * Generate now writes to the database before the instructor has confirmed
 * anything, so a regenerate that only detached its predecessors would leave a
 * full abandoned set in the Question Bank every time it ran.
 *
 * Report failures so callers can keep those records visible and offer a retry.
 */
export async function deleteObjectives(objectiveIds) {
  const deleted = [];
  const failed = [];
  await Promise.all(
    (objectiveIds || []).map(async (objectiveId) => {
      try {
        const result = await api.delete(`/api/objective/${objectiveId}`);
        if (!result.success) {
          throw new Error(result.error || "Failed to delete objective");
        }
        deleted.push(objectiveId);
      } catch (error) {
        console.error(`Error deleting replaced objective ${objectiveId}:`, error);
        failed.push({ objectiveId, error });
      }
    })
  );
  return { deleted, failed };
}
