import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { getObjectId } from "../lib/utils";

// Meta learning objectives for a course (raw list).
export function useCourseObjectives(courseId, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: queryKeys.objectives(courseId),
    queryFn: () => api.get(`/api/objective?courseId=${courseId}`),
    enabled: !!courseId && enabled,
  });

  return { ...query, objectives: query.data?.objectives || [] };
}

// Objectives with granular sub-objectives and linked material ids,
// loaded in a single request via the batched /detailed endpoint.
export function useDetailedObjectives(courseId, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: queryKeys.detailedObjectives(courseId),
    queryFn: async () => {
      const data = await api.get(`/api/objective/detailed?courseId=${courseId}`);
      if (!data.success || !data.objectives) return [];
      return data.objectives.map((objective) => ({
        id: getObjectId(objective),
        name: objective.name,
        granular: objective.granularObjectives || [],
        materialIds: objective.materialSourceIds || [],
      }));
    },
    enabled: !!courseId && enabled,
  });

  return { ...query, objectives: query.data || [] };
}

// How many questions (and which quizzes) would be affected by deleting a
// learning objective or granular objective. Used to prompt the instructor.
export function useObjectiveDeletionImpact(objectiveId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["objectiveDeletionImpact", objectiveId],
    queryFn: () => api.get(`/api/objective/${objectiveId}/deletion-impact`),
    enabled: !!objectiveId && enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useInvalidateObjectives(courseId) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.objectives(courseId) });
    queryClient.invalidateQueries({
      queryKey: queryKeys.detailedObjectives(courseId),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.questionBank(courseId) });
  };
}

// Create or update an objective and set its associated materials in one step.
export function useSaveObjective(courseId, options) {
  const invalidate = useInvalidateObjectives(courseId);
  return useMutation({
    mutationFn: async ({ objectiveId, name, materialIds }) => {
      const result = objectiveId
        ? await api.put(`/api/objective/${objectiveId}`, { name, courseId })
        : await api.post("/api/objective", { name, courseId });
      if (!result.success) {
        throw new Error(result.error || "Failed to save objective");
      }
      const id = objectiveId || getObjectId(result.objective);
      await api.put(`/api/objective/${id}/materials`, { materialIds });
      return result;
    },
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

export function useDeleteObjective(courseId, options) {
  const invalidate = useInvalidateObjectives(courseId);
  return useMutation({
    mutationFn: async ({ objectiveId, questionAction } = {}) => {
      const qs = questionAction ? `?questionAction=${questionAction}` : "";
      const data = await api.delete(`/api/objective/${objectiveId}${qs}`);
      if (!data.success) {
        throw new Error(data.error || "Failed to delete objective");
      }
      return data;
    },
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

// Replace an objective's full granular sub-objective list.
export function useUpdateGranularObjectives(courseId, options) {
  const invalidate = useInvalidateObjectives(courseId);
  return useMutation({
    mutationFn: async ({ objectiveId, granularObjectives, questionAction }) => {
      const data = await api.put(`/api/objective/${objectiveId}`, {
        granularObjectives,
        courseId,
        ...(questionAction ? { questionAction } : {}),
      });
      if (!data.success) {
        throw new Error(data.error || "Failed to update objective");
      }
      return data;
    },
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}
