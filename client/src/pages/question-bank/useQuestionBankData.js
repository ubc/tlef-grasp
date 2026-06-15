import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";
import { toStringId, getObjectId, normalizeQuestionTypeKey } from "../../lib/utils";

// Questions for the course enriched with objective names and quiz membership
// (port of legacy loadQuestionsForOverview + loadQuizRelationships).
export function useQuestionBankData(courseId) {
  const query = useQuery({
    queryKey: queryKeys.questionBank(courseId),
    queryFn: async () => {
      const data = await api.get(`/api/question?courseId=${courseId}`);
      const questions = (data.success ? data.questions || [] : []).map((question) => {
        const objectiveId = toStringId(question.learningObjectiveId) || null;
        return {
          id: getObjectId(question),
          title: question.title || question.stem || "",
          stem: question.stem || question.title || "",
          objectiveId,
          glo: objectiveId || "",
          bloom: question.bloom || question.bloomLevel || "Understand",
          questionType: normalizeQuestionTypeKey(question.questionType || question.type),
          calculationFormula: question.calculationFormula,
          flagged: question.flagStatus || false,
          published: question.published || false,
          status: question.status || "Draft",
          quizId: question.quizId ? toStringId(question.quizId) : null,
          quizName: null,
          isInPublishedQuiz: false,
        };
      });

      // Objective names
      const objectivesMap = new Map();
      try {
        const objData = await api.get(`/api/objective?courseId=${courseId}`);
        if (objData.success && objData.objectives) {
          objData.objectives.forEach((objective) => {
            objectivesMap.set(
              getObjectId(objective),
              objective.name || "Unnamed Objective"
            );
          });
        }
      } catch {
        // Objective names degrade to raw ids
      }
      questions.forEach((question) => {
        if (question.objectiveId && objectivesMap.has(question.objectiveId)) {
          question.glo = objectivesMap.get(question.objectiveId);
        }
      });

      // Quiz membership (batched endpoint: quizzes arrive with their questions)
      let quizzes = [];
      try {
        const quizzesData = await api.get(
          `/api/quiz/course/${courseId}/with-questions`
        );
        if (quizzesData.success && quizzesData.quizzes) {
          quizzes = quizzesData.quizzes;
          quizzes.forEach((quiz) => {
            const ids = new Set((quiz.questions || []).map(getObjectId));
            questions.forEach((question) => {
              if (ids.has(question.id)) {
                question.quizId = getObjectId(quiz);
                question.quizName = quiz.name;
                question.isInPublishedQuiz = quiz.published || false;
              }
            });
          });
        }
      } catch {
        // No quiz relationships available
      }

      return {
        questions,
        quizzes,
        objectives: Array.from(objectivesMap, ([id, name]) => ({ id, name })),
      };
    },
    enabled: !!courseId,
  });

  return {
    ...query,
    questions: query.data?.questions || [],
    quizzes: query.data?.quizzes || [],
    objectives: query.data?.objectives || [],
  };
}
