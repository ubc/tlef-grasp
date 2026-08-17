import { useMutation, useQueryClient } from "@tanstack/react-query";
import { lmsRequest } from "../lib/lmsApi";
import { queryKeys } from "../lib/queryKeys";

export function useUnlinkLmsSection(courseId, options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sectionId) =>
      lmsRequest(
        `/api/lms/courses/${encodeURIComponent(courseId)}/sections/${encodeURIComponent(sectionId)}/link`,
        { method: "DELETE" }
      ),
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.myCourseSections(courseId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.courseSections(courseId) });
      options?.onSuccess?.(...args);
    },
  });
}
