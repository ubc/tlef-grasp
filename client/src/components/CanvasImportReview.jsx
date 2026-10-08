import { useId } from "react";
import { formatDate } from "../lib/format";
import {
  allImportsSelected,
  describePreviewSummary,
  describeQuizCounts,
  describeRemoteImages,
  describeUnlinked,
  groupSkippedByReason,
  predictedDraftsLabel,
  quizCanBeImported,
  quizHasWork,
  slotLabel,
  withAllImports,
} from "../lib/canvasImport";

const summaryClass =
  "cursor-pointer rounded text-xs font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary";

// What a Canvas quiz export holds and what importing it will do, one row per
// Canvas quiz in the order GRASP would create them. `selections` is
// { [quizIdent]: { import, createQuiz } }; every change goes through onChange.
export default function CanvasImportReview({ preview, selections, onChange, disabled = false }) {
  const noQuizzesNoteId = useId();
  const permissions = preview.permissions || {};
  const quizzes = preview.quizzes || [];
  const remoteImages = describeRemoteImages(preview);
  // New questions to save, or earlier ones still missing from their GRASP quiz.
  const anyWork = quizzes.some((quiz) => quizHasWork(quiz, permissions));
  const allSelected = allImportsSelected(preview, selections);

  const update = (ident, changes) =>
    onChange({ ...selections, [ident]: { ...selections[ident], ...changes } });

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-200 p-3 text-sm">
        <p className="font-semibold text-ink">{describePreviewSummary(preview)}</p>
        {preview.manifestTitle && (
          <p className="mt-0.5 text-xs text-muted">{preview.manifestTitle}</p>
        )}
        <ul className="mt-2 space-y-1 text-muted">
          {remoteImages && (
            <li>
              <i className="fas fa-image mr-1.5 w-4 text-center" aria-hidden="true" />
              {remoteImages}
            </li>
          )}
          <li>
            <i className="fas fa-bullseye mr-1.5 w-4 text-center" aria-hidden="true" />
            Each Canvas question group becomes one learning objective holding all of its
            questions.
          </li>
          {permissions.canCreateQuizzes ? (
            <li>
              <i className="fas fa-clipboard-list mr-1.5 w-4 text-center" aria-hidden="true" />
              GRASP quizzes are created unpublished and unscheduled, with spaced repetition:
              students get one question from each group, and the others come back later for
              review.
            </li>
          ) : (
            <li id={noQuizzesNoteId}>
              <i className="fas fa-lock mr-1.5 w-4 text-center" aria-hidden="true" />
              You can&apos;t create quizzes in this course, so only the questions are imported.
            </li>
          )}
        </ul>
        {!permissions.canApprove && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            <i className="fas fa-circle-info mr-1" aria-hidden="true" />
            Imported questions are saved as Draft; faculty approve them.
          </p>
        )}
        {!anyWork && (
          <p className="mt-2 rounded-lg bg-success/10 px-3 py-2 text-success">
            <i className="fas fa-check mr-1" aria-hidden="true" />
            {preview.totals?.alreadyImported > 0
              ? "Everything in this export that GRASP can import is already in this course."
              : "Nothing in this export can be imported into GRASP."}
          </p>
        )}
      </div>

      {quizzes.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">Canvas quizzes, by due date</p>
          {anyWork && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(withAllImports(preview, selections, !allSelected))}
              className="shrink-0 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-60"
            >
              {allSelected ? "Clear all" : "Select all"}
            </button>
          )}
        </div>
      )}

      <ul className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
        {quizzes.map((quiz) => (
          <QuizRow
            key={quiz.ident}
            quiz={quiz}
            permissions={permissions}
            selection={selections[quiz.ident] || {}}
            disabled={disabled}
            noQuizzesNoteId={noQuizzesNoteId}
            onChange={(changes) => update(quiz.ident, changes)}
          />
        ))}
      </ul>
    </div>
  );
}

