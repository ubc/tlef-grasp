import { useEffect } from "react";
import CanvasAssignmentPromptModal from "./CanvasAssignmentPromptModal";
import {
  useEnsureSectionQuizAssignments,
  useSectionQuizAssignments,
} from "../../hooks/useCanvasAssignments";
import { promptItemsForQuizzes } from "../../lib/canvasAssignments";
import { pluralize } from "../../lib/lmsRosterSync";
import { useToast } from "../ui/Toast";

// Right after a section is linked to Canvas: if quizzes are already scheduled
// on it, ask once whether to create their Canvas assignments (issue #125).
// Renders nothing, and closes itself, when there is nothing to ask.
export default function LinkedSectionAssignmentsPrompt({ courseId, section, enabled, onClose }) {
  const showToast = useToast();
  const query = useSectionQuizAssignments(courseId, section?.sectionId, {
    enabled: enabled && !!section,
  });
  const items = promptItemsForQuizzes(query.quizzes);

  const mutation = useEnsureSectionQuizAssignments(courseId, {
    onSuccess: ({ results }, { action }) => {
      if (action === "decline") return;
      const created = results.filter((r) => r.status === "created").length;
      const failed = results.filter((r) => r.status === "failed");
      if (created > 0) {
        showToast(
          `${pluralize(created, "Canvas assignment")} created`,
          failed.length > 0 ? "warning" : "success"
        );
      }
      for (const failure of failed) {
        showToast(`Canvas assignment not created: ${failure.error}`, "error");
      }
    },
    onError: (error) =>
      showToast(error.message || "Canvas could not be updated. Please try again.", "error"),
  });

  const nothingToAsk =
    !!section && (!enabled || query.isError || (query.isSuccess && items.length === 0));
  useEffect(() => {
    if (nothingToAsk) onClose();
  }, [nothingToAsk, onClose]);

  if (!section || !query.isSuccess || items.length === 0) return null;

  const run = (action) =>
    mutation.mutate(
      { courseSectionId: section._id, quizIds: items.map((item) => item.key), action },
      { onSettled: onClose }
    );

  return (
    <CanvasAssignmentPromptModal
      open
      items={items}
      busy={mutation.isPending}
      onClose={onClose}
      onCreate={() => run("create")}
      onDecline={() => run("decline")}
    />
  );
}
