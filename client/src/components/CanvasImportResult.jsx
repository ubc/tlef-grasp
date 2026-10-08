import { useEffect, useRef } from "react";
import { draftsToCheckLabel, resultTotalsRows, slotLabel } from "../lib/canvasImport";

const summaryClass =
  "cursor-pointer rounded text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary";

// What a Canvas quiz import did. `result` is mergeCommitReports(...): totals,
// one entry per committed quiz, and the quizzes whose request failed outright.
// The modal's footer carries the Done action.
export default function CanvasImportResult({ result }) {
  const headingRef = useRef(null);
  const { totals, quizzes, errors, skipReasons } = result;
  const problems = totals.failedQuizzes + totals.failures + totals.imageFailures;

  // The review this replaces had focus; move it here so the outcome is read out.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const rows = resultTotalsRows(totals);
  const withFailures = quizzes.filter((quiz) => quiz.failures.length > 0);
  // Only the Drafts the import flagged, each with its reasons.
  const withDrafts = quizzes.filter((quiz) => quiz.drafts.length > 0);
  const draftsLabel = draftsToCheckLabel(result);

  return (
    <div className="space-y-4">
      <h4
        ref={headingRef}
        tabIndex={-1}
        className={`text-base font-semibold focus:outline-none ${problems ? "text-warning" : "text-success"}`}
      >
        <i
          className={`fas ${problems ? "fa-triangle-exclamation" : "fa-check-circle"} mr-2`}
          aria-hidden="true"
        />
        {problems ? "Import finished with problems" : "Import finished"}
      </h4>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-xl border border-gray-200 p-3 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-muted">{label}</dt>
            <dd className="font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      {errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
          <p className="font-semibold text-danger">
            {errors.length === 1
              ? "One Canvas quiz could not be imported:"
              : `${errors.length} Canvas quizzes could not be imported:`}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink">
            {errors.map((error) => (
              <li key={error.quizIdent}>
                <span className="font-medium">{error.title}</span>: {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {withFailures.length > 0 && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
          <p className="font-semibold text-danger">Questions that could not be saved:</p>
          <ul className="mt-1 space-y-2">
            {withFailures.map((quiz) => (
              <li key={quiz.quizIdent}>
                <p className="font-medium text-ink">{quiz.title}</p>
                <ul className="list-disc pl-5 text-ink">
                  {quiz.failures.map((failure, index) => (
                    <li key={index}>
                      {slotLabel(failure.slotName, quiz.title)}
                      {failure.title ? ` (${failure.title})` : ""}: {failure.reason}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      {draftsLabel && (
        <details className="rounded-lg border border-gray-200 p-3">
          <summary className={summaryClass}>{draftsLabel}</summary>
          <p className="mt-1 text-xs text-muted">
            Students only see approved questions. Check each one in the question bank before
            it is approved.
          </p>
          <ul className="mt-2 space-y-3 text-xs">
            {withDrafts.map((quiz) => (
              <li key={quiz.quizIdent}>
                <p className="text-sm font-medium text-ink">{quiz.title}</p>
                <ul className="mt-1 space-y-1.5">
                  {quiz.drafts.map((draft, index) => (
                    <li key={draft.questionId || index}>
                      <p className="font-medium text-ink">{slotLabel(draft.slotName, quiz.title)}</p>
                      {draft.title && (
                        <p className="line-clamp-2 whitespace-pre-line text-muted">{draft.title}</p>
                      )}
                      {draft.reasons?.length > 0 && (
                        <ul className="list-disc pl-4 text-amber-800">
                          {draft.reasons.map((reason, i) => (
                            <li key={i}>{reason}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}

      {skipReasons.length > 0 && (
        <details className="rounded-lg border border-gray-200 p-3">
          <summary className={summaryClass}>Skipped ({totals.skipped})</summary>
          <ul className="mt-2 space-y-1 text-xs text-ink">
            {skipReasons.map(({ reason, count }) => (
              <li key={reason}>
                {reason} <span className="text-muted">({count})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
