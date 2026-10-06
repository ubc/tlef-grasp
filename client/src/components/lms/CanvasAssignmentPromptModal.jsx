import Modal from "../ui/Modal";
import { formatDateTime } from "../../lib/format";

const btnSecondary =
  "rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-60";
const btnPrimary =
  "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60";

// "Create in Canvas?" — asked once a quiz is scheduled on a Canvas-linked
// section, once a section with scheduled quizzes is linked, and before the
// schedule chip's own "Canvas" button creates anything (issue #125).
// `items`: [{ key, label, dueAt }]. With `onDecline`, the dialog offers "Don't
// create", which is remembered; without it (the chip), it offers a plain
// Cancel. Closing the dialog is never remembered.
export default function CanvasAssignmentPromptModal({
  open,
  items = [],
  busy = false,
  onCreate,
  onDecline,
  onClose,
}) {
  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title="Create in Canvas?"
      footer={
        <>
          {onDecline ? (
            <button type="button" onClick={onDecline} disabled={busy} className={btnSecondary}>
              Don&rsquo;t create
            </button>
          ) : (
            <button type="button" onClick={onClose} disabled={busy} className={btnSecondary}>
              Cancel
            </button>
          )}
          <button type="button" onClick={onCreate} disabled={busy} className={btnPrimary}>
            {busy ? "Creating…" : "Create in Canvas"}
          </button>
        </>
      }
    >
      <p className="text-sm text-ink">
        GRASP can add a Canvas assignment for each item below, so the Canvas gradebook has a
        column to import the scores into. Students see it in Canvas with a note to take the
        quiz in GRASP; the due date follows the section&rsquo;s close time.
      </p>
      <ul className="my-4 divide-y divide-gray-100 rounded-lg border border-gray-200">
        {items.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="font-medium text-ink">{item.label}</span>
            {item.dueAt && (
              <span className="text-xs text-muted">Due {formatDateTime(item.dueAt)}</span>
            )}
          </li>
        ))}
      </ul>
      {onDecline && (
        <p className="text-xs text-muted">
          &ldquo;Don&rsquo;t create&rdquo; is remembered; you can still create it later from the
          section&rsquo;s schedule chip on the quiz.
        </p>
      )}
    </Modal>
  );
}
