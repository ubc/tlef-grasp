import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { toStringId } from "../lib/utils";

// Published, currently-open quizzes for the student list view, enriched with
// per-quiz question counts, the user's achievements and completion state.
// The overview endpoint computes the personalized counts server-side.
export function useStudentQuizList(courseId) {
  const query = useQuery({
    queryKey: queryKeys.studentQuizList(courseId),
    queryFn: async () => {
      const [overviewData, achievementsData, scoresData] = await Promise.all([
        api.get(`/api/quiz/course/${courseId}/student-overview`),
        api.get(`/api/achievement/my?courseId=${courseId}`).catch(() => null),
        api.get(`/api/quiz/my-scores?courseId=${courseId}`).catch(() => null),
      ]);

      const userAchievements = achievementsData?.success
        ? achievementsData.data || []
        : [];
      const completedQuizIds = scoresData?.success
        ? scoresData.completedQuizIds || []
        : [];

      const quizzes = (overviewData.quizzes || []).map((quiz) => {
        const quizId = toStringId(quiz._id || quiz.id);
        return {
          ...quiz,
          id: quizId,
          achievements: userAchievements.filter(
            (a) => toStringId(a.quizId) === quizId
          ),
        };
      });

      return { quizzes, completedQuizIds };
    },
    enabled: !!courseId,
  });

  return {
    ...query,
    quizzes: query.data?.quizzes || [],
    completedQuizIds: query.data?.completedQuizIds || [],
  };
}

// A completed quiz's results for the student summary page.
export function useStudentQuizResults(quizId) {
  const query = useQuery({
    queryKey: queryKeys.studentQuizResults(quizId),
    queryFn: () => api.get(`/api/student/quizzes/${quizId}/results`),
    enabled: !!quizId,
  });

  return {
    ...query,
    summary: query.data?.success ? query.data.data : null,
  };
}
