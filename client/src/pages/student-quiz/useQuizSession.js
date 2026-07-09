import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { QUESTION_TYPES } from "../../lib/constants";

// Where to resume a restored attempt: the first question without recorded
// feedback, or the last question when everything is already answered.
export function firstUnansweredIndex(questions = [], feedback = {}) {
  if (questions.length === 0) return 0;
  const index = questions.findIndex((q) => !feedback[q.id]);
  return index === -1 ? questions.length - 1 : index;
}

// State machine for taking a quiz: loading questions (with draft restoration),
// checking answers against the server, navigation and final submission.
export function useQuizSession({ onLoadError } = {}) {
  const queryClient = useQueryClient();

  const [quizData, setQuizData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [feedback, setFeedback] = useState({});
  const [startTime, setStartTime] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [completion, setCompletion] = useState(null);
  const [achievementToasts, setAchievementToasts] = useState([]);

  const reset = () => {
    setQuizData(null);
    setAnswers({});
    setFeedback({});
    setCompletion(null);
    setStartTime(null);
    queryClient.invalidateQueries({ queryKey: ["student-quiz-list"] });
  };

  // Server-recorded answers from a previous partial attempt -> local state
  const restorePreviousAnswers = (previousAnswers) => {
    const restoredAnswers = {};
    const restoredFeedback = {};
    Object.entries(previousAnswers).forEach(([qid, prev]) => {
      if (prev.questionType === QUESTION_TYPES.MULTIPLE_CHOICE) {
        if (prev.selectedIndex !== undefined && prev.selectedIndex >= 0) {
          restoredAnswers[qid] = prev.selectedIndex;
        }
      } else {
        restoredAnswers[qid] = prev.selectedAnswer;
      }
      restoredFeedback[qid] = {
        isCorrect: prev.isCorrect,
        selectedAnswer:
          prev.questionType === QUESTION_TYPES.MULTIPLE_CHOICE
            ? prev.selectedIndex
            : prev.selectedAnswer,
        selectedKey: prev.selectedAnswer,
        correctAnswer: prev.correctAnswer || null,
        correctOptionText: prev.correctOptionText || null,
        feedbackText: prev.feedbackText || "",
        openEnded: prev.questionType === QUESTION_TYPES.OPEN_ENDED,
        sampleAnswer: prev.sampleAnswer || null,
        gradingCriteria: prev.gradingCriteria || null,
        questionType: prev.questionType,
      };
    });
    return { restoredAnswers, restoredFeedback };
  };

  const startQuiz = async (quizId) => {
    setLoading(true);
    setCompletion(null);
    try {
      const [quizMeta, questionsData] = await Promise.all([
        api.get(`/api/quiz/${quizId}`),
        api.get(`/api/student/quizzes/${quizId}/questions`, {
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        }),
      ]);

      if (!quizMeta.success || !questionsData.success) {
        throw new Error(
          questionsData.message || quizMeta.message || "Failed to load quiz"
        );
      }

      const { restoredAnswers, restoredFeedback } = restorePreviousAnswers(
        questionsData.data?.previousAnswers || {}
      );

      const questions = questionsData.data?.questions || [];
      setQuizData({
        quizId,
        title: quizMeta.quiz ? quizMeta.quiz.name : "Quiz",
        course: questionsData.data?.course || "Course",
        disablePreviousNavigation:
          questionsData.data?.disablePreviousNavigation === true ||
          quizMeta.quiz?.disablePreviousNavigation === true,
        questions,
      });
      setAnswers(restoredAnswers);
      setFeedback(restoredFeedback);
      setCurrentIndex(firstUnansweredIndex(questions, restoredFeedback));
      setStartTime(Date.now());
      return true;
    } catch (error) {
      console.error("Error starting quiz:", error);
      onLoadError?.(`Failed to load quiz: ${error.message}`);
      reset();
      return false;
    } finally {
      setLoading(false);
    }
  };

  const restartQuiz = async () => {
    if (!quizData) return;
    setCompletion(null);
    setLoading(true);
    try {
      const data = await api.get(
        `/api/quiz/${quizData.quizId}/questions?approvedOnly=true&_t=${Date.now()}`,
        { headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } }
      );
      if (!data.success || !data.questions) {
        throw new Error("Failed to load questions for retake");
      }
      setQuizData((prev) => ({ ...prev, questions: data.questions }));
      setAnswers({});
      setFeedback({});
      setCurrentIndex(0);
      setStartTime(Date.now());
    } catch (error) {
      console.error("Error fetching quiz questions for retake:", error);
      onLoadError?.("Could not start quiz retake. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const checkAnswer = async (questionId, body) => {
    const result = await api.post(
      `/api/quiz/${quizData.quizId}/question/${questionId}/check`,
      body,
      { credentials: "same-origin" }
    );
    if (!result.success) {
      throw new Error(result.error || "Could not check your answer.");
    }
    return result;
  };

  const selectMcqAnswer = async (selectedIndex, rawKey, questionId) => {
    if (submitting || feedback[questionId]) return;
    setSubmitting(true);
    try {
      const result = await checkAnswer(questionId, { selectedIndex });
      setAnswers((prev) => ({ ...prev, [questionId]: selectedIndex }));
      setFeedback((prev) => ({
        ...prev,
        [questionId]: {
          isCorrect: result.isCorrect,
          selectedAnswer: selectedIndex,
          selectedKey: rawKey,
          correctAnswer: result.correctAnswer,
          feedbackText: result.feedback,
          correctOptionText: result.correctOptionText,
        },
      }));
    } catch (error) {
      console.error("Error evaluating answer:", error);
    } finally {
      setSubmitting(false);
    }
  };

  // Returns an error message instead of submitting when validation fails.
  const submitTextAnswer = async (question, rawValue) => {
    const questionId = question.id;
    const answerText = rawValue.trim();
    const type = question.questionType;

    if (!answerText) {
      return type === QUESTION_TYPES.OPEN_ENDED
        ? "Please write an answer before submitting."
        : type === QUESTION_TYPES.CALCULATION
          ? "Please enter a numeric answer before submitting."
          : "Please type an answer before submitting.";
    }
    if (type === QUESTION_TYPES.CALCULATION && !question.calculationToken) {
      return "Missing calculation data. Please reload the quiz.";
    }

    setSubmitting(true);
    try {
      const body =
        type === QUESTION_TYPES.CALCULATION
          ? { answerText, calculationToken: question.calculationToken }
          : { answerText };
      const result = await checkAnswer(questionId, body);

      setAnswers((prev) => ({ ...prev, [questionId]: answerText }));
      setFeedback((prev) => ({
        ...prev,
        [questionId]:
          type === QUESTION_TYPES.OPEN_ENDED
            ? {
                isCorrect: result.isCorrect,
                openEnded: true,
                selectedAnswer: answerText,
                sampleAnswer: result.sampleAnswer,
                gradingCriteria: result.gradingCriteria,
                feedbackText: result.feedback,
                questionType: type,
              }
            : {
                isCorrect: result.isCorrect,
                selectedAnswer: answerText,
                correctAnswer: result.correctAnswer,
                feedbackText: result.feedback,
                correctOptionText: result.correctOptionText,
                questionType: type,
              },
      }));
      return null;
    } catch (error) {
      console.error("Error evaluating answer:", error);
      return error.message || "Could not check your answer. Please try again.";
    } finally {
      setSubmitting(false);
    }
  };

  // Show a locally-computed score immediately, then replace it with the
  // server-authoritative result (which also awards achievements).
  const finishQuiz = async () => {
    const gradedQuestions = quizData.questions.filter(
      (q) => q.questionType !== QUESTION_TYPES.OPEN_ENDED
    );
    const localTotal = gradedQuestions.length;
    const localCorrect = gradedQuestions.filter(
      (q) => feedback[q.id]?.isCorrect === true
    ).length;
    const localScore =
      localTotal > 0 ? Math.round((localCorrect / localTotal) * 100) : null;
    const openEndedCount = quizData.questions.length - localTotal;

    setCompletion({
      correct: localCorrect,
      total: localTotal,
      score: localScore,
      openEndedCount,
      newAchievements: [],
    });

    try {
      const timeSpent = startTime ? Date.now() - startTime : 0;
      const data = await api.post(`/api/student/quizzes/${quizData.quizId}/submit`, {
        timeSpent,
        sessionId: Date.now().toString(),
      });
      if (data.success && data.data) {
        const result = data.data;
        setCompletion({
          correct: result.correctAnswers ?? localCorrect,
          total: result.totalQuestions ?? localTotal,
          score: result.score !== undefined ? result.score : localScore,
          openEndedCount,
          newAchievements: result.newAchievements || [],
        });
        if (result.newAchievements?.length) {
          setAchievementToasts(result.newAchievements);
          setTimeout(() => setAchievementToasts([]), 5500);
        }
      }
    } catch (error) {
      console.error("Error submitting quiz:", error);
    }
  };

  return {
    quizData,
    loading,
    currentIndex,
    setCurrentIndex,
    answers,
    feedback,
    submitting,
    completion,
    achievementToasts,
    startTime,
    startQuiz,
    restartQuiz,
    selectMcqAnswer,
    submitTextAnswer,
    finishQuiz,
    reset,
  };
}