function QuizRow({ quiz, permissions, selection, disabled, noQuizzesNoteId, onChange }) {
  const importId = useId();
  const selectable = quizCanBeImported(quiz, permissions);
  const ticked = selectable && Boolean(selection.import);
  const canCreate = Boolean(permissions.canCreateQuizzes);
  const skipped = quiz.skipped || [];
  // Only the questions that will be Drafts because the import flagged them.
  const drafts = quiz.predictedDrafts || [];
  const draftsLabel = predictedDraftsLabel(quiz);
  const notes = quiz.notes || [];
  const unlinkedNote = describeUnlinked(quiz, permissions);

  return (
    <li className={`rounded-xl border p-3 ${ticked ? "border-primary/40" : "border-gray-200"}`}>
      <div className="flex items-start gap-3">
        <input
          id={importId}
          type="checkbox"
          checked={ticked}
          disabled={disabled || !selectable}
          onChange={(event) => onChange({ import: event.target.checked })}
          className="mt-1 h-4 w-4 shrink-0 accent-primary"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor={importId}
              className={`font-medium ${selectable ? "cursor-pointer text-ink" : "text-muted"}`}
            >
              <span className="sr-only">Import </span>
              {quiz.title}
            </label>
            {quiz.flavour === "new-quizzes" && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-muted">
                New Quizzes
              </span>
            )}
          </div>
          <p className="text-xs text-muted">
            {describeQuizCounts(quiz)}
            {quiz.dueAt ? ` · Due ${formatDate(quiz.dueAt)}` : ""}
          </p>

          {unlinkedNote ? (
            <p className="mt-1 text-xs text-amber-800">
              <i className="fas fa-circle-info mr-1" aria-hidden="true" />
              {unlinkedNote}
            </p>
          ) : (
            !selectable &&
            quiz.existingQuiz && (
              <p className="mt-1 text-xs text-muted">
                Its questions are in the GRASP quiz &ldquo;{quiz.existingQuiz.name}&rdquo;.
              </p>
            )
          )}

          {selectable && (
            <label
              className={`mt-2 flex items-start gap-2 text-sm ${
                canCreate && ticked ? "cursor-pointer text-ink" : "text-muted"
              }`}
            >
              <input
                type="checkbox"
                checked={canCreate && Boolean(selection.createQuiz)}
                disabled={disabled || !canCreate || !ticked}
                aria-describedby={canCreate ? undefined : noQuizzesNoteId}
                onChange={(event) => onChange({ createQuiz: event.target.checked })}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              {quiz.existingQuiz ? (
                <span>
                  {quiz.importable > 0 ? "Add new questions" : "Add the imported questions"} to
                  the existing GRASP quiz &ldquo;{quiz.existingQuiz.name}&rdquo;
                </span>
              ) : (
                <span>
                  Create a GRASP quiz<span className="sr-only"> from {quiz.title}</span>
                </span>
              )}
            </label>
          )}

          {notes.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-muted">
              {notes.map((note, index) => (
                <li key={index}>
                  <i className="fas fa-circle-info mr-1" aria-hidden="true" />
                  {note}
                </li>
              ))}
            </ul>
          )}

          {skipped.length > 0 && (
            <details className="mt-2">
              <summary className={summaryClass}>Skipped ({skipped.length})</summary>
              <ul className="mt-1 space-y-2 text-xs">
                {groupSkippedByReason(skipped, quiz.title).map((group) => (
                  <li key={group.reason}>
                    <p className="font-medium text-ink">
                      {group.reason} ({group.count})
                    </p>
                    <p className="text-muted">{group.slots.join(", ")}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {draftsLabel && (
            <details className="mt-2">
              <summary className={summaryClass}>{draftsLabel}</summary>
              <ul className="mt-1 space-y-2 text-xs">
                {drafts.map((draft, index) => (
                  <li key={index}>
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
            </details>
          )}
        </div>
      </div>
    </li>
  );
}
