import { Fragment, useMemo, useState } from "react";
import { useQuestionAnalytics } from "../../hooks/useAnalytics";
import { formatQuestionTypeLabel } from "../../lib/utils";
import RichText from "../../components/RichText";
import Pagination from "../../components/ui/Pagination";
import { EmptyState, LoadingState } from "../../components/ui/states";
import { CorrectBar, LoadError, StatCard } from "./shared";
import {
  cellClass,
  compareDiscrimination,
  comparePValue,
  formatStat,
  headClass,
  lowDataNote,
  percent,
  thresholdRule,
} from "./format";
import { FlagBadge, ItemAnalysisExplainer, LowNNote, StatWithBand } from "./itemAnalysis";

const ITEMS_PER_PAGE = 15;

// The question table has nine columns; tighter padding lets it fit beside
// the sidebar on a laptop screen without scrolling sideways.
const tableHeadClass = headClass.replace("px-4", "px-3");
const tableCellClass = cellClass.replace("px-4", "px-3");

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
  discrimination: {
    label: "Least discriminating",
    compare: (a, b) => compareDiscrimination(a.itemAnalysis, b.itemAnalysis),
  },
};

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// The question's discrimination in each quiz it appeared in.
function PerQuizBreakdown({ itemAnalysis }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        Discrimination in each quiz
      </p>
      <table className="w-full max-w-2xl text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th scope="col" className="py-1 pr-4 font-medium">Quiz</th>
            <th scope="col" className="py-1 pr-4 font-medium">Students</th>
            <th scope="col" className="py-1 pr-4 font-medium">Discrimination index (D)</th>
            <th scope="col" className="py-1 pr-4 font-medium">
              Point-biserial (r<sub>pb</sub>)
            </th>
            <th scope="col" className="py-1 font-medium">Item verdict</th>
          </tr>
        </thead>
        <tbody>
          {itemAnalysis.perQuiz.map((entry) => (
            <tr key={entry.quizId} className={entry.enoughData ? "" : "text-muted"}>
              <td className="py-1 pr-4">{entry.quizName || "Quiz"}</td>
              <td className="py-1 pr-4 tabular-nums">{entry.students}</td>
              <td className="py-1 pr-4 tabular-nums">{formatStat(entry.discrimination)}</td>
              <td className="py-1 pr-4 tabular-nums">{formatStat(entry.pointBiserial)}</td>
              <td className="py-1">
                {entry.enoughData ? <FlagBadge flag={entry.flag} /> : "Too few students"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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

  const { summary, mostMissed, cohortSize, itemAnalysis: itemLimits } = analytics;
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
  const itemSummary = summary.itemAnalysis;
  const checkQuestions = (itemSummary?.checkItems || []).map((id) => byId.get(id)).filter(Boolean);

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

      <section aria-labelledby="item-quality-heading" className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 id="item-quality-heading" className="text-lg font-semibold text-ink">
          Item quality
        </h2>
        {itemSummary?.analyzedQuestions ? (
          <p className="mt-1 text-sm text-muted">
            {plural(itemSummary.analyzedQuestions, "question")} analysed:{" "}
            {itemSummary.flags.good} good · {itemSummary.flags.fair} acceptable ·{" "}
            {itemSummary.flags.review} to review ·{" "}
            {itemSummary.flags["too-easy"]} too easy · {itemSummary.flags["too-hard"]} too hard ·{" "}
            {itemSummary.flags.miskeyed} possibly miskeyed
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted">
            Discrimination appears once {itemLimits?.minStudents ?? 3} students have answered a
            question in the same quiz.
          </p>
        )}
        {checkQuestions.length > 0 && (
          <div className="mt-4 rounded-xl border border-danger/30 bg-danger/5 p-4">
            <h3 className="text-sm font-semibold text-danger">
              <i className="fas fa-triangle-exclamation mr-1.5" aria-hidden="true" />
              Check these items
            </h3>
            <p className="mt-1 text-xs text-muted">
              Stronger students missed these more often than weaker ones. This usually means a wrong
              answer key or an ambiguous question.
            </p>
            <ul className="mt-3 space-y-2">
              {checkQuestions.map((question) => (
                <li key={question.questionId} className="flex items-start gap-3 text-sm">
                  <RichText text={question.text} className="min-w-0 flex-1 line-clamp-2 text-ink" />
                  <span className="shrink-0 whitespace-nowrap tabular-nums text-danger">
                    r<sub>pb</sub> {formatStat(question.itemAnalysis.pointBiserial)} · D{" "}
                    {formatStat(question.itemAnalysis.discrimination)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-4">
          <ItemAnalysisExplainer limits={itemLimits} />
        </div>
      </section>

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
                <th scope="col" className={tableHeadClass}>Question</th>
                <th scope="col" className={tableHeadClass}>Type</th>
                <th scope="col" className={tableHeadClass}>Responses</th>
                <th scope="col" className={tableHeadClass}>Correct</th>
                <th scope="col" className={tableHeadClass}>Missed</th>
                <th scope="col" className={tableHeadClass}>Difficulty</th>
                <th scope="col" className={tableHeadClass}>Discrimination index (D)</th>
                <th scope="col" className={tableHeadClass}>
                  Point-biserial (r<sub>pb</sub>)
                </th>
                <th scope="col" className={tableHeadClass}>Item verdict</th>
              </tr>
            </thead>
            <tbody>
              {pageData.map((question) => {
                const isOpen = expanded === question.questionId;
                const items = question.itemAnalysis;
                const hasOptions = !!question.options?.length;
                const hasPerQuiz = !!items?.perQuiz?.length;
                const canExpand = hasOptions || hasPerQuiz;
                return (
                  <Fragment key={question.questionId}>
                    <tr className={question.enoughData ? "" : "text-muted"}>
                      <td className={`${tableCellClass} min-w-56 max-w-md`}>
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
                            {isOpen ? "Hide details" : "Show details"}
                          </button>
                        )}
                      </td>
                      <td className={tableCellClass}>
                        {formatQuestionTypeLabel(question.questionType)}
                      </td>
                      <td className={`${tableCellClass} tabular-nums`}>
                        {question.responses}
                        {question.pending > 0 && (
                          <span className="block text-xs text-muted">+{question.pending} pending</span>
                        )}
                      </td>
                      <td className={tableCellClass}>
                        <CorrectBar pValue={question.pValue} barClassName="w-14" />
                      </td>
                      <td className={`${tableCellClass} tabular-nums`}>{question.incorrect ?? "—"}</td>
                      <td className={tableCellClass}>
                        <DifficultyBadge difficulty={question.difficulty} />
                      </td>
                      <td className={tableCellClass}>
                        <StatWithBand
                          value={items?.enoughData ? items.discrimination : null}
                          band={items?.discriminationBand}
                          stacked
                        />
                      </td>
                      <td className={tableCellClass}>
                        <StatWithBand
                          value={items?.enoughData ? items.pointBiserial : null}
                          band={items?.pointBiserialBand}
                          stacked
                        />
                        {items?.enoughData && items.quizzesRated > 1 && (
                          <span className="mt-0.5 block text-xs text-muted">
                            from {items.quizzesRated} quizzes
                          </span>
                        )}
                      </td>
                      <td className={tableCellClass}>
                        <FlagBadge flag={items?.enoughData ? items.flag : null} />
                        {items?.lowN && (
                          <LowNNote students={items.students} lowNBelow={itemLimits?.lowNBelow ?? 20} />
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr id={`question-breakdown-${question.questionId}`}>
                        <td colSpan={9} className="border-b border-gray-100 bg-gray-50 px-6 py-4">
                          <div className="space-y-5">
                            {hasOptions && <OptionBreakdown question={question} />}
                            {hasPerQuiz && <PerQuizBreakdown itemAnalysis={items} />}
                          </div>
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
