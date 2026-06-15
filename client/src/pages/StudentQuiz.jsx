import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { QUESTION_TYPES } from "../lib/constants";
import { escapeHtml } from "../lib/format";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useToast } from "../components/ui/Toast";
import RichText from "../components/RichText";
import QuizList from "./student-quiz/QuizList";
import { useQuizSession } from "./student-quiz/useQuizSession";
import {
  Timer,
  TextAnswerInput,
  McqOptions,
  FeedbackPanel,
  CompletionScreen,
} from "./student-quiz/QuizTakingParts";

// Calculation questions tell the student the rounding/tolerance rule up front.
function CalculationHint({ question }) {
  const tolerance = Number(question.calculationAnswerTolerancePercent);
  if (Number.isFinite(tolerance) && tolerance > 0) {
    return (
      <p className="mb-4 text-sm text-muted">
        Your answer will be accepted within <strong>{tolerance}%</strong> of the
        correct value.
      </p>
    );
  }
  const places = Number(question.answerDecimalPlaces);
  const decimals = Number.isFinite(places)
    ? Math.max(0, Math.min(12, Math.round(places)))
    : 2;
  return (
    <p className="mb-4 text-sm text-muted">
      Round your answer to <strong>{decimals}</strong> decimal place
      {decimals === 1 ? "" : "s"}.
    </p>
  );
}

export default function StudentQuiz() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { role } = useCurrentUser();
  const showToast = useToast();

  const [view, setView] = useState(searchParams.get("quiz") ? "quiz" : "list");
  const startedRef = useRef(false);

  const session = useQuizSession({
    onLoadError: (message) => showToast(message, "error"),
  });
  const {
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
  } = session;

  const backToList = () => {
    setView("list");
    session.reset();
  };

  const startQuiz = async (quizId) => {
    setView("quiz");
    const ok = await session.startQuiz(quizId);
    if (!ok) {
      setView("list");
      return;
    }
    // Clear URL params to prevent re-loading on refresh
    if (searchParams.get("quiz")) setSearchParams({}, { replace: true });
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

  const submitTextAnswer = async (question, value) => {
    const errorMessage = await session.submitTextAnswer(question, value);
    if (errorMessage) showToast(errorMessage, "error");
  };

  if (view === "list") {
    return <QuizList onStart={startQuiz} />;
  }

  if (loading || !quizData) {
    return (
      <div className="flex flex-col items-center justify-center p-24 text-muted">
        <i className="fas fa-spinner fa-spin mb-5 text-5xl text-primary" />
        <p className="text-lg">Loading quiz...</p>
      </div>
    );
  }

  if (completion) {
    return (
      <CompletionScreen
        completion={completion}
        achievementToasts={achievementToasts}
        onRestart={session.restartQuiz}
        onBackToList={backToList}
      />
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

  const rawStem = (question.stem || "").trim();
  const isGenericFibStem =
    question.questionType === QUESTION_TYPES.FILL_IN_THE_BLANK &&
    /^fill\s+in\s+the\s+blank:?\s*$/i.test(rawStem);

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
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

        {question.questionType === QUESTION_TYPES.CALCULATION && !calcBroken && (
          <CalculationHint question={question} />
        )}

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
          calcBroken || !question.calculationToken ? (
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
          <McqOptions
            question={question}
            answers={answers}
            feedback={feedback}
            submitting={submitting}
            onSelect={session.selectMcqAnswer}
          />
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
              session.finishQuiz();
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
