import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { QUESTION_TYPES } from "../lib/constants";
import { useAppStore } from "../stores/appStore";
import { useCurrentUser } from "../hooks/useCurrentUser";
import RichText from "../components/RichText";

const toStringId = (id) => (id == null ? "" : String(id));

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

/* ------------------------------ List view ------------------------------ */

function QuizListCard({ quiz, completed, onStart }) {
  const hasPerfect = quiz.achievements.some((a) => a.type === "quiz_perfect");
  const disabled = !quiz.questionCount;

  return (
    <div className="flex flex-col rounded-2xl bg-white p-6 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold text-ink">{quiz.name || "Unnamed Quiz"}</h3>
        <div className="flex gap-1.5">
          {completed && (
            <span
              title="Quiz Completed"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-green-100 text-green-600"
            >
              <i className="fas fa-check-circle text-sm" />
            </span>
          )}
          {hasPerfect && (
            <span
              title="Perfect Score"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-yellow-100 text-yellow-600"
            >
              <i className="fas fa-star text-sm" />
            </span>
          )}
        </div>
      </div>

      <p className="mb-3 text-sm text-muted">
        {quiz.description || "No description available"}
      </p>

      <div className="mb-3 space-y-1.5 text-sm text-muted">
        <div>
          <i className="fas fa-calendar-alt mr-1.5" />
          Released:{" "}
          {quiz.releaseDate ? new Date(quiz.releaseDate).toLocaleDateString() : "Not set"}
        </div>
        {quiz.expireDate && (
          <div className="text-warning">
            <i className="fas fa-clock mr-1.5" />
            Due: {new Date(quiz.expireDate).toLocaleDateString()}
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-xs font-medium">
        {quiz.deliveryFormat === "spaced-3phase" ? (
          <>
            <span
              title="One question per granular learning objective"
              className="rounded-full bg-blue-100 px-2.5 py-1 text-blue-700"
            >
              <i className="fas fa-book mr-1" /> {quiz.phase1Count || 0} New
            </span>
            <span
              title="Remediation Questions"
              className="rounded-full bg-orange-100 px-2.5 py-1 text-orange-700"
            >
              <i className="fas fa-fire-alt mr-1" /> {quiz.phase2Count || 0} Remediation
            </span>
            <span
              title="Spaced Learning Questions"
              className="rounded-full bg-purple-100 px-2.5 py-1 text-purple-700"
            >
              <i className="fas fa-history mr-1" /> {quiz.phase3Count || 0} Review
            </span>
          </>
        ) : (
          <span
            title="Total Questions"
            className="rounded-full bg-blue-100 px-2.5 py-1 text-blue-700"
          >
            <i className="fas fa-list-ol mr-1" /> {quiz.questionCount || 0} Question
            {(quiz.questionCount || 0) === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {(completed || hasPerfect) && (
        <div className="mb-4 flex flex-wrap gap-3 text-xs font-medium">
          {completed && (
            <span className="text-green-600">
              <i className="fas fa-check-circle mr-1" /> Completed
            </span>
          )}
          {hasPerfect && (
            <span className="text-yellow-600">
              <i className="fas fa-star mr-1" /> Perfect Score
            </span>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={onStart}
        className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        <i className="fas fa-play" />
        {completed ? "Retake Quiz" : "Start Quiz"}
      </button>
    </div>
  );
}

function QuizList({ onStart }) {
  const selectedCourse = useAppStore((state) => state.selectedCourse);
  const courseId = selectedCourse?.id;

  const listQuery = useQuery({
    queryKey: ["student-quiz-list", courseId],
    queryFn: async () => {
      const [quizzesData, achievementsData, scoresData] = await Promise.all([
        api.get(`/api/quiz/course/${courseId}`),
        api.get(`/api/achievement/my?courseId=${courseId}`).catch(() => null),
        api.get(`/api/quiz/my-scores?courseId=${courseId}`).catch(() => null),
      ]);

      const userAchievements = achievementsData?.success ? achievementsData.data || [] : [];
      const completedQuizIds = scoresData?.success
        ? scoresData.completedQuizIds || []
        : [];

      const now = new Date();
      const published = (quizzesData.quizzes || []).filter((quiz) => {
        if (quiz.published !== true) return false;
        if (quiz.releaseDate && new Date(quiz.releaseDate) > now) return false;
        if (quiz.expireDate && new Date(quiz.expireDate) < now) return false;
        return true;
      });

      const quizzes = await Promise.all(
        published.map(async (quiz) => {
          const quizId = toStringId(quiz._id || quiz.id);
          let questions = [];
          try {
            const qData = await api.get(
              `/api/quiz/${quizId}/questions?approvedOnly=true`
            );
            if (qData.success) questions = qData.questions || [];
          } catch {
            // Count stays 0 when questions fail to load
          }
          return {
            ...quiz,
            id: quizId,
            questionCount: questions.length,
            phase1Count: questions.filter((q) => q.phase === 1).length,
            phase2Count: questions.filter((q) => q.phase === 2).length,
            phase3Count: questions.filter((q) => q.phase === 3).length,
            achievements: userAchievements.filter(
              (a) => toStringId(a.quizId) === quizId
            ),
          };
        })
      );

      return { quizzes, completedQuizIds };
    },
    enabled: !!courseId,
  });

  const quizzes = listQuery.data?.quizzes || [];
  const completedQuizIds = listQuery.data?.completedQuizIds || [];
  const pending = quizzes.filter(
    (q) => !q.achievements.some((a) => a.type === "quiz_completed")
  );
  const completed = quizzes.filter((q) =>
    q.achievements.some((a) => a.type === "quiz_completed")
  );

  return (
    <div className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-bold text-ink">Available Quizzes</h1>
      <p className="mb-6 text-muted">{selectedCourse?.name || "Unknown Course"}</p>

      {!courseId ? (
        <EmptyQuizState message="No course selected. Please select a course first." />
      ) : listQuery.isPending ? (
        <div className="py-16 text-center text-muted">
          <i className="fas fa-spinner fa-spin mb-3 text-2xl" />
          <p>Loading quizzes...</p>
        </div>
      ) : listQuery.isError ? (
        <EmptyQuizState message="Error loading quizzes. Please try again." />
      ) : quizzes.length === 0 ? (
        <EmptyQuizState message="No published quizzes available for this course." />
      ) : (
        <div className="space-y-10">
          {pending.length > 0 && (
            <section>
              <h2 className="mb-4 text-lg font-semibold text-ink">Pending Quizzes</h2>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                {pending.map((quiz) => (
                  <QuizListCard
                    key={quiz.id}
                    quiz={quiz}
                    completed={completedQuizIds.includes(quiz.id)}
                    onStart={() => onStart(quiz.id)}
                  />
                ))}
              </div>
            </section>
          )}
          {completed.length > 0 && (
            <section>
              <h2 className="mb-4 text-lg font-semibold text-ink">Completed Quizzes</h2>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                {completed.map((quiz) => (
                  <QuizListCard
                    key={quiz.id}
                    quiz={quiz}
                    completed={completedQuizIds.includes(quiz.id)}
                    onStart={() => onStart(quiz.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyQuizState({ message }) {
  return (
    <div className="rounded-2xl bg-white py-16 text-center shadow-sm">
      <i className="fas fa-clipboard-list mb-4 text-4xl text-gray-300" />
      <h3 className="text-lg font-semibold text-ink">No Quizzes Available</h3>
      <p className="mt-1 text-muted">{message}</p>
    </div>
  );
}

/* ----------------------------- Quiz taking ----------------------------- */

function Timer({ startTime }) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const totalSeconds = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");

  return (
    <span>
      <i className="fas fa-clock mr-1" />
      {minutes}:{seconds}
    </span>
  );
}

function TextAnswerInput({
  question,
  saved,
  feedback,
  onSubmit,
  submitting,
  multiline = false,
  placeholder,
  hint,
}) {
  const [value, setValue] = useState(typeof saved === "string" ? saved : "");
  const answered = !!feedback;

  // Sync when navigating between questions
  useEffect(() => {
    setValue(typeof saved === "string" ? saved : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  const borderClass = !answered
    ? "border-gray-200"
    : feedback.openEnded || feedback.isCorrect === null
      ? "border-primary/50 bg-primary/5"
      : feedback.isCorrect
        ? "border-success/60 bg-success/5"
        : "border-danger/60 bg-danger/5";

  const InputTag = multiline ? "textarea" : "input";

  return (
    <div className={`rounded-xl border-2 p-5 ${borderClass}`}>
      <label
        htmlFor={`answer-${question.id}`}
        className="mb-2 block text-sm font-semibold text-ink"
      >
        {multiline ? "Your response" : "Your answer"}
      </label>
      <InputTag
        id={`answer-${question.id}`}
        type={multiline ? undefined : "text"}
        rows={multiline ? 6 : undefined}
        inputMode={hint === "calc" ? "decimal" : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        disabled={answered || submitting}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (!multiline || event.ctrlKey || event.metaKey)
          ) {
            event.preventDefault();
            if (!answered && !submitting) onSubmit(value);
          }
        }}
        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-primary focus:outline-none disabled:bg-gray-50"
      />
      <button
        type="button"
        disabled={answered || submitting}
        onClick={() => onSubmit(value)}
        className="mt-3 rounded-lg bg-primary px-5 py-2 font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
      >
        {submitting ? "Checking..." : "Submit answer"}
      </button>
    </div>
  );
}

function FeedbackPanel({ feedback }) {
  if (!feedback) return null;

  // Open-ended: not auto-graded — show sample answer and criteria
  if (
    feedback.openEnded ||
    (feedback.questionType === QUESTION_TYPES.OPEN_ENDED && feedback.isCorrect === null)
  ) {
    const sample = feedback.sampleAnswer != null ? String(feedback.sampleAnswer).trim() : "";
    const criteria =
      feedback.gradingCriteria != null ? String(feedback.gradingCriteria).trim() : "";
    return (
      <div className="mt-5 rounded-xl border border-primary/30 bg-primary/5 p-5">
        <div className="mb-2 font-semibold text-ink">
          <i className="fas fa-clipboard-check mr-2 text-primary" />
          Response submitted
        </div>
        <p className="text-sm text-gray-600">
          Your answer was not auto-graded. Compare your response to the sample answer
          and criteria below.
        </p>
        {sample && (
          <div className="mt-3">
            <div className="text-sm font-semibold text-ink">Sample answer</div>
            <RichText
              text={escapeHtml(sample)}
              className="mt-1 text-sm whitespace-pre-wrap text-gray-600"
            />
          </div>
        )}
        {criteria && (
          <div className="mt-3">
            <div className="text-sm font-semibold text-ink">Grading criteria</div>
            <RichText
              text={escapeHtml(criteria)}
              className="mt-1 text-sm whitespace-pre-wrap text-gray-600"
            />
          </div>
        )}
      </div>
    );
  }

  if (feedback.isCorrect) {
    return (
      <div className="mt-5 rounded-xl border border-success/40 bg-success/5 p-5">
        <div className="font-semibold text-success">
          <i className="fas fa-check-circle mr-2" />
          Correct!
        </div>
        {feedback.feedbackText && (
          <RichText
            text={escapeHtml(feedback.feedbackText)}
            className="mt-2 text-sm text-gray-600"
          />
        )}
      </div>
    );
  }

  const isTextType =
    feedback.questionType === QUESTION_TYPES.FILL_IN_THE_BLANK ||
    feedback.questionType === QUESTION_TYPES.CALCULATION;
  const reveal =
    isTextType &&
    feedback.correctOptionText != null &&
    String(feedback.correctOptionText).trim() !== "";

  return (
    <div className="mt-5 rounded-xl border border-danger/40 bg-danger/5 p-5">
      <div className="font-semibold text-danger">
        <i className="fas fa-times-circle mr-2" />
        Incorrect.
      </div>
      {reveal && (
        <RichText
          text={`The correct answer is ${escapeHtml(String(feedback.correctOptionText).trim())}.`}
          className="mt-2 text-sm text-gray-600"
        />
      )}
      {feedback.feedbackText && (
        <RichText
          text={escapeHtml(feedback.feedbackText)}
          className="mt-2 text-sm text-gray-600"
        />
      )}
    </div>
  );
}

export default function StudentQuiz() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { role } = useCurrentUser();

  const [view, setView] = useState(searchParams.get("quiz") ? "quiz" : "list");
  const [quizData, setQuizData] = useState(null);
  const [loadingQuiz, setLoadingQuiz] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [feedback, setFeedback] = useState({});
  const [startTime, setStartTime] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [completion, setCompletion] = useState(null);
  const [achievementToasts, setAchievementToasts] = useState([]);
  const startedRef = useRef(false);

  const startQuiz = async (quizId) => {
    setView("quiz");
    setLoadingQuiz(true);
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

      const restoredAnswers = {};
      const restoredFeedback = {};
      const prevAnswers = questionsData.data?.previousAnswers || {};
      Object.entries(prevAnswers).forEach(([qid, prev]) => {
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

      setQuizData({
        quizId,
        title: quizMeta.quiz ? quizMeta.quiz.name : "Quiz",
        course: questionsData.data?.course || "Course",
        questions: questionsData.data?.questions || [],
      });
      setAnswers(restoredAnswers);
      setFeedback(restoredFeedback);
      setCurrentIndex(0);
      setStartTime(Date.now());

      // Clear URL params to prevent re-loading on refresh
      if (searchParams.get("quiz")) setSearchParams({}, { replace: true });
    } catch (error) {
      console.error("Error starting quiz:", error);
      alert("Failed to load quiz: " + error.message);
      backToList();
    } finally {
      setLoadingQuiz(false);
    }
  };

  // Auto-start from ?quiz= URL param
  useEffect(() => {
    const quizId = searchParams.get("quiz");
    if (quizId && !startedRef.current) {
      startedRef.current = true;
      startQuiz(quizId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const backToList = () => {
    setView("list");
    setQuizData(null);
    setAnswers({});
    setFeedback({});
    setCompletion(null);
    setStartTime(null);
    queryClient.invalidateQueries({ queryKey: ["student-quiz-list"] });
  };

  const restartQuiz = async () => {
    if (!quizData) return;
    setCompletion(null);
    setLoadingQuiz(true);
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
      alert("Could not start quiz retake. Please try again.");
    } finally {
      setLoadingQuiz(false);
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

  const submitTextAnswer = async (question, rawValue) => {
    const questionId = question.id;
    const answerText = rawValue.trim();
    const type = question.questionType;

    if (!answerText) {
      alert(
        type === QUESTION_TYPES.OPEN_ENDED
          ? "Please write an answer before submitting."
          : type === QUESTION_TYPES.CALCULATION
            ? "Please enter a numeric answer before submitting."
            : "Please type an answer before submitting."
      );
      return;
    }
    if (type === QUESTION_TYPES.CALCULATION && !question.calculationToken) {
      alert("Missing calculation data. Please reload the quiz.");
      return;
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
    } catch (error) {
      console.error("Error evaluating answer:", error);
      alert(error.message || "Could not check your answer. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const showCompletion = async () => {
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

    // Submit to backend for authoritative score + achievements
    try {
      const timeSpent = startTime ? Date.now() - startTime : 0;
      const data = await api.post(
        `/api/student/quizzes/${quizData.quizId}/submit`,
        { timeSpent, sessionId: Date.now().toString() }
      );
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

  if (view === "list") {
    return <QuizList onStart={startQuiz} />;
  }

  /* Quiz-taking view */
  if (loadingQuiz || !quizData) {
    return (
      <div className="flex flex-col items-center justify-center p-24 text-muted">
        <i className="fas fa-spinner fa-spin mb-5 text-5xl text-primary" />
        <p className="text-lg">Loading quiz...</p>
      </div>
    );
  }

  const question = quizData.questions[currentIndex];
  const questionId = question?.id;
  const questionFeedback = feedback[questionId];
  const hasAnswer = answers[questionId] !== undefined;
  const calcBroken =
    question?.questionType === QUESTION_TYPES.CALCULATION &&
    question?.calculationLoadError;
  const isLast = currentIndex === quizData.questions.length - 1;
  const isPrivileged = role === "administrator" || role === "faculty";

  if (completion) {
    const { correct, total, score, openEndedCount, newAchievements } = completion;
    const hasPerfectBadge = score === 100 && total > 0;
    return (
      <div className="mx-auto max-w-2xl p-8">
        <div className="rounded-2xl bg-white p-10 text-center shadow-sm">
          <i className="fas fa-trophy mb-4 text-5xl text-warning" />
          <h2 className="text-2xl font-bold text-ink">Quiz Complete!</h2>
          <p className="mt-1 text-muted">You have completed all questions.</p>

          <div className="my-8 grid grid-cols-3 gap-4">
            <div className="rounded-xl bg-page p-4">
              <div className="text-sm text-muted">Correct Answers:</div>
              <div className="text-2xl font-bold text-ink">{correct}</div>
            </div>
            <div className="rounded-xl bg-page p-4">
              <div className="text-sm text-muted">Total Questions:</div>
              <div className="text-2xl font-bold text-ink">{total}</div>
            </div>
            <div className="rounded-xl bg-page p-4">
              <div className="text-sm text-muted">Score:</div>
              <div className="text-2xl font-bold text-ink">
                {score === null ? (openEndedCount > 0 ? "—" : "0%") : `${score}%`}
              </div>
            </div>
          </div>

          {(newAchievements.length > 0 || hasPerfectBadge) && (
            <div className="mb-8 inline-flex items-center gap-2 rounded-full bg-warning/15 px-5 py-2.5 font-semibold text-warning">
              {newAchievements.length === 1 ? (
                <>
                  <i className={newAchievements[0].icon || "fas fa-trophy"} />
                  <span>{newAchievements[0].title}</span>
                </>
              ) : newAchievements.length > 1 ? (
                <>
                  <i className="fas fa-trophy" />
                  <span>{newAchievements.length} New Achievements!</span>
                </>
              ) : (
                <>
                  <i className="fas fa-star" />
                  <span>Perfect Score!</span>
                </>
              )}
            </div>
          )}

          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={restartQuiz}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
            >
              <i className="fas fa-redo" /> Restart Quiz
            </button>
            <button
              type="button"
              onClick={backToList}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-2.5 font-medium text-ink transition-colors hover:bg-gray-50"
            >
              <i className="fas fa-arrow-left" /> Back to Quizzes
            </button>
          </div>
        </div>

        {/* Achievement notifications */}
        <div className="fixed top-5 right-5 z-[2000] flex flex-col gap-2.5">
          {achievementToasts.map((achievement, index) => (
            <div
              key={index}
              className={`flex max-w-sm items-center gap-3 rounded-xl px-5 py-4 text-white shadow-lg ${
                achievement.type === "quiz_perfect"
                  ? "bg-gradient-to-br from-yellow-400 to-yellow-600"
                  : "bg-gradient-to-br from-green-500 to-green-600"
              }`}
            >
              <i className={`${achievement.icon || "fas fa-trophy"} text-2xl`} />
              <div>
                <div className="text-sm font-semibold">Achievement Unlocked!</div>
                <div className="font-bold">{achievement.title}</div>
                <div className="text-xs opacity-90">{achievement.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const rawStem = (question.stem || "").trim();
  const isGenericFibStem =
    question.questionType === QUESTION_TYPES.FILL_IN_THE_BLANK &&
    /^fill\s+in\s+the\s+blank:?\s*$/i.test(rawStem);

  return (
    <div className="mx-auto max-w-3xl p-8">
      {/* Header */}
      <div className="mb-6 rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-ink">{quizData.title}</h1>
            <span className="text-sm text-muted">{quizData.course}</span>
          </div>
          <button
            type="button"
            onClick={backToList}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
          >
            <i className="fas fa-arrow-left" /> Back to Quizzes
          </button>
        </div>
        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{
                width: `${((currentIndex + 1) / quizData.questions.length) * 100}%`,
              }}
            />
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-sm text-muted">
            <span>
              {currentIndex + 1} of {quizData.questions.length}
            </span>
            <span className="text-gray-300">|</span>
            <Timer startTime={startTime} />
          </div>
        </div>
      </div>

      {/* Question */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-ink">
          Question {currentIndex + 1}
        </h2>

        {isPrivileged && (
          <div className="mb-4 space-y-1.5 rounded-lg border-l-4 border-primary bg-page p-3 text-sm text-gray-600">
            <div>
              <i className="fas fa-bullseye mr-1.5 w-4 text-center text-primary" />
              <strong>Objective:</strong>{" "}
              {question.learningObjectiveName ||
                question.granularObjectiveName ||
                "General Topic"}
            </div>
            <div>
              <i className="fas fa-brain mr-1.5 w-4 text-center text-purple-500" />
              <strong>Taxonomy:</strong> {question.bloom || "Unspecified Category"}
            </div>
          </div>
        )}

        <RichText
          text={escapeHtml(
            question.question || question.title || "Question text not available"
          )}
          className="mb-2 text-ink"
        />

        {question.stem && !isGenericFibStem && (
          <RichText
            text={escapeHtml(question.stem)}
            className="mb-4 text-[1.05em] font-medium text-[#34495e]"
          />
        )}

        {question.questionType === QUESTION_TYPES.CALCULATION &&
          !question.calculationLoadError &&
          (() => {
            const tol = Number(question.calculationAnswerTolerancePercent);
            if (Number.isFinite(tol) && tol > 0) {
              return (
                <p className="mb-4 text-sm text-muted">
                  Your answer will be accepted within <strong>{tol}%</strong> of the
                  correct value.
                </p>
              );
            }
            const p = Number(question.answerDecimalPlaces);
            const dec = Number.isFinite(p)
              ? Math.max(0, Math.min(12, Math.round(p)))
              : 2;
            return (
              <p className="mb-4 text-sm text-muted">
                Round your answer to <strong>{dec}</strong> decimal place
                {dec === 1 ? "" : "s"}.
              </p>
            );
          })()}

        {question.questionType === QUESTION_TYPES.OPEN_ENDED && (
          <p className="mb-4 text-sm text-muted">
            This question is <strong>not auto-graded</strong>. After you submit, you
            will see a <strong>sample answer</strong> and the{" "}
            <strong>grading criteria</strong> for self-checking.
          </p>
        )}

        {/* Answer area */}
        {question.questionType === QUESTION_TYPES.FILL_IN_THE_BLANK ? (
          <TextAnswerInput
            question={question}
            saved={answers[questionId]}
            feedback={questionFeedback}
            submitting={submitting}
            onSubmit={(value) => submitTextAnswer(question, value)}
            placeholder="Type your answer, then click Submit"
          />
        ) : question.questionType === QUESTION_TYPES.CALCULATION ? (
          question.calculationLoadError || !question.calculationToken ? (
            <p className="rounded-lg bg-danger/5 p-4 text-sm text-danger">
              This question could not be loaded. Try refreshing the page or contact
              your instructor.
            </p>
          ) : (
            <TextAnswerInput
              question={question}
              saved={answers[questionId]}
              feedback={questionFeedback}
              submitting={submitting}
              onSubmit={(value) => submitTextAnswer(question, value)}
              placeholder="Enter a numeric answer"
              hint="calc"
            />
          )
        ) : question.questionType === QUESTION_TYPES.OPEN_ENDED ? (
          <TextAnswerInput
            question={question}
            saved={answers[questionId]}
            feedback={questionFeedback}
            submitting={submitting}
            onSubmit={(value) => submitTextAnswer(question, value)}
            placeholder="Write your answer, then click Submit"
            multiline
          />
        ) : (
          <div className="space-y-3">
            {["A", "B", "C", "D"].map((key, index) => {
              const optionRaw = question.options?.[key];
              const optionText =
                typeof optionRaw === "object" && optionRaw !== null
                  ? optionRaw.text || ""
                  : optionRaw || "";
              if (!optionText) return null;

              const selected = answers[questionId] === index;
              let stateClass = "border-gray-200 hover:border-primary/50";
              if (questionFeedback) {
                if (key === questionFeedback.correctAnswer) {
                  stateClass = "border-success bg-success/5";
                } else if (selected && !questionFeedback.isCorrect) {
                  stateClass = "border-danger bg-danger/5";
                } else {
                  stateClass = "border-gray-200 opacity-70";
                }
              } else if (selected) {
                stateClass = "border-primary bg-primary/5";
              }

              return (
                <button
                  key={key}
                  type="button"
                  disabled={!!questionFeedback || submitting}
                  onClick={() => selectMcqAnswer(index, key, questionId)}
                  className={`flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors disabled:cursor-default ${stateClass}`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-page font-bold text-ink">
                    {key}
                  </span>
                  <RichText
                    text={escapeHtml(optionText)}
                    className="min-w-0 flex-1 pt-1 text-ink"
                  />
                </button>
              );
            })}
          </div>
        )}

        <FeedbackPanel feedback={questionFeedback} />
      </div>

      {/* Navigation */}
      <div className="mt-6 flex items-center justify-between gap-4">
        <button
          type="button"
          disabled={currentIndex === 0}
          onClick={() => setCurrentIndex((i) => i - 1)}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-2.5 font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-40"
        >
          <i className="fas fa-chevron-left" /> Previous
        </button>

        <div className="flex flex-wrap justify-center gap-2">
          {quizData.questions.map((q, index) => {
            const fd = feedback[q.id];
            let dotClass = "bg-gray-200";
            if (fd) {
              dotClass =
                fd.openEnded ||
                (fd.questionType === QUESTION_TYPES.OPEN_ENDED && fd.isCorrect === null)
                  ? "bg-primary"
                  : fd.isCorrect
                    ? "bg-success"
                    : "bg-danger";
            }
            return (
              <button
                key={q.id || index}
                type="button"
                onClick={() => setCurrentIndex(index)}
                aria-label={`Go to question ${index + 1}`}
                className={`h-3 w-3 rounded-full transition-all ${dotClass} ${
                  index === currentIndex ? "ring-2 ring-primary ring-offset-2" : ""
                }`}
              />
            );
          })}
        </div>

        <button
          type="button"
          disabled={!hasAnswer && !calcBroken}
          onClick={() => {
            if (isLast) {
              showCompletion();
            } else {
              setCurrentIndex((i) => i + 1);
            }
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-40"
        >
          {isLast ? (
            <>
              Finish <i className="fas fa-check" />
            </>
          ) : (
            <>
              Next <i className="fas fa-chevron-right" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
