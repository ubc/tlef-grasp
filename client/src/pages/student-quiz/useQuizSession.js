import { useRef, useState } from "react";
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

// The quiz window closes server-side. A client clock that still shows time
// remaining is not authoritative — it drifts, and a tab resumed from sleep can
// be minutes behind — so a 409 from /check is what actually ends the attempt.
const isExpiryError = (error) => error?.body?.code === "QUIZ_TIME_EXPIRED";

// Submitting is idempotent server-side (a duplicate score row is ignored), so a
// transient failure — flaky wifi, a worker restarting — is worth retrying before
// telling a student their result was not recorded. Delays before attempts 2 and 3.
const SUBMIT_RETRY_DELAYS_MS = [1000, 3000];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const [timeExpired, setTimeExpired] = useState(false);
  // Practice rounds re-attempt previously-wrong questions for learning only —
  // graded for feedback but never persisted, so they never touch the score.
  const [practiceMode, setPracticeMode] = useState(false);
  // Whether the graded attempt actually reached the server: "saving" while the
  // POST is in flight or retrying, "saved" once the score is recorded, "failed"
  // when every attempt failed. The completion screen shows the local tally as
  // provisional until this reads "saved", so a student is never told a score
  // that was never written.
  const [submitStatus, setSubmitStatus] = useState("idle");
  // Local tally for the current attempt, kept so a manual retry can resubmit
  // without recomputing from state that the completion screen has replaced.
  const localTallyRef = useRef(null);

  const reset = () => {
    setQuizData(null);
    setAnswers({});
    setFeedback({});
    setCompletion(null);
    setStartTime(null);
    setTimeExpired(false);
    setPracticeMode(false);
    setSubmitStatus("idle");
    localTallyRef.current = null;
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
        autoGraded: !!prev.aiGraded,
        criteria: prev.aiCriteria || null,
        questionType: prev.questionType,
        // Accept/deny reaction the student already recorded (issue #76).
        studentGradeReview: prev.studentGradeReview || null,
      };
    });
    return { restoredAnswers, restoredFeedback };
  };

  const startQuiz = async (quizId) => {
    setLoading(true);
    setCompletion(null);
    try {
      const [quizMeta, startData, questionsData] = await Promise.all([
        api.get(`/api/quiz/${quizId}`),
        api.post(`/api/student/quizzes/${quizId}/start`),
        api.get(`/api/student/quizzes/${quizId}/questions`, {
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        }),
      ]);

      if (!quizMeta.success || !startData.success || !questionsData.success) {
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
        startedAt: questionsData.data?.startedAt || startData.data?.startedAt,
        expiresAt: questionsData.data?.expiresAt || startData.data?.expiresAt,
        timeLimitMinutes:
          questionsData.data?.timeLimitMinutes || startData.data?.timeLimitMinutes || 60,
        questions,
      });
      setAnswers(restoredAnswers);
      setFeedback(restoredFeedback);
      setCurrentIndex(firstUnansweredIndex(questions, restoredFeedback));
      setStartTime(
        new Date(questionsData.data?.startedAt || startData.data?.startedAt).getTime()
      );
      // Only the first graded attempt counts; a student who already has a
      // recorded score is retaking for practice (ungraded, no score shown).
      setPracticeMode(questionsData.data?.alreadyCompleted === true);
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
      // A restart always follows a completed attempt, so it's practice.
      setPracticeMode(true);
      // The previous round's submit outcome no longer describes what's on
      // screen; a practice round has nothing to record.
      setSubmitStatus("idle");
      localTallyRef.current = null;
      // Drop any achievement toast lingering from the graded attempt — a
      // practice round earns nothing.
      setAchievementToasts([]);
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
      { ...body, practice: practiceMode },
      { credentials: "same-origin" }
    );
    if (!result.success) {
      throw new Error(result.error || "Could not check your answer.");
    }
    return result;
  };

  // Turn a failed /check into something the student can act on. A 409 means the
  // window closed while they were answering, so run the same expiry flow the
  // timer does rather than showing a bare error next to a still-live quiz.
  const describeCheckFailure = (error) => {
    if (isExpiryError(error)) {
      expireQuiz();
      return "Your time is up. Your saved answers have been submitted.";
    }
    return error.message || "Could not check your answer. Please try again.";
  };

  // Returns an error message when the check failed, null on success — the same
  // contract as submitTextAnswer, so the page surfaces both the same way.
  // Swallowing this used to read as a broken quiz: the option never
  // highlighted, no feedback appeared, and clicking again did nothing.
  const selectMcqAnswer = async (selectedIndex, rawKey, questionId) => {
    if (submitting || feedback[questionId]) return null;
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
          questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
        },
      }));
      return null;
    } catch (error) {
      console.error("Error evaluating answer:", error);
      return describeCheckFailure(error);
    } finally {
      setSubmitting(false);
    }
  };

  // Record the student's accept/deny reaction to an AI grade (issue #76). The
  // default is accept, so the UI treats a missing value as accepted; this is
  // only called when the student actively chooses. Optimistic: the button state
  // flips immediately, and reverts if the server rejects the change. Practice
  // answers are never persisted, so their grades are not reviewable.
  const submitGradeReview = async (questionId, review) => {
    if (practiceMode) return;
    const previous = feedback[questionId]?.studentGradeReview ?? null;
    if (previous === review) return;
    setFeedback((prev) => ({
      ...prev,
      [questionId]: { ...prev[questionId], studentGradeReview: review },
    }));
    try {
      const result = await api.put(
        `/api/quiz/${quizData.quizId}/question/${questionId}/grade-review`,
        { review }
      );
      if (!result.success) throw new Error(result.error || "Could not save your response.");
    } catch (error) {
      console.error("Error recording grade review:", error);
      setFeedback((prev) => ({
        ...prev,
        [questionId]: { ...prev[questionId], studentGradeReview: previous },
      }));
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
                autoGraded: !!result.autoGraded,
                criteria: result.criteria || null,
                questionType: type,
              }
            : {
                isCorrect: result.isCorrect,
                selectedAnswer: answerText,
                correctAnswer: result.correctAnswer,
                feedbackText: result.feedback,
                correctOptionText: result.correctOptionText,
                // A fill-in-the-blank rescued by the LLM fallback carries an AI
                // grade the student can accept/deny (issue #76); a plain
                // exact-match or a calculation answer does not.
                autoGraded: !!result.aiGraded,
                questionType: type,
              },
      }));
      return null;
    } catch (error) {
      console.error("Error evaluating answer:", error);
      return describeCheckFailure(error);
    } finally {
      setSubmitting(false);
    }
  };

  // Start a practice round over the questions answered incorrectly in the
  // just-finished round. Reuses the in-memory question objects (stem, options,
  // calculationToken) filtered to the wrong set — no refetch. Practice is
  // untimed and, via the `practice` flag on each check, never persisted.
  const startPracticeWrong = () => {
    if (!quizData) return;
    const wrong = quizData.questions.filter(
      (q) => feedback[q.id]?.isCorrect === false
    );
    if (wrong.length === 0) return;
    setQuizData((prev) => ({
      ...prev,
      questions: wrong,
      expiresAt: null,
      timeLimitMinutes: null,
    }));
    setAnswers({});
    setFeedback({});
    setCurrentIndex(0);
    setCompletion(null);
    setTimeExpired(false);
    setStartTime(Date.now());
    setPracticeMode(true);
    setSubmitStatus("idle");
    localTallyRef.current = null;
    // Drop any achievement toast lingering from the graded attempt.
    setAchievementToasts([]);
  };

  // POST the attempt and fold the server-authoritative result into the
  // completion screen. Throws if the score was not recorded.
  const postSubmission = async (tally) => {
    const timeSpent = startTime ? Date.now() - startTime : 0;
    const data = await api.post(`/api/student/quizzes/${quizData.quizId}/submit`, {
      timeSpent,
      sessionId: Date.now().toString(),
    });
    // A 200 carrying success:false is still a failure. The old code only
    // matched the happy shape and otherwise fell through silently, leaving the
    // local tally on screen as though it had been recorded.
    if (!data?.success || !data.data) {
      throw new Error(data?.message || data?.error || "Your score could not be recorded.");
    }

    const result = data.data;
    setCompletion({
      correct: result.correctAnswers ?? tally.correct,
      total: result.totalQuestions ?? tally.total,
      score: result.score !== undefined ? result.score : tally.score,
      openEndedCount: tally.openEndedCount,
      newAchievements: result.newAchievements || [],
    });
    if (result.newAchievements?.length) {
      setAchievementToasts(result.newAchievements);
      setTimeout(() => setAchievementToasts([]), 5500);
    }
  };

  const submitWithRetry = async (tally) => {
    setSubmitStatus("saving");
    for (let attempt = 0; ; attempt += 1) {
      try {
        await postSubmission(tally);
        setSubmitStatus("saved");
        return true;
      } catch (error) {
        console.error("Error submitting quiz:", error);
        // A 4xx will not fix itself on a retry; network failures and 5xx will.
        const retriable = !(error.status >= 400 && error.status < 500);
        if (!retriable || attempt >= SUBMIT_RETRY_DELAYS_MS.length) {
          setSubmitStatus("failed");
          return false;
        }
        await wait(SUBMIT_RETRY_DELAYS_MS[attempt]);
      }
    }
  };

  // Manual retry from the completion screen, for when the automatic attempts
  // all failed and the student is still on the page.
  const retrySubmit = async () => {
    if (!localTallyRef.current || submitStatus === "saving") return false;
    return submitWithRetry(localTallyRef.current);
  };

  // Show a locally-computed score immediately, then replace it with the
  // server-authoritative result (which also awards achievements). The local
  // figure is provisional until submitStatus reads "saved".
  const finishQuiz = async () => {
    // Open-ended questions count once the LLM judge graded them; only those
    // still awaiting manual grading (isCorrect null) are excluded from the
    // local score, mirroring the server's isCorrect !== null filter.
    const gradedQuestions = quizData.questions.filter(
      (q) =>
        q.questionType !== QUESTION_TYPES.OPEN_ENDED ||
        typeof feedback[q.id]?.isCorrect === "boolean"
    );
    const localTotal = gradedQuestions.length;
    const localCorrect = gradedQuestions.filter(
      (q) => feedback[q.id]?.isCorrect === true
    ).length;
    const localScore =
      localTotal > 0 ? Math.round((localCorrect / localTotal) * 100) : null;
    const openEndedCount = quizData.questions.length - localTotal;

    const tally = {
      correct: localCorrect,
      total: localTotal,
      score: localScore,
      openEndedCount,
    };

    setCompletion({ ...tally, newAchievements: [], practice: practiceMode });

    // Practice rounds are never submitted — no score write, no achievements.
    // The local tally above is all the student sees, and it is final.
    if (practiceMode) {
      setSubmitStatus("idle");
      return;
    }

    localTallyRef.current = tally;
    await submitWithRetry(tally);
  };

  const expireQuiz = () => {
    if (timeExpired || completion) return;
    setTimeExpired(true);
    finishQuiz();
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
    timeExpired,
    practiceMode,
    submitStatus,
    retrySubmit,
    startQuiz,
    restartQuiz,
    startPracticeWrong,
    selectMcqAnswer,
    submitTextAnswer,
    submitGradeReview,
    finishQuiz,
    expireQuiz,
    reset,
  };
}
