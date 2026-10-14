import { Fragment, useMemo, useState } from "react";
import { useQuestionAnalytics } from "../../hooks/useAnalytics";
import { formatQuestionTypeLabel } from "../../lib/utils";
import RichText from "../../components/RichText";
import Pagination from "../../components/ui/Pagination";
import { EmptyState, LoadingState } from "../../components/ui/states";
import { CorrectBar, LoadError, StatCard } from "./shared";
import { cellClass, comparePValue, headClass, lowDataNote, percent, thresholdRule } from "./format";

const ITEMS_PER_PAGE = 15;

const DIFFICULTY = {
  easy: { label: "Easy", className: "bg-success/10 text-success" },
  moderate: { label: "Moderate", className: "bg-primary/10 text-primary" },
  hard: { label: "Hard", className: "bg-danger/10 text-danger" },
  insufficient: { label: "Not enough data", className: "bg-gray-100 text-muted" },
};

const SORTS = {
  missed: {
    label: "Most missed",
    compare: (a, b) => (b.incorrect ?? -1) - (a.incorrect ?? -1) || comparePValue(a, b),
  },
  hardest: { label: "Hardest first", compare: (a, b) => comparePValue(a, b) },
  responses: { label: "Most responses", compare: (a, b) => b.responses - a.responses },
};

function DifficultyBadge({ difficulty }) {
  const { label, className } = DIFFICULTY[difficulty] || DIFFICULTY.insufficient;
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}

