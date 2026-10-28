import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

// One class-level analytics view ("questions" | "quizzes" | "objectives") for
// a course, optionally narrowed to one quiz and/or one section. Empty filters
// mean "all".
function useAnalyticsView(view, courseId, { quizId = "", sectionId = "" } = {}) {
  const query = useQuery({
    queryKey: queryKeys.analytics(view, courseId, quizId, sectionId),
    queryFn: () => {
      const params = new URLSearchParams();
      if (quizId) params.set("quizId", quizId);
      if (sectionId) params.set("sectionId", sectionId);
      const search = params.toString();
      return api.get(
        `/api/analytics/course/${courseId}/${view}${search ? `?${search}` : ""}`
      );
    },
    enabled: !!courseId,
  });

  return { ...query, analytics: query.data?.success ? query.data.data : null };
}

export const useQuestionAnalytics = (courseId, filters) =>
  useAnalyticsView("questions", courseId, filters);

export const useQuizAnalytics = (courseId, filters) =>
  useAnalyticsView("quizzes", courseId, filters);

export const useObjectiveAnalytics = (courseId, filters) =>
  useAnalyticsView("objectives", courseId, filters);
