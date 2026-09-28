import { useEffect, useState } from "react";
import Modal from "../../components/ui/Modal";

// Delete confirmation for a Step 2 question already added to the Question Bank.
// Two outcomes: remove from the page only, or delete the bank record as well.
// "Remove from this page" is pre-selected; non-faculty only get that option.
export default function DeleteSavedQuestionModal({
  open,
  canDeleteFromBank,
  isDeleting,
  onClose,
  onRemoveFromPage,
  onDeleteFromBank,
}) {
  const [action, setAction] = useState("page");

  // Start from the safe choice every time the modal opens.
  useEffect(() => {
    if (open) setAction("page");
  }, [open]);

  const deleting = canDeleteFromBank && action === "bank";

  return (
    <Modal
      open={open}
      // Not closable while the delete is in flight.
      onClose={isDeleting ? undefined : onClose}
      title="Delete Question"
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
            onClick={deleting ? onDeleteFromBank : onRemoveFromPage}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-60 ${
              deleting ? "bg-danger hover:bg-danger/85" : "bg-primary hover:bg-primary-dark"
            }`}
          >
            {isDeleting
              ? "Deleting..."
              : deleting
                ? "Delete from Question Bank"
                : "Remove from this page"}
          </button>
        </>
      }
    >
      {!canDeleteFromBank ? (
        <p className="text-ink">
          Questions added to the Question Bank can only be deleted by faculty
          members. Deleting it here only removes it from this page.
        </p>
      ) : (
        <fieldset className="space-y-3">
          <legend className="mb-3 text-ink">
            This question has already been added to the Question Bank. What would you
            like to do?
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
              name="deleteQuestionAction"
              value="page"
              checked={action === "page"}
              onChange={() => setAction("page")}
              disabled={isDeleting}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <span className="text-sm">
              <span className="block font-semibold text-ink">
                Remove from this page only
              </span>
              <span className="block text-muted">
                The question stays in the Question Bank, where you can still find and
                use it.
              </span>
            </span>
          </label>

          <label
            className={`flex cursor-pointer gap-3 rounded-lg border px-4 py-3 transition-colors ${
              action === "bank"
                ? "border-danger bg-danger/5"
                : "border-gray-200 hover:border-danger/40"
            }`}
          >
            <input
              type="radio"
              name="deleteQuestionAction"
              value="bank"
              checked={action === "bank"}
              onChange={() => setAction("bank")}
              disabled={isDeleting}
              className="mt-1 h-4 w-4 accent-danger"
            />
            <span className="text-sm">
              <span className="block font-semibold text-ink">
                Delete from the Question Bank
              </span>
              <span className="block text-muted">
                Permanently deletes the question from the Question Bank. This cannot be undone.
              </span>
            </span>
          </label>
        </fieldset>
      )}
    </Modal>
  );
}
