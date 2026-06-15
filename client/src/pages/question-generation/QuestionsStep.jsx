import { useState } from "react";
import { ConfirmModal } from "../../components/ui/Modal";
import QuestionCard from "./QuestionCard";

export default function QuestionsStep({
  questionGroups,
  setQuestionGroups,
  generating,
  generationMessage,
  generationError,
  onRegenerateAll,
  onRetry,
  onSaveDraft,
}) {
  const [deleteTargetId, setDeleteTargetId] = useState(null);

  const updateQuestion = (questionId, updates) => {
    setQuestionGroups((prev) =>
      prev.map((group) => ({
        ...group,
        los: group.los.map((lo) => ({
          ...lo,
          questions: lo.questions.map((q) =>
            q.id === questionId ? { ...q, ...updates } : q
          ),
        })),
      }))
    );
  };

  const deleteQuestion = (questionId) => setDeleteTargetId(questionId);

  const confirmDeleteQuestion = () => {
    const questionId = deleteTargetId;
    setQuestionGroups((prev) =>
      prev
        .map((group) => ({
          ...group,
          los: group.los
            .map((lo) => ({
              ...lo,
              questions: lo.questions.filter(
                (q) => q.id !== questionId && q._id !== questionId
              ),
            }))
            .filter((lo) => lo.questions.length > 0),
        }))
        .filter((group) => group.los.length > 0)
    );
    onSaveDraft();
  };

  if (generating) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl bg-white py-20 text-center shadow-sm">
        <i className="fas fa-spinner fa-spin mb-5 text-4xl text-primary" />
        <p className="text-muted">{generationMessage}</p>
      </div>
    );
  }

  if (generationError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-10 text-center">
        <div className="mb-3 text-xl font-semibold text-red-600">
          ⚠️ Question Generation Unavailable
        </div>
        <p className="mb-2 text-ink">
          {generationError ||
            "There is currently a problem with the question generation service."}
        </p>
        <p className="mb-6 text-sm text-muted">
          Please check that all required services are running and try again later.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-red-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-red-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (questionGroups.length === 0) {
    return (
      <div className="rounded-2xl bg-white py-16 text-center shadow-sm">
        <i className="fas fa-search mb-4 text-4xl text-gray-300" />
        <h3 className="text-lg font-semibold text-ink">No questions found</h3>
        <p className="mt-1 text-muted">Try adjusting your filters or search terms.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex justify-end">
        <button
          type="button"
          onClick={onRegenerateAll}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 font-medium text-ink transition-colors hover:bg-gray-50"
        >
          <i className="fas fa-sync-alt" /> Regenerate All
        </button>
      </div>

      <div className="space-y-6">
        {questionGroups.map((group) => (
          <div key={group.id} className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <button
              type="button"
              onClick={() =>
                setQuestionGroups((prev) =>
                  prev.map((g) =>
                    g.id === group.id ? { ...g, isOpen: !g.isOpen } : g
                  )
                )
              }
              className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
            >
              <h3 className="font-semibold text-ink">{group.title}</h3>
              <span className="flex items-center gap-2 text-sm text-muted">
                {group.isOpen ? "Collapse" : "Expand"}
                <i
                  className={`fas fa-chevron-down transition-transform ${
                    group.isOpen ? "" : "-rotate-90"
                  }`}
                />
              </span>
            </button>

            {group.isOpen && (
              <div className="space-y-6 border-t border-gray-100 p-6">
                {group.los.map((lo) => (
                  <div key={lo.id}>
                    <div className="mb-3 flex flex-wrap items-center gap-4">
                      <h4 className="font-semibold text-ink">{lo.code}</h4>
                      <span className="text-sm text-muted">
                        Generated: {lo.generated}
                      </span>
                      <span className="text-sm text-muted">Min: {lo.min}</span>
                    </div>
                    <div className="space-y-4">
                      {lo.questions.map((question) => (
                        <QuestionCard
                          key={question.id}
                          question={question}
                          onChange={(updates) => updateQuestion(question.id, updates)}
                          onDelete={() => deleteQuestion(question.id)}
                          onSaveDraft={onSaveDraft}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <ConfirmModal
        open={!!deleteTargetId}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={confirmDeleteQuestion}
        title="Delete Question"
        message="Are you sure you want to delete this question? This action cannot be undone."
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}
