import { MC_MAX_OPTIONS, MC_MIN_OPTIONS, addOptionRow, removeOptionRow } from "../lib/mcOptions";
import QuestionImageField from "./QuestionImageField";
import AutoHeightTextarea from "./AutoHeightTextarea";
import { discardImageFile } from "../lib/questionImages";

// Alt text only: a caption shown under a structure could name the answer.
export const OPTION_IMAGE_CAPTION_PLACEHOLDER = "Alt text for screen readers (not shown on screen)";

// The answer-option rows of a multiple-choice form: one radio per row for the
// correct answer, text and feedback fields, an optional image (issue #146),
// and add/remove controls between two and eight rows (issue #144). Shared by
// the add-question wizard and the edit modal, which keep the rows in
// `form.options` and the answer in `form.correctAnswer`. Text and feedback are
// one-line textareas that grow, not inputs: an input strips line breaks, and
// options imported from Canvas can span paragraphs (issue #140).
export default function McOptionEditor({
  options,
  correctAnswer,
  onChange,
  readOnly = false,
  radioName = "mc-correct-answer",
  inputClass = "",
  feedbackPlaceholder = "Feedback for this option...",
  courseId,
}) {
  const update = (index, patch) => {
    const next = [...options];
    next[index] = { ...next[index], ...patch };
    onChange({ options: next, correctAnswer });
  };
  const canRemove = !readOnly && options.length > MC_MIN_OPTIONS;
  const canAdd = !readOnly && options.length < MC_MAX_OPTIONS;

  return (
    <div className="space-y-3">
      {options.map((option, index) => (
        <div key={option.id} className="flex items-start gap-3">
          <label className="flex items-center gap-2 pt-2">
            <input
              type="radio"
              name={radioName}
              aria-label={`Mark option ${option.id} as the correct answer`}
              checked={correctAnswer === option.id}
              disabled={readOnly}
              onChange={() => onChange({ options, correctAnswer: option.id })}
              className="h-4 w-4 accent-primary"
            />
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-page text-sm font-bold text-ink">
              {option.id}
            </span>
          </label>
          <div className="flex-1 space-y-1.5">
            <AutoHeightTextarea
              rows={1}
              aria-label={`Option ${option.id} text`}
              value={option.text}
              readOnly={readOnly}
              placeholder="Enter option text, or attach an image..."
              onChange={(event) => update(index, { text: event.target.value })}
              className={`${inputClass} resize-none`}
            />
            <AutoHeightTextarea
              rows={1}
              aria-label={`Option ${option.id} feedback`}
              value={option.feedback}
              readOnly={readOnly}
              placeholder={feedbackPlaceholder}
              onChange={(event) => update(index, { feedback: event.target.value })}
              className={`${inputClass} resize-none bg-gray-50 italic`}
            />
            {(option.image || !readOnly) && (
              <QuestionImageField
                single
                label={`Option ${option.id}`}
                value={option.image ? [option.image] : []}
                onChange={(images) => update(index, { image: images[0] || null })}
                disabled={readOnly}
                courseId={courseId}
                captionPlaceholder={OPTION_IMAGE_CAPTION_PLACEHOLDER}
              />
            )}
          </div>
          {!readOnly && (
            <button
              type="button"
              aria-label={`Remove option ${option.id}`}
              title={canRemove ? "Remove this option" : `Keep at least ${MC_MIN_OPTIONS} options`}
              disabled={!canRemove}
              onClick={() => {
                discardImageFile(option.image?.fileId);
                onChange(removeOptionRow(options, index, correctAnswer));
              }}
              className="mt-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-30"
            >
              <i className="fas fa-times" aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => onChange({ options: addOptionRow(options), correctAnswer })}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40"
        >
          <i className="fas fa-plus" aria-hidden="true" />
          Add option
          <span className="font-normal text-muted">
            ({options.length} of {MC_MAX_OPTIONS})
          </span>
        </button>
      )}
    </div>
  );
}
