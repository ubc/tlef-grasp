import { useState } from "react";
import { useQuizAnalytics } from "../../hooks/useAnalytics";
import RichText from "../../components/RichText";
import { formatTimeSpent } from "../../lib/format";
import { EmptyState, LoadingState } from "../../components/ui/states";
import { LoadError, StatCard } from "./shared";
import {
  RELIABILITY_REASONS,
  cellClass,
  compareDiscrimination,
  compareFlag,
  headClass,
  percent,
} from "./format";
import { FlagBadge, ItemAnalysisExplainer, LowNNote, StatWithBand } from "./itemAnalysis";

const scoreLabel = (value) => (value === null || value === undefined ? "—" : `${Math.round(value)}%`);

// Score histogram in 10-point bins. Every bar prints its count, so the chart
// reads without relying on bar height or colour.
function ScoreDistribution({ distribution, quizName }) {
  const max = Math.max(1, ...distribution.map((bin) => bin.count));
  return (
    <figure>
      <figcaption className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Score distribution
      </figcaption>
      <ul
        className="flex h-36 items-end gap-1"
        aria-label={`Number of submissions per score range for ${quizName}`}
      >
        {distribution.map((bin) => (
          <li key={bin.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
            <span className="mb-1 text-xs tabular-nums text-ink">{bin.count}</span>
            <div
              className="w-full rounded-t bg-primary"
              style={{ height: `${(bin.count / max) * 100}%`, minHeight: bin.count ? 2 : 0 }}
              aria-hidden="true"
            />
            <span className="sr-only">
              {bin.count} submission{bin.count === 1 ? "" : "s"} scored {bin.label}%
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex gap-1 border-t border-gray-200 pt-1" aria-hidden="true">
        {distribution.map((bin) => (
          <span key={bin.label} className="min-w-0 flex-1 truncate text-center text-[10px] text-muted">
            {bin.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

// KR-20, its standard error, and how much data is behind it.
function Reliability({ reliability, limits }) {
  if (!reliability) {
    return <p className="text-sm text-muted">No graded answers in this quiz yet.</p>;
  }
  if (reliability.kr20 === null) {
    return (
      <p className="text-sm text-muted">
        Reliability (KR-20) not available.{" "}
        {RELIABILITY_REASONS[reliability.reason] || ""}
      </p>
    );
  }
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-muted">Reliability (KR-20)</dt>
        <dd className="text-xl font-bold text-ink">
          <StatWithBand value={reliability.kr20} band={reliability.band} />
        </dd>
      </div>
      <div>
        <dt className="text-muted">Standard error (SEM)</dt>
        <dd className="text-xl font-bold text-ink tabular-nums">±{reliability.sem} pts</dd>
      </div>
      <div>
        <dt className="text-muted">Based on</dt>
        <dd className="text-ink">
          {reliability.items} questions × {reliability.students} students
          {reliability.lowN && <LowNNote students={reliability.students} lowNBelow={limits.lowNBelow} />}
        </dd>
      </div>
    </dl>
  );
}

// Every question in the quiz with its discrimination, worst first.
function ItemTable({ quiz, limits }) {
  if (quiz.items.length === 0) return null;
  const items = [...quiz.items].sort(
    (a, b) => compareFlag(a.flag, b.flag) || compareDiscrimination(a, b)
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <caption className="sr-only">Discrimination of each question in {quiz.name}</caption>
        <thead>
          <tr>
            <th scope="col" className={headClass}>Question</th>
            <th scope="col" className={headClass}>Correct</th>
            <th scope="col" className={headClass}>Discrimination index (D)</th>
            <th scope="col" className={headClass}>
              Point-biserial (r<sub>pb</sub>)
            </th>
            <th scope="col" className={headClass}>Item verdict</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.questionId} className={item.enoughData ? "" : "text-muted"}>
              <td className={`${cellClass} min-w-64 max-w-md`}>
                <RichText text={item.text} className="line-clamp-2" />
              </td>
              <td className={`${cellClass} tabular-nums`}>{percent(item.pValue)}</td>
              <td className={cellClass}>
                <StatWithBand value={item.discrimination} band={item.discriminationBand} />
              </td>
              <td className={cellClass}>
                <StatWithBand value={item.pointBiserial} band={item.pointBiserialBand} />
              </td>
              <td className={cellClass}>
                {item.enoughData ? (
                  <>
                    <FlagBadge flag={item.flag} />
                    {item.lowN && <LowNNote students={item.students} lowNBelow={limits.lowNBelow} />}
                  </>
                ) : (
                  `Only ${item.students} student${item.students === 1 ? "" : "s"}`
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuizCard({ quiz, minSubmissions, limits }) {
  const [showStats, setShowStats] = useState(false);
  const panelId = `quiz-statistics-${quiz.quizId}`;
  return (
    <article className="rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-ink">{quiz.name}</h2>

      <div className="mt-3">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted">Completion</span>
          <span className="tabular-nums text-ink">
            {quiz.submitted} of {quiz.assigned} submitted ({percent(quiz.completionRate)})
          </span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
          <div
            className="h-full rounded-full bg-success"
            style={{ width: `${Math.round((quiz.completionRate || 0) * 100)}%` }}
          />
        </div>
      </div>

      {quiz.enoughData ? (
        <div className="mt-5 grid gap-6 md:grid-cols-[12rem_1fr]">
          <dl className="grid grid-cols-3 gap-3 text-sm md:grid-cols-1">
            <div>
              <dt className="text-muted">Average score</dt>
              <dd className="text-xl font-bold text-ink tabular-nums">{scoreLabel(quiz.meanScore)}</dd>
            </div>
            <div>
              <dt className="text-muted">Median score</dt>
              <dd className="text-xl font-bold text-ink tabular-nums">{scoreLabel(quiz.medianScore)}</dd>
            </div>
            <div>
              <dt className="text-muted">Average time</dt>
              <dd className="text-xl font-bold text-ink tabular-nums">
                {quiz.averageTimeSpent ? formatTimeSpent(quiz.averageTimeSpent) : "—"}
              </dd>
            </div>
          </dl>
          <ScoreDistribution distribution={quiz.distribution} quizName={quiz.name} />
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">
          {quiz.submitted === 0
            ? "No submissions yet."
            : `Only ${quiz.submitted} submission${quiz.submitted === 1 ? "" : "s"}; scores are shown from ${minSubmissions}.`}
        </p>
      )}

      {quiz.pendingSubmissions > 0 && (
        <p className="mt-4 text-xs text-warning">
          <i className="fas fa-hourglass-half mr-1" aria-hidden="true" />
          {quiz.pendingSubmissions} submission{quiz.pendingSubmissions === 1 ? " has" : "s have"} answers
          awaiting grading; those scores may rise once graded.
        </p>
      )}

      <div className="mt-5 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={() => setShowStats((open) => !open)}
          aria-expanded={showStats}
          aria-controls={panelId}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-ink hover:bg-gray-50"
        >
          <i className={`fas ${showStats ? "fa-chevron-up" : "fa-chart-simple"}`} aria-hidden="true" />
          {showStats ? "Hide statistics" : "Statistics"}
          <span className="sr-only"> for {quiz.name}</span>
        </button>
        {showStats && (
          <div id={panelId} className="mt-4 space-y-4">
            <Reliability reliability={quiz.reliability} limits={limits} />
            <ItemTable quiz={quiz} limits={limits} />
          </div>
        )}
      </div>
    </article>
  );
}

export default function QuizzesTab({ courseId, quizId, sectionId }) {
  const { analytics, isPending, isError } = useQuizAnalytics(courseId, { quizId, sectionId });

  if (isPending) return <LoadingState label="Loading quiz analytics..." />;
  if (isError || !analytics) return <LoadError />;

  const { quizzes, summary, minResponses, minStudents, cohortSize } = analytics;
  const itemLimits = analytics.itemAnalysis || { minStudents: 3, lowNBelow: 20 };
  // Each submission is a different student, so both minimums apply to it.
  const minSubmissions = Math.max(minResponses, minStudents);
  if (quizzes.length === 0) {
    return (
      <EmptyState
        icon="fa-clipboard-list"
        title="No published quizzes yet"
        message="Statistics appear once a quiz is published and students submit it."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Students in scope" value={cohortSize} />
        <StatCard label={quizId ? "Quiz" : "Published quizzes"} value={summary.totalQuizzes} />
        <StatCard
          label="Completion"
          value={percent(summary.completionRate)}
          hint={`${summary.submitted} of ${summary.assigned} assigned submissions`}
        />
        <StatCard
          label="Average score"
          value={scoreLabel(summary.meanScore)}
          hint="Across all submissions in scope"
        />
      </div>

      <p className="text-xs text-muted">
        Completion counts students in the sections each quiz is scheduled for. Scores are the
        graded first attempt, and are withheld for a quiz with fewer than {minSubmissions}{" "}
        submissions. Open a quiz&apos;s statistics for its reliability (KR-20) and how well each
        question separates stronger from weaker students.
      </p>
      <ItemAnalysisExplainer limits={itemLimits} />

      {quizzes.map((quiz) => (
        <QuizCard key={quiz.quizId} quiz={quiz} minSubmissions={minSubmissions} limits={itemLimits} />
      ))}
    </div>
  );
}
