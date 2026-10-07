import { useEffect, useState } from "react";
import Modal from "./ui/Modal";

// One radio card per meaning of "delete". Class names are spelled out rather
// than built from `danger`: Tailwind only generates what it can find verbatim.
function ScopeOption({ value, action, setAction, danger, disabled, title, children }) {
  const selected = action === value;
  const tone = danger
    ? { on: "border-danger bg-danger/5", off: "hover:border-danger/40", accent: "accent-danger" }
    : { on: "border-primary bg-primary/5", off: "hover:border-primary/40", accent: "accent-primary" };
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-lg border px-4 py-3 transition-colors ${
        selected ? tone.on : `border-gray-200 ${tone.off}`
      }`}
    >
      <input
        type="radio"
        name="deleteScopeAction"
        value={value}
        checked={selected}
        onChange={() => setAction(value)}
        disabled={disabled}
        className={`mt-1 h-4 w-4 ${tone.accent}`}
      />
      <span className="text-sm">
        <span className="block font-semibold text-ink">{title}</span>
        <span className="block text-muted">{children}</span>
      </span>
    </label>
  );
}

// "Delete" means two things in the generation wizard, and this is where the
// instructor says which they meant: drop it from the page in front of them, or
// delete the record from the Question Bank. Questions (step 2) and learning
// objectives (step 1) share it because the question is the same either way —
// only the noun changes. The safe option is pre-selected, the database option
// is left out entirely (with copy saying why) when there is no saved record or
// the instructor is not faculty, and nothing calls a page removal permanent.
//
// `handoff` marks the one difference between callers: a question is deleted the
// moment this is confirmed, while an objective goes on to the linked-questions
// choice (DeleteObjectiveModal). Either way the caller does the deleting.
export default function DeleteScopeModal({
  open,
  noun,
  existsInDb,
  canDeleteFromDb,
  isDeleting = false,
  handoff = false,
  // Extra records the database delete takes with it, e.g. "its granular
  // objectives", so the blast radius is not a surprise.
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

  return (
    <Modal
      open={open}
      // Not closable while the delete is in flight.
      onClose={isDeleting ? undefined : onClose}
      title={`Delete ${noun.replace(/\b./g, (c) => c.toUpperCase())}?`}
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
          <ScopeOption
            value="page"
            action={action}
            setAction={setAction}
            disabled={isDeleting}
            title="Remove from this page"
          >
            The record stays in the Question Bank.
          </ScopeOption>
          <ScopeOption
            value="database"
            action={action}
            setAction={setAction}
            danger
            disabled={isDeleting}
            title="Delete from the Question Bank"
          >
            Deletes it everywhere{alsoDeletes ? `, with ${alsoDeletes}` : ""}.{" "}
            {handoff
              ? "If any questions are attached, you'll choose what happens to them next."
              : "This cannot be undone."}
          </ScopeOption>
        </fieldset>
      )}
    </Modal>
  );
}
