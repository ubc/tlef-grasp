import { useEffect, useState } from "react";
import Modal from "../../components/ui/Modal";
import SearchableSelect from "../../components/ui/SearchableSelect";
import RichText from "../../components/RichText";
import { escapeHtml } from "../../lib/format";

// Asks for a new learning objective for each question whose objective was
// deleted. The save waits until every one has a pick; cancelling saves nothing.
export default function ReselectObjectivesModal({
  open,
  questions,
  granulars,
  onCancel,
  onConfirm,
}) {
  const [picks, setPicks] = useState(() => new Map());

  useEffect(() => {
    if (open) setPicks(new Map());
  }, [open]);

  const options = granulars.map((granular) => ({
    value: granular.id,
    label: granular.name,
    group: granular.metaName,
  }));
  const canSave = granulars.length > 0 && questions.every((question) => picks.has(question.id));
  const plural = questions.length !== 1;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Choose New Learning Objectives"
      wide
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => onConfirm(picks)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
          >
            Save with New Objectives
          </button>
        </>
      }
    >
      {granulars.length === 0 ? (
        <p className="text-sm text-ink">
          The learning objective for {questions.length} question{plural ? "s" : ""} was deleted,
          and this course has no learning objectives left to choose from. Add one in the
          Question Bank&apos;s Learning Objectives tab, then save again.
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-ink">
            The learning objective for {questions.length} question{plural ? "s" : ""} was deleted.
            Choose a new one for {plural ? "each" : "it"} before saving.
          </p>
          <div className="space-y-3">
            {questions.map((question, index) => (
              <div key={question.id} className="rounded-xl border border-gray-200 p-3">
                <RichText
                  as="p"
                  text={escapeHtml(question.title || question.stem || "Untitled question")}
                  className="mb-1 whitespace-pre-line text-sm font-medium text-ink"
                />
                {question.loCode && (
                  <p className="mb-2 text-xs text-muted">
                    Deleted objective:{" "}
                    <RichText as="span" text={escapeHtml(question.loCode)} />
                  </p>
                )}
                <SearchableSelect
                  ariaLabel={`New learning objective for question ${index + 1}`}
                  value={picks.get(question.id) || ""}
                  onChange={(granularId) =>
                    setPicks((previous) => new Map(previous).set(question.id, granularId))
                  }
                  options={options}
                  placeholder="— Select a learning objective —"
                  searchPlaceholder="Search learning objectives..."
                />
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
