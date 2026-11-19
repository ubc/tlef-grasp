import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

// Per prompt: { courses, matchingDefault } — how many courses store their own
// copy, and how many of those copies still match the default.
export function useAdminPromptOverrides() {
  const query = useQuery({
    queryKey: queryKeys.adminPromptOverrides,
    queryFn: () => api.get("/api/admin/prompts"),
  });

  return { ...query, prompts: query.data?.prompts || {} };
}

export function useResetPromptForAllCourses(options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (promptKey) => api.post(`/api/admin/prompts/${promptKey}/reset`, {}),
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adminPromptOverrides });
      // Every course's prompts may have changed, the selected one included.
      queryClient.invalidateQueries({ queryKey: ["course-settings"] });
      options?.onSuccess?.(...args);
    },
  });
}
