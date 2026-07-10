import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

export function useMyQuizQuestionFlags(courseId) {
  const query = useQuery({
    queryKey: queryKeys.myQuizQuestionFlags(courseId),
    queryFn: () => api.get(`/api/quiz/flags/mine?courseId=${encodeURIComponent(courseId)}`),
    enabled: !!courseId,
  });

  return { ...query, flags: query.data?.flags || [] };
}

export function useCourseQuizQuestionFlags(courseId) {
  const query = useQuery({
    queryKey: queryKeys.courseQuizQuestionFlags(courseId),
    queryFn: () => api.get(`/api/quiz/flags/course/${courseId}`),
    enabled: !!courseId,
  });

  return { ...query, flags: query.data?.flags || [] };
}

export function useSubmitQuizQuestionFlag(options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ quizId, ...payload }) => api.post(`/api/quiz/${quizId}/flags`, payload),
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: ["quiz-question-flags"] });
      options?.onSuccess?.(...args);
    },
  });
}

export function useUpdateQuizQuestionFlagStatus(options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ flagId, status }) =>
      api.put(`/api/quiz/flags/${flagId}/status`, { status }),
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: ["quiz-question-flags"] });
      options?.onSuccess?.(...args);
    },
  });
}
