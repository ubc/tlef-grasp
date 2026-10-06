import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lmsRequest } from "../lib/lmsApi";
import { queryKeys } from "../lib/queryKeys";
import { markCanvasDisconnected } from "./useCanvasIntegration";

// Canvas assignments for scheduled quizzes (issue #125).

const quizBase = (courseId, quizId) =>
  `/api/lms/canvas/courses/${encodeURIComponent(courseId)}/quizzes/${encodeURIComponent(quizId)}/assignments`;

const jsonBody = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// Each of the instructor's sections for one quiz: linked, scheduled, and what
// Canvas holds (see the server's listQuizAssignments).
export function useQuizCanvasAssignments(courseId, quizId, { enabled = true } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.canvasQuizAssignments(courseId, quizId),
    queryFn: async () => {
      try {
        return await lmsRequest(quizBase(courseId, quizId));
      } catch (error) {
        markCanvasDisconnected(queryClient, error);
        throw error;
      }
    },
    enabled: !!courseId && !!quizId && enabled,
    retry: false,
  });
  return { ...query, sections: query.data?.sections || [] };
}

function useRefreshAssignments(courseId, quizId) {
  const queryClient = useQueryClient();
  return (data) => {
    if (data?.sections) {
      queryClient.setQueryData(queryKeys.canvasQuizAssignments(courseId, quizId), {
        success: true,
        sections: data.sections,
      });
    }
    queryClient.invalidateQueries({ queryKey: ["canvas", "section-quiz-assignments", courseId] });
  };
}

// Make Canvas match GRASP for these sections: create the assignment where the
// instructor accepted, move the due date where the schedule changed. Resolves
// with { results: [{ courseSectionId, status, error? }], sections }.
export function useEnsureQuizCanvasAssignments(courseId, quizId, options) {
  const queryClient = useQueryClient();
  const refresh = useRefreshAssignments(courseId, quizId);
  return useMutation({
    mutationFn: (courseSectionIds) =>
      lmsRequest(quizBase(courseId, quizId), jsonBody("POST", { courseSectionIds })),
    ...options,
    onSuccess: (data, ...rest) => {
      refresh(data);
      options?.onSuccess?.(data, ...rest);
    },
    onError: (error, ...rest) => {
      markCanvasDisconnected(queryClient, error);
      options?.onError?.(error, ...rest);
    },
  });
}

// Remember that the instructor does not want assignments for these sections.
export function useDeclineQuizCanvasAssignments(courseId, quizId, options) {
  const queryClient = useQueryClient();
  const refresh = useRefreshAssignments(courseId, quizId);
  return useMutation({
    mutationFn: (courseSectionIds) =>
      lmsRequest(`${quizBase(courseId, quizId)}/declined`, jsonBody("PUT", { courseSectionIds })),
    ...options,
    onSuccess: (data, ...rest) => {
      refresh(data);
      options?.onSuccess?.(data, ...rest);
    },
    onError: (error, ...rest) => {
      markCanvasDisconnected(queryClient, error);
      options?.onError?.(error, ...rest);
    },
  });
}

// The quizzes scheduled on one section and whether each has an assignment:
// what to ask about right after the section is linked.
export function useSectionQuizAssignments(courseId, sectionId, { enabled = true } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.canvasSectionQuizAssignments(courseId, sectionId),
    queryFn: async () => {
      try {
        return await lmsRequest(
          `/api/lms/canvas/courses/${encodeURIComponent(courseId)}/sections/${encodeURIComponent(sectionId)}/quiz-assignments`
        );
      } catch (error) {
        markCanvasDisconnected(queryClient, error);
        throw error;
      }
    },
    enabled: !!courseId && !!sectionId && enabled,
    retry: false,
    staleTime: 0,
  });
  return { ...query, quizzes: query.data?.quizzes || [], section: query.data?.section || null };
}

// After linking: create (or decline) the assignment of several quizzes on one
// section, one request per quiz so one failure does not stop the others.
// Resolves with { results: [{ quizId, status, error? }] }.
export function useEnsureSectionQuizAssignments(courseId, options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ courseSectionId, quizIds, action }) => {
      const results = [];
      for (const quizId of quizIds) {
        try {
          const data =
            action === "decline"
              ? await lmsRequest(`${quizBase(courseId, quizId)}/declined`, jsonBody("PUT", { courseSectionIds: [courseSectionId] }))
              : await lmsRequest(quizBase(courseId, quizId), jsonBody("POST", { courseSectionIds: [courseSectionId] }));
          const result = data.results?.find((r) => r.courseSectionId === courseSectionId);
          results.push({ quizId, status: action === "decline" ? "declined" : result?.status || "unchanged", error: result?.error });
          queryClient.setQueryData(queryKeys.canvasQuizAssignments(courseId, quizId), { success: true, sections: data.sections });
        } catch (error) {
          markCanvasDisconnected(queryClient, error);
          results.push({ quizId, status: "failed", error: error.message });
          // The token was refused: every later request would fail the same way.
          if (error.body?.connected === false) break;
        }
      }
      return { results };
    },
    ...options,
    onSuccess: (data, variables, ...rest) => {
      queryClient.invalidateQueries({ queryKey: ["canvas", "section-quiz-assignments", courseId] });
      options?.onSuccess?.(data, variables, ...rest);
    },
  });
}
