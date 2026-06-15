import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useStudentQuizResults } from "../hooks/useStudentQuizzes";

export default function QuizSummary() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const quizId = searchParams.get("quiz");
  const [currentIndex, setCurrentIndex] = useState(0);

  const summaryQuery = useStudentQuizResults(quizId);
  const summary = summaryQuery.summary;
  const questions = summary?.questions || [];
  const question = questions[currentIndex];

  // Keyboard navigation (arrows + escape), as in the legacy page
  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setCurrentIndex((i) => Math.max(0, i - 1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setCurrentIndex((i) => Math.min(questions.length - 1, i + 1));
      } else if (event.key === "Escape") {
        event.preventDefault();
        navigate("/student-dashboard");
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [questions.length, navigate]);

  if (summaryQuery.isPending && quizId) {
    return (
      <div className="flex items-center justify-center p-24 text-muted">
        <i className="fas fa-spinner fa-spin mr-3 text-2xl" />
        Loading quiz summary...
      </div>
    );
  }

  if (!quizId || summaryQuery.isError || !summary) {
    return (
      <div className="mx-auto max-w-lg p-4 md:p-8">
        <div className="rounded-2xl bg-white p-10 text-center shadow-sm">
          <i className="fas fa-exclamation-triangle mb-4 text-4xl text-warning" />
          <h3 className="text-lg font-semibold text-ink">Unable to Load Quiz Summary</h3>
          <p className="mt-2 text-muted">
            There was an error loading the quiz summary. Please try refreshing the page
            or contact support if the problem persists.
          </p>
          <button
            type="button"
            onClick={() => navigate("/student-dashboard")}
            className="mt-6 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const completedDate =
    new Date(summary.completedAt).toLocaleDateString("en-CA") +
    " " +
    new Date(summary.completedAt)
      .toLocaleTimeString("en-US", { hour12: false })
      .substring(0, 5);

  return (
    <div className="grid grid-cols-1 gap-6 p-4 md:gap-8 md:p-8 lg:grid-cols-[300px_1fr]">
      {/* Summary sidebar */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="mb-5 text-lg font-semibold text-ink">Quiz Summary</h2>

        <div className="mb-5 rounded-xl bg-page p-5 text-center">
          <div className="text-3xl font-bold text-ink">
            {summary.correctAnswers}/{summary.totalQuestions}
          </div>
          <div className="text-muted">{summary.score}% Score</div>
        </div>

        <div className="mb-6 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Completed:</span>
            <span className="font-medium text-ink">{completedDate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Attempt:</span>
            <span className="font-medium text-ink">#1</span>
          </div>
        </div>

        <h3 className="mb-3 font-semibold text-ink">Questions</h3>
        <div className="flex flex-wrap gap-2">
          {questions.map((q, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setCurrentIndex(index)}
              aria-label={`Go to question ${index + 1}`}
              className={`flex h-9 w-9 items-center justify-center rounded-full text-sm text-white transition-all ${
                q.isCorrect ? "bg-success" : "bg-danger"
              } ${index === currentIndex ? "ring-2 ring-primary ring-offset-2" : ""}`}
            >
              <i className={`fas ${q.isCorrect ? "fa-check" : "fa-times"}`} />
            </button>
          ))}
        </div>
      </div>

      {/* Question detail */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">
            Question {currentIndex + 1} of {summary.totalQuestions}
          </h2>
          <span
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              question?.isCorrect
                ? "bg-success/10 text-success"
                : "bg-danger/10 text-danger"
            }`}
          >
            {question?.isCorrect ? "Correct" : "Incorrect"}
          </span>
        </div>

        <div className="space-y-5">
          <div>
            <h3 className="mb-2 font-semibold text-ink">Question</h3>
            <p className="text-gray-600">{question?.question}</p>
          </div>
          <div>
            <h3 className="mb-2 font-semibold text-ink">Your Answer</h3>
            <div className="rounded-xl border border-gray-200 bg-page p-4 text-gray-700">
              {question?.userAnswer}
            </div>
          </div>
          <div>
            <h3 className="mb-2 font-semibold text-ink">Feedback</h3>
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-gray-700">
              {question?.explanation}
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap justify-between gap-3">
          <button
            type="button"
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex((i) => i - 1)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-2.5 font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-40"
          >
            <i className="fas fa-chevron-left" /> Previous Question
          </button>
          <button
            type="button"
            disabled={currentIndex === questions.length - 1}
            onClick={() => setCurrentIndex((i) => i + 1)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-40"
          >
            Next Question <i className="fas fa-chevron-right" />
          </button>
        </div>
      </div>
    </div>
  );
}
