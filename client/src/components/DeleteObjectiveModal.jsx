import { useEffect, useState } from "react";
import Modal from "./ui/Modal";
import { useObjectiveDeletionImpact } from "../hooks/useObjectives";

// Delete confirmation that first checks for linked questions and, when any
// exist, makes the instructor choose whether to delete them or keep them as
// orphaned drafts. Works for both a whole learning objective and a single
// granular objective (both are queried by id).
//
// Shared by the Question Bank's Objectives tab and step 1 of the generation
// wizard: both end at the same question — what happens to the questions this
// objective produced — and a second copy of that prompt could only drift from
// this one. In the wizard it is the second half of a two-step flow, opened by
// DeleteScopeModal once the instructor has chosen to delete the record.
//
// All this reads from `target` is a kind and the id to check:
// { kind: 'objective', objectiveId } or { kind: 'granular', granularId }.
// Callers may carry more on it; nothing here depends on that.
export default function DeleteObjectiveModal({
  open,
  target,
  onClose,
  onConfirm,
  isSubmitting,
}) {
  const impactId =
    target?.kind === "objective" ? target.objectiveId : target?.granularId;
  const { data, isPending } = useObjectiveDeletionImpact(impactId, {
    enabled: open && !!impactId,
  });
  const [questionAction, setQuestionAction] = useState("keep");

  // Reset the choice each time a different target is opened.
  useEffect(() => {
    if (open) setQuestionAction("keep");
  }, [open, impactId]);

  const isObjective = target?.kind === "objective";
  const impact = data || {};
  const questionCount = impact.questionCount || 0;
  const inQuizCount = impact.inQuizCount || 0;
  const quizNames = impact.quizNames || [];
  const hasLinkedQuestions = questionCount > 0;
  const loading = isPending && !data;

  const title = isObjective
    ? "Delete Learning Objective"
    : "Delete Granular Objective";

  return (
    <Modal
      open={open}
      // Not closable while the delete is in flight.
      onClose={isSubmitting ? undefined : onClose}
      title={title}
      wide={hasLinkedQuestions}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading || isSubmitting}
            onClick={() => onConfirm(hasLinkedQuestions ? questionAction : "keep")}
            className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-danger/85 disabled:opacity-60"
          >
            {isSubmitting
              ? "Deleting..."
              : hasLinkedQuestions && questionAction === "delete"
                ? "Delete objective & questions"
                : "Delete"}
          </button>
        </>
      }
    >
      {loading ? (
        <p className="flex items-center gap-2 text-muted">
          <i className="fas fa-spinner fa-spin" /> Checking for linked questions...
        </p>
      ) : !hasLinkedQuestions ? (
        <p className="text-ink">
          {isObjective
            ? "Are you sure you want to delete this learning objective? This will also delete all associated granular objectives."
            : "Are you sure you want to delete this granular objective?"}
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-ink">
            {isObjective
              ? "Deleting this learning objective will also delete its granular objectives."
              : "Deleting this granular objective affects its questions."}{" "}
            <strong>
              {questionCount} question{questionCount === 1 ? "" : "s"}
            </strong>{" "}
            {questionCount === 1 ? "is" : "are"} attached
            {inQuizCount > 0 && (
              <>
                {" "}
                and{" "}
                <strong>
                  {inQuizCount} {inQuizCount === 1 ? "is" : "are"} currently in a
                  quiz
                </strong>
              </>
            )}
            . Choose what should happen to{" "}
            {questionCount === 1 ? "it" : "them"}:
          </p>

          {quizNames.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <i className="fas fa-triangle-exclamation mr-1.5" />
              Affected {quizNames.length === 1 ? "quiz" : "quizzes"}:{" "}
              {quizNames.join(", ")}
            </div>
          )}

          <label
            className={`flex cursor-pointer gap-3 rounded-lg border px-4 py-3 transition-colors ${
              questionAction === "keep"
                ? "border-primary bg-primary/5"
                : "border-gray-200 hover:border-primary/40"
            }`}
          >
            <input
              type="radio"
              name="questionAction"
              value="keep"
              checked={questionAction === "keep"}
              onChange={() => setQuestionAction("keep")}
              disabled={isSubmitting}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <span className="text-sm">
              <span className="block font-semibold text-ink">
                Keep the questions
              </span>
              <span className="block text-muted">
                Questions are moved to <strong>Draft</strong> and removed from any
                quizzes. They can't be approved until you attach a new learning
                objective to them in the Questions tab.
              </span>
            </span>
          </label>

          <label
            className={`flex cursor-pointer gap-3 rounded-lg border px-4 py-3 transition-colors ${
              questionAction === "delete"
                ? "border-danger bg-danger/5"
                : "border-gray-200 hover:border-danger/40"
            }`}
          >
            <input
              type="radio"
              name="questionAction"
              value="delete"
              checked={questionAction === "delete"}
              onChange={() => setQuestionAction("delete")}
              disabled={isSubmitting}
              className="mt-1 h-4 w-4 accent-danger"
            />
            <span className="text-sm">
              <span className="block font-semibold text-ink">
                Delete the questions
              </span>
              <span className="block text-muted">
                Permanently delete{" "}
                {questionCount === 1 ? "this question" : "these questions"} along
                with the objective. This cannot be undone.
              </span>
            </span>
          </label>
        </div>
      )}
    </Modal>
  );
}
