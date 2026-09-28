import { useEffect, useState } from "react";
import Modal from "./ui/Modal";

// "Delete" means two things in the generation wizard, and this is where the
// instructor says which they meant: drop it from the page in front of them, or
// delete the record from the Question Bank. Questions (step 2) and learning
// objectives (step 1) share the modal because the question is the same either
// way — only the noun changes.
//
// The safe option is pre-selected. The database option is left out entirely,
// with copy saying why, when there is no saved record to delete or the
// instructor is not faculty. Nothing here calls a page-only removal permanent.
//
// `handoff` marks the one difference between callers: a question is deleted the
// moment this modal is confirmed, while an objective goes on to the
// linked-questions choice (DeleteObjectiveModal). Either way the caller does
// the deleting — this modal only reports the choice.
export default function DeleteScopeModal({
  open,
  noun,
  existsInDb,
  canDeleteFromDb,
  isDeleting = false,
  handoff = false,
  // Extra records the database delete takes with it, e.g. "its granular
  // objectives". Named in the copy so the blast radius is not a surprise.
  alsoDeletes = "",
  onClose,
  onRemoveFromPage,
  onDeleteFromDb,
}) {
  const [action, setAction] = useState("page");

  // Start from the safe choice every time the modal opens.
  useEffect(() => {
    if (open) setAction("page");
  }, [open]);

  const offerDbOption = existsInDb && canDeleteFromDb;
  const deleting = offerDbOption && action === "database";
  // Title-cased so a two-word noun reads "Delete Learning Objective?" rather
  // than "Delete Learning objective?".
  const title = `Delete ${noun.replace(/\b./g, (c) => c.toUpperCase())}?`;

  return (
    <Modal
      open={open}
      // Not closable while the delete is in flight.
      onClose={isDeleting ? undefined : onClose}
      title={title}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isDeleting}
            onClick={deleting ? onDeleteFromDb : onRemoveFromPage}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-60 ${
              deleting
                ? "bg-danger hover:bg-danger/85"
                : "bg-primary hover:bg-primary-dark"
            }`}
          >
            {isDeleting
              ? "Deleting..."
              : deleting
                ? "Delete from the Question Bank"
                : "Remove from this page"}
          </button>
        </>
      }
    >
      {!offerDbOption ? (
        <p className="text-ink">
          {!existsInDb
            ? `This ${noun} has not been saved to the Question Bank yet, so there is nothing to delete there. Removing it here takes it off this page.`
            : `This removes the ${noun} from this page. It stays in the Question Bank — only faculty members can delete it from there.`}
        </p>
      ) : (
        <fieldset className="space-y-3">
          <legend className="mb-3 text-ink">
            This {noun} is saved in the Question Bank. What would you like to do?
          </legend>

          <label
            className={`flex cursor-pointer gap-3 rounded-lg border px-4 py-3 transition-colors ${
              action === "page"
                ? "border-primary bg-primary/5"
                : "border-gray-200 hover:border-primary/40"
            }`}
          >
            <input
              type="radio"
              name="deleteScopeAction"
              value="page"
              checked={action === "page"}
              onChange={() => setAction("page")}
              disabled={isDeleting}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <span className="text-sm">
              <span className="block font-semibold text-ink">
                Remove from this page
              </span>
              <span className="block text-muted">
                The record stays in the Question Bank.
              </span>
            </span>
          </label>

          <label
            className={`flex cursor-pointer gap-3 rounded-lg border px-4 py-3 transition-colors ${
              action === "database"
                ? "border-danger bg-danger/5"
                : "border-gray-200 hover:border-danger/40"
            }`}
          >
            <input
              type="radio"
              name="deleteScopeAction"
              value="database"
              checked={action === "database"}
              onChange={() => setAction("database")}
              disabled={isDeleting}
              className="mt-1 h-4 w-4 accent-danger"
            />
            <span className="text-sm">
              <span className="block font-semibold text-ink">
                Delete from the Question Bank
              </span>
              <span className="block text-muted">
                Deletes it everywhere{alsoDeletes ? `, with ${alsoDeletes}` : ""}.{" "}
                {/* Conditional, because a record with nothing attached is
                    deleted on confirm without a follow-up prompt. */}
                {handoff
                  ? "If any questions are attached, you'll choose what happens to them next."
                  : "This cannot be undone."}
              </span>
            </span>
          </label>
        </fieldset>
      )}
    </Modal>
  );
}
