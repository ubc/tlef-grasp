import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { useSelectedCourseId } from "../stores/appStore";

// All questions for a course (defaults to the currently selected course).
export function useQuestions(courseId, { enabled = true } = {}) {
  const selectedCourseId = useSelectedCourseId();
  const effectiveCourseId = courseId ?? selectedCourseId;

  const query = useQuery({
    queryKey: queryKeys.questions(effectiveCourseId),
    queryFn: () => api.get(`/api/question?courseId=${effectiveCourseId}`),
    enabled: !!effectiveCourseId && enabled,
  });

  return {
    ...query,
    questions: query.data?.success ? query.data.questions || [] : [],
  };
}

// One question loaded fresh from the API (used by the edit modal).
export function useQuestionDetail(questionId) {
  const query = useQuery({
    queryKey: queryKeys.questionDetail(questionId),
    queryFn: async () => {
      const data = await api.get(`/api/question/${questionId}`);
      if (!data.success || !data.question) throw new Error("Question not found");
      return data.question;
    },
    enabled: !!questionId,
  });

  return { ...query, question: query.data || null };
}

// Invalidate every cache that contains question data for a course.
export function useInvalidateQuestions(courseId) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.questions(courseId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.questionBank(courseId) });
    queryClient.invalidateQueries({
      queryKey: queryKeys.quizzesWithQuestions(courseId),
    });
  };
}

export function useUpdateQuestion(courseId, options) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateQuestions(courseId);
  return useMutation({
    mutationFn: ({ questionId, updates }) =>
      api.put(`/api/question/${questionId}`, updates),
    ...options,
    onSuccess: (data, variables, ...rest) => {
      invalidate();
      queryClient.invalidateQueries({
        queryKey: queryKeys.questionDetail(variables.questionId),
      });
      options?.onSuccess?.(data, variables, ...rest);
    },
  });
}

// Applies the same update to many questions; resolves with the success count
// (individual failures are tolerated, matching the legacy bulk actions).
// Save new questions to the bank, optionally linking them to a quiz.
export function useSaveQuestions(courseId, options) {
  const invalidate = useInvalidateQuestions(courseId);
  return useMutation({
    mutationFn: ({ questions, quizId }) =>
      quizId
        ? api.post(`/api/quiz/${quizId}/questions`, { courseId, questions })
        : api.post("/api/question/save", { courseId, questions }),
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

export function useBulkUpdateQuestions(courseId, options) {
  const invalidate = useInvalidateQuestions(courseId);
  return useMutation({
    mutationFn: async ({ questionIds, updates }) => {
      const results = await Promise.all(
        questionIds.map((id) =>
          api
            .put(`/api/question/${id}`, updates)
            .then(() => true)
            .catch(() => false)
        )
      );
      return results.filter(Boolean).length;
    },
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

export function useBulkDeleteQuestions(courseId, options) {
  const invalidate = useInvalidateQuestions(courseId);
  return useMutation({
    mutationFn: async (questionIds) => {
      const results = await Promise.all(
        questionIds.map((id) =>
          api
            .delete(`/api/question/${id}`)
            .then(() => true)
            .catch(() => false)
        )
      );
      return results.filter(Boolean).length;
    },
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}
