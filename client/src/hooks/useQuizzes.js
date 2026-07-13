import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { getObjectId } from "../lib/utils";

// Quizzes for a course (raw list, no question data).
export function useCourseQuizzes(courseId, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: queryKeys.quizzes(courseId),
    queryFn: () => api.get(`/api/quiz/course/${courseId}`),
    enabled: !!courseId && enabled,
  });

  return { ...query, quizzes: query.data?.quizzes || [] };
}

// Quizzes with their questions loaded — needed for approval progress and export.
export function useQuizzesWithQuestions(courseId) {
  const query = useQuery({
    queryKey: queryKeys.quizzesWithQuestions(courseId),
    queryFn: async () => {
      const data = await api.get(`/api/quiz/course/${courseId}/with-questions`);
      const quizzes = data.success ? data.quizzes || [] : [];
      return quizzes.map((quiz) => ({
        ...quiz,
        id: getObjectId(quiz),
        questions: (quiz.questions || []).map((q) => ({ ...q, id: getObjectId(q) })),
      }));
    },
    enabled: !!courseId,
  });

  return { ...query, quizzes: query.data || [] };
}

function useInvalidateQuizzes(courseId) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.quizzes(courseId) });
    queryClient.invalidateQueries({
      queryKey: queryKeys.quizzesWithQuestions(courseId),
    });
    queryClient.invalidateQueries({ queryKey: ["quiz-calendar", courseId] });
  };
}

function calendarGridRange(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const from = new Date(first);
  from.setDate(first.getDate() - mondayOffset);
  const to = new Date(from);
  to.setDate(from.getDate() + 42);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function useQuizCalendar(courseId, month, { enabled = true } = {}) {
  const { from, to } = calendarGridRange(month);
  const query = useQuery({
    queryKey: queryKeys.quizCalendar(courseId, from, to),
    queryFn: () =>
      api.get(
        `/api/quiz/course/${courseId}/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      ),
    enabled: !!courseId && enabled,
  });

  return {
    ...query,
    events: query.data?.events || [],
    unscheduledQuizzes: query.data?.unscheduledQuizzes || [],
  };
}

export function useCreateQuiz(courseId, options) {
  const invalidate = useInvalidateQuizzes(courseId);
  return useMutation({
    mutationFn: (payload) => api.post("/api/quiz", payload),
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

export function useUpdateQuiz(courseId, options) {
  const invalidate = useInvalidateQuizzes(courseId);
  return useMutation({
    mutationFn: ({ quizId, updates }) => api.put(`/api/quiz/${quizId}`, updates),
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

export function useDeleteQuiz(courseId, options) {
  const invalidate = useInvalidateQuizzes(courseId);
  return useMutation({
    mutationFn: (quizId) => api.delete(`/api/quiz/${quizId}`),
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

// Per-section release/expire schedule for one quiz (instructor editor).
export function useQuizSchedules(quizId, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: queryKeys.quizSchedules(quizId),
    queryFn: () => api.get(`/api/quiz/${quizId}/schedules`),
    enabled: !!quizId && enabled,
  });
  return { ...query, schedules: query.data?.schedules || [] };
}

// Replace a quiz's per-section schedule. `schedules` is an array of
// { courseSectionId, releaseDate, expireDate }.
export function useUpdateQuizSchedules(courseId, quizId, options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (schedules) =>
      api.put(`/api/quiz/${quizId}/schedules`, { schedules }),
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.quizSchedules(quizId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.quizzesWithQuestions(courseId) });
      queryClient.invalidateQueries({ queryKey: ["quiz-calendar", courseId] });
      options?.onSuccess?.(...args);
    },
  });
}

// Per-student scores for one quiz (instructor view).
export function useQuizScores(quizId) {
  const query = useQuery({
    queryKey: queryKeys.quizScores(quizId),
    queryFn: () => api.get(`/api/quiz/${quizId}/scores`),
    enabled: !!quizId,
  });

  return {
    ...query,
    scores: query.data?.success ? query.data.data || [] : [],
  };
}

// One student's recorded answers for a quiz (instructor review modal).
export function useQuizStudentAttempts(quizId, userId) {
  const query = useQuery({
    queryKey: queryKeys.quizStudentAttempts(quizId, userId),
    queryFn: async () => {
      const data = await api.get(`/api/quiz/${quizId}/student/${userId}/attempts`);
      if (!data.success || !data.data) {
        throw new Error("Could not fetch attempt data.");
      }
      return data.data;
    },
    enabled: !!quizId && !!userId,
  });

  return { ...query, attempts: query.data || [] };
}

// Manually grade one open-ended answer; resolves with the recomputed score.
export function useGradeAttempt(quizId, userId, options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ questionId, isCorrect }) => {
      const data = await api.put(`/api/quiz/${quizId}/student/${userId}/grade`, {
        questionId,
        isCorrect,
      });
      if (!data.success) throw new Error(data.error || "Grading failed");
      return data;
    },
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.quizStudentAttempts(quizId, userId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.quizScores(quizId) });
      options?.onSuccess?.(...args);
    },
  });
}