function OptionBreakdown({ question }) {
  const total = question.options.reduce((sum, option) => sum + option.count, 0);
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        How the class answered
      </p>
      <ul className="space-y-1.5">
        {question.options.map((option) => {
          const share = total ? option.count / total : 0;
          return (
            <li key={option.key} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 text-sm">
              <span className={`font-semibold ${option.isCorrect ? "text-success" : "text-ink"}`}>
                {option.key}
              </span>
              <div className="min-w-0">
                <RichText text={option.text} className="truncate" />
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                  <div
                    className={`h-full rounded-full ${option.isCorrect ? "bg-success" : "bg-gray-400"}`}
                    style={{ width: `${Math.round(share * 100)}%` }}
                  />
                </div>
              </div>
              <span className="whitespace-nowrap tabular-nums text-muted">
                {option.count} ({percent(share)})
                {option.isCorrect && <span className="ml-1 text-success">· correct</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function QuestionsTab({ courseId, quizId, sectionId }) {
  const { analytics, isPending, isError } = useQuestionAnalytics(courseId, { quizId, sectionId });
  const [sort, setSort] = useState("missed");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);

  const questions = analytics?.questions;
  const sorted = useMemo(
    () => (questions ? [...questions].sort(SORTS[sort].compare) : []),
    [questions, sort]
  );

  if (isPending) return <LoadingState label="Loading question analytics..." />;
  if (isError || !analytics) return <LoadError />;

  const { summary, mostMissed, cohortSize } = analytics;
  if (summary.totalQuestions === 0) {
    return (
      <EmptyState
        icon="fa-chart-line"
        title="No question data yet"
        message="Statistics appear once students have answered quiz questions."
      />
    );
  }

  const byId = new Map(questions.map((question) => [question.questionId, question]));
  const missedQuestions = mostMissed.map((id) => byId.get(id)).filter(Boolean).slice(0, 5);

  const totalPages = Math.max(1, Math.ceil(sorted.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageData = sorted.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Students in scope" value={cohortSize} />
        <StatCard
          label="Graded responses"
          value={summary.gradedResponses}
          hint={
            summary.pendingResponses > 0
              ? `${summary.pendingResponses} awaiting grading, not counted`
              : null
          }
        />
        <StatCard
          label="Average difficulty index"
          value={percent(summary.averagePValue)}
          hint="Average share of correct responses"
        />
        <StatCard
          label="Questions rated"
          value={`${summary.ratedQuestions} of ${summary.totalQuestions}`}
          hint={`${summary.bands.hard} hard · ${summary.bands.moderate} moderate · ${summary.bands.easy} easy`}
        />
      </div>

      <section aria-labelledby="most-missed-heading" className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 id="most-missed-heading" className="mb-4 text-lg font-semibold text-ink">
          Most frequently missed
        </h2>
        {missedQuestions.length === 0 ? (
          <p className="text-sm text-muted">
            No question with {thresholdRule(analytics)} has a wrong answer yet.
          </p>
        ) : (
          <ol className="space-y-3">
            {missedQuestions.map((question, index) => (
              <li key={question.questionId} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 w-5 shrink-0 text-right font-semibold text-muted">
                  {index + 1}.
                </span>
                <RichText text={question.text} className="min-w-0 flex-1 line-clamp-2 text-ink" />
                <span className="shrink-0 whitespace-nowrap tabular-nums text-danger">
                  {question.incorrect} of {question.responses} missed
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="all-questions-heading" className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-3">
          <h2 id="all-questions-heading" className="text-lg font-semibold text-ink">
            All questions
          </h2>
          <label className="flex items-center gap-2 text-sm text-muted">
            Sort by
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-ink focus:border-primary focus:outline-none"
            >
              {Object.entries(SORTS).map(([key, { label }]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="px-6 pb-3 text-xs text-muted">
          Difficulty index is the share of graded responses that were correct (easy above 85%, hard
          below 30%). A question is rated once it has {thresholdRule(analytics)}.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full">
            <caption className="sr-only">Class performance on each question</caption>
            <thead>
              <tr>
                <th scope="col" className={headClass}>Question</th>
                <th scope="col" className={headClass}>Type</th>
                <th scope="col" className={headClass}>Responses</th>
                <th scope="col" className={headClass}>Correct</th>
                <th scope="col" className={headClass}>Missed</th>
                <th scope="col" className={headClass}>Difficulty</th>
              </tr>
            </thead>
            <tbody>
              {pageData.map((question) => {
                const isOpen = expanded === question.questionId;
                const canExpand = !!question.options?.length;
                return (
                  <Fragment key={question.questionId}>
                    <tr className={question.enoughData ? "" : "text-muted"}>
                      <td className={`${cellClass} max-w-md`}>
                        <div id={`question-text-${question.questionId}`}>
                          <RichText text={question.text} className="line-clamp-2" />
                        </div>
                        {!question.enoughData && (
                          <p className="mt-1 text-xs">
                            {lowDataNote(question, "No graded responses yet")}
                          </p>
                        )}
                        {canExpand && (
                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : question.questionId)}
                            aria-expanded={isOpen}
                            aria-controls={`question-breakdown-${question.questionId}`}
                            aria-describedby={`question-text-${question.questionId}`}
                            className="mt-1 text-xs font-medium text-primary hover:underline"
                          >
                            {isOpen ? "Hide answer breakdown" : "Show answer breakdown"}
                          </button>
                        )}
                      </td>
                      <td className={`${cellClass} whitespace-nowrap`}>
                        {formatQuestionTypeLabel(question.questionType)}
                      </td>
                      <td className={`${cellClass} tabular-nums`}>
                        {question.responses}
                        {question.pending > 0 && (
                          <span className="block text-xs text-muted">+{question.pending} pending</span>
                        )}
                      </td>
                      <td className={cellClass}>
                        <CorrectBar pValue={question.pValue} />
                      </td>
                      <td className={`${cellClass} tabular-nums`}>{question.incorrect ?? "—"}</td>
                      <td className={cellClass}>
                        <DifficultyBadge difficulty={question.difficulty} />
                      </td>
                    </tr>
                    {isOpen && (
                      <tr id={`question-breakdown-${question.questionId}`}>
                        <td colSpan={6} className="border-b border-gray-100 bg-gray-50 px-6 py-4">
                          <OptionBreakdown question={question} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setPage}
            ariaLabel="Question analytics pages"
          />
        </div>
      </section>
    </div>
  );
}
