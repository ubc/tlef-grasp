import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useUpdateQuestion,
  useBulkUpdateQuestions,
  useBulkDeleteQuestions,
} from "../../hooks/useQuestions";
import { useAddExistingQuestionsToQuiz } from "../../hooks/useQuizzes";
import { useDetailedObjectives } from "../../hooks/useObjectives";
import { useToast } from "../../components/ui/Toast";
import Modal, { ConfirmModal } from "../../components/ui/Modal";
import RichText from "../../components/RichText";
import { escapeHtml } from "../../lib/format";
import {
  toStringId,
  getObjectId,
  formatQuestionTypeLabel,
  QUESTION_TYPE_CHIP_CLASSES,
} from "../../lib/utils";
import { useQuestionBankData } from "./useQuestionBankData";
import QuestionEditModal from "./QuestionEditModal";
import AddQuestionWizard from "./AddQuestionWizard";

const STATUS_PILL_CLASSES = {
  approved: "bg-green-100 text-green-700",
  draft: "bg-gray-100 text-gray-600",
  flagged: "bg-red-100 text-red-700",
};

const SORT_COLUMNS = [
  { key: "title", label: "Question Title" },
  { key: "glo", label: "Associated GLO" },
  { key: "bloom", label: "Bloom's Level", nowrap: true },
  { key: "questionType", label: "Question Type", nowrap: true },
  { key: "status", label: "Status", nowrap: true },
];

const selectClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none";

function FiltersPanel({ filters, setFilter, quizzes, objectiveOptions, bloomLevels, statuses }) {
  return (
    <div className="mb-5 rounded-2xl bg-white p-5 shadow-sm">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div>
          <label htmlFor="qbank-filter-quiz" className="mb-1 block text-xs font-semibold text-muted">Quiz</label>
          <select
            id="qbank-filter-quiz"
            value={filters.quiz}
            onChange={(event) => setFilter("quiz", event.target.value)}
            className={selectClass}
          >
            <option value="all">All Quizzes</option>
            {quizzes.map((quiz) => (
              <option key={quiz._id || quiz.id} value={quiz._id || quiz.id}>
                {quiz.name || "Unnamed Quiz"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="qbank-filter-objective" className="mb-1 block text-xs font-semibold text-muted">
            Learning Objectives
          </label>
          <select
            id="qbank-filter-objective"
            value={filters.objective}
            onChange={(event) => setFilter("objective", event.target.value)}
            className={selectClass}
          >
            <option value="all">All Objectives</option>
            {objectiveOptions.map((objective) => (
              <option key={objective.id} value={objective.id}>
                {objective.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="qbank-filter-bloom" className="mb-1 block text-xs font-semibold text-muted">
            Bloom Levels
          </label>
          <select
            id="qbank-filter-bloom"
            value={filters.bloom}
            onChange={(event) => setFilter("bloom", event.target.value)}
            className={selectClass}
          >
            <option value="all">All Bloom Levels</option>
            {bloomLevels.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="qbank-filter-status" className="mb-1 block text-xs font-semibold text-muted">Status</label>
          <select
            id="qbank-filter-status"
            value={filters.status}
            onChange={(event) => setFilter("status", event.target.value)}
            className={selectClass}
          >
            <option value="all">All Statuses</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <div className="min-w-64 flex-1">
          <label className="mb-1 block text-xs font-semibold text-muted">Search</label>
          <div className="relative">
            <i className="fas fa-search absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={filters.q}
              onChange={(event) => setFilter("q", event.target.value, "")}
              placeholder="Search questions..."
              className="w-full rounded-lg border border-gray-300 py-2 pr-3 pl-9 text-sm focus:border-primary focus:outline-none"
            />
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={filters.flagged}
            onChange={(event) => setFilter("flagged", event.target.checked, false)}
            className="h-4 w-4 accent-primary"
          />
          <span>Show flagged only</span>
        </label>
      </div>
    </div>
  );
}

function BulkActionBar({ selectedCount, busy, onAction, onDelete }) {
  const actionBtnClass =
    "inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-40";
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 shadow-sm">
      <span className="text-sm text-muted">
        {selectedCount} question{selectedCount !== 1 ? "s" : ""} selected
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={selectedCount === 0 || busy}
          onClick={() => onAction("approve")}
          className={actionBtnClass}
        >
          <i className="fas fa-check" /> Approve
        </button>
        <button
          type="button"
          disabled={selectedCount === 0 || busy}
          onClick={() => onAction("unapprove")}
          className={actionBtnClass}
        >
          <i className="fas fa-times" /> Unapprove
        </button>
        <button
          type="button"
          disabled={selectedCount === 0 || busy}
          onClick={() => onAction("flag")}
          className={actionBtnClass}
        >
          <i className="fas fa-flag" /> Flag
        </button>
        <button
          type="button"
          disabled={selectedCount === 0 || busy}
          onClick={onDelete}
          className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-40"
        >
          <i className="fas fa-trash" /> Delete
        </button>
      </div>
    </div>
  );
}

function AddExistingQuestionsModal({
  open,
  quiz,
  questions,
  questionIdsInQuiz,
  onClose,
  onAdd,
  isSubmitting,
}) {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set());
    setSearch("");
  }, [open, quiz?.id, quiz?._id]);

  const visibleQuestions = useMemo(() => {
    const term = search.trim().toLowerCase();
    return questions
      .filter((question) => {
        if (question.orphaned || !question.hasGranularObjective) return false;
        if (!term) return true;
        return [question.title, question.stem, question.glo, question.bloom]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
      })
      .sort(
        (a, b) =>
          Number(questionIdsInQuiz.has(a.id)) - Number(questionIdsInQuiz.has(b.id))
      );
  }, [questions, search, questionIdsInQuiz]);

  const toggleQuestion = (questionId) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Add existing questions to ${quiz?.name || "quiz"}`}
      wide
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
            disabled={selectedIds.size === 0 || isSubmitting}
            onClick={() => onAdd(Array.from(selectedIds))}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
          >
            {isSubmitting
              ? "Adding..."
              : `Add ${selectedIds.size} question${selectedIds.size === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">
        Choose from the existing questions in this course. Questions already in this quiz are unavailable.
      </p>
      <label htmlFor="existing-quiz-questions-search" className="mb-1 block text-sm font-semibold text-ink">
        Search questions
      </label>
      <input
        id="existing-quiz-questions-search"
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search question text or learning objective..."
        className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
      />
      <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
        {visibleQuestions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-200 bg-page px-4 py-5 text-center text-sm text-muted">
            No eligible questions found.
          </p>
        ) : (
          visibleQuestions.map((question) => {
            const alreadyAdded = questionIdsInQuiz.has(question.id);
            const checked = selectedIds.has(question.id);
            return (
              <label
                key={question.id}
                className={`flex items-start gap-3 rounded-xl border p-3 ${
                  alreadyAdded
                    ? "cursor-not-allowed border-gray-200 bg-gray-50 opacity-60"
                    : "cursor-pointer border-gray-200 hover:border-primary/40 hover:bg-primary/5"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={alreadyAdded}
                  onChange={() => toggleQuestion(question.id)}
                  className="mt-1 h-4 w-4 shrink-0 accent-primary"
                />
                <span className="min-w-0 flex-1">
                  <RichText
                    as="span"
                    text={escapeHtml(question.title || question.stem || "Untitled question")}
                    className="block text-sm font-medium text-ink"
                  />
                  <span className="mt-1 block text-xs text-muted">
                    {question.glo || "Learning objective unavailable"}
                    {question.bloom ? ` · ${question.bloom}` : ""}
                  </span>
                </span>
                {alreadyAdded && (
                  <span className="shrink-0 rounded-full bg-gray-200 px-2 py-1 text-xs font-semibold text-muted">
                    Already added
                  </span>
                )}
              </label>
            );
          })
        )}
      </div>
    </Modal>
  );
}

// Attach a new learning objective to an orphaned question. Re-attaching clears
// the orphaned state on the server and re-enables approval.
function ReassignObjectiveModal({ open, question, objectives, onClose, onConfirm, isSubmitting }) {
  const [granularId, setGranularId] = useState("");

  useEffect(() => {
    if (open) setGranularId("");
  }, [open, question?.id]);

  const hasOptions = objectives.some((o) => (o.granular || []).length > 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Attach Learning Objective"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!granularId || isSubmitting}
            onClick={() => onConfirm(granularId)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
          >
            {isSubmitting ? "Attaching..." : "Attach & restore"}
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink">
        This question has no learning objective attached. Pick a granular
        objective to attach it to — the question will leave the orphaned state
        and can be approved again.
      </p>
      {hasOptions ? (
        <select
          value={granularId}
          onChange={(event) => setGranularId(event.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Select a granular objective…</option>
          {objectives.map((objective) => {
            const granular = objective.granular || [];
            if (granular.length === 0) return null;
            return (
              <optgroup key={objective.id} label={objective.name}>
                {granular.map((g) => {
                  const gId = getObjectId(g);
                  return (
                    <option key={gId} value={gId}>
                      {g.name || g.text || "Unnamed granular objective"}
                    </option>
                  );
                })}
              </optgroup>
            );
          })}
        </select>
      ) : (
        <p className="rounded-lg border border-dashed border-gray-200 bg-page px-4 py-3 text-sm text-muted">
          No granular objectives are available in this course. Create one in the
          Objectives tab first, then attach this question to it.
        </p>
      )}
    </Modal>
  );
}

export default function QuestionsTab({ courseId, isFaculty }) {
  const showToast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { questions, quizzes, objectives, isPending } = useQuestionBankData(courseId);
  // Detailed objectives (with granular children) power the reassign picker.
  const { objectives: detailedObjectives } = useDetailedObjectives(courseId);

  const filters = {
    quiz: searchParams.get("quiz") || "all",
    objective: searchParams.get("objective") || "all",
    bloom: searchParams.get("bloom") || "all",
    status: searchParams.get("status") || "all",
    flagged: searchParams.get("flagged") === "true",
    q: searchParams.get("q") || "",
  };

  const setFilter = (name, value, defaultValue = "all") => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value && value !== defaultValue && value !== "" && value !== false) {
          next.set(name, value === true ? "true" : value);
        } else {
          next.delete(name);
        }
        return next;
      },
      { replace: true }
    );
  };

  const [sort, setSort] = useState({ key: "title", dir: "asc" });
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [editTarget, setEditTarget] = useState(null);
  const [reassignTarget, setReassignTarget] = useState(null);
  const [showAddWizard, setShowAddWizard] = useState(false);
  const [showAddExistingModal, setShowAddExistingModal] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  // Inline flag-reason drafts, keyed by question id and persisted on blur.
  const [reasonDrafts, setReasonDrafts] = useState({});
  const [savingReasonId, setSavingReasonId] = useState(null);

  // Staff cannot edit approved questions; faculty can edit everything
  const canEditQuestion = (question) =>
    isFaculty || (question.status || "Draft").toLowerCase() !== "approved";

  /* ------------------------------ Mutations ------------------------------ */

  const updateMutation = useUpdateQuestion(courseId, {
    onSuccess: (data, variables) => {
      if (variables.successMessage) showToast(variables.successMessage, "success");
    },
    onError: (error, variables) =>
      showToast(variables.errorMessage || "Failed to update question", "error"),
  });

  const bulkUpdateMutation = useBulkUpdateQuestions(courseId, {
    onSuccess: (successCount, variables) => {
      if (successCount > 0) {
        showToast(`${variables.label} ${successCount} question(s)`, "success");
      } else {
        showToast("Failed to update questions", "error");
      }
    },
  });

  const bulkDeleteMutation = useBulkDeleteQuestions(courseId, {
    onSuccess: (successCount) => {
      if (successCount > 0) {
        setSelectedIds(new Set());
        showToast(`Deleted ${successCount} question(s)`, "success");
      } else {
        showToast("Failed to delete questions", "error");
      }
    },
  });

  const bulkBusy = bulkUpdateMutation.isPending || bulkDeleteMutation.isPending;

  const activeQuiz = useMemo(
    () => quizzes.find((quiz) => toStringId(quiz._id || quiz.id) === filters.quiz) || null,
    [quizzes, filters.quiz]
  );
  const questionIdsInActiveQuiz = useMemo(
    () => new Set((activeQuiz?.questions || []).map((question) => getObjectId(question))),
    [activeQuiz]
  );
  const addExistingQuestionsMutation = useAddExistingQuestionsToQuiz(courseId, {
    onSuccess: (data) => {
      showToast(
        `Added ${data.insertedCount} question${data.insertedCount === 1 ? "" : "s"} to the quiz`,
        "success"
      );
      setShowAddExistingModal(false);
    },
    onError: (error) => showToast(error.message || "Failed to add questions to the quiz", "error"),
  });

  const requireFaculty = (action) => {
    if (!isFaculty) {
      showToast(`Only faculty can ${action}`, "error");
      return false;
    }
    return true;
  };

  const bulkUpdate = (action) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    if (action === "approve") {
      if (!requireFaculty("bulk approve questions")) return;
      bulkUpdateMutation.mutate({
        questionIds: ids,
        updates: { status: "Approved" },
        label: "Approved",
      });
    } else if (action === "unapprove") {
      if (!requireFaculty("bulk unapprove questions")) return;
      bulkUpdateMutation.mutate({
        questionIds: ids,
        updates: { status: "Draft" },
        label: "Unapproved",
      });
    } else if (action === "flag") {
      if (!requireFaculty("bulk flag questions")) return;
      const firstQuestion = questions.find((q) => q.id === ids[0]);
      const shouldFlag = !firstQuestion?.flagged;
      bulkUpdateMutation.mutate({
        questionIds: ids,
        updates: { flagStatus: shouldFlag },
        label: shouldFlag ? "Flagged" : "Unflagged",
      });
    }
  };

  const bulkDelete = () => {
    if (!requireFaculty("delete questions")) return;
    if (selectedIds.size === 0) return;
    setConfirmBulkDelete(true);
  };

  const toggleFlag = (question) => {
    const newFlag = !question.flagged;
    // Unflagging clears the reason server-side; drop any local draft too.
    if (!newFlag) {
      setReasonDrafts((prev) => {
        const next = { ...prev };
        delete next[question.id];
        return next;
      });
    }
    updateMutation.mutate({
      questionId: question.id,
      updates: { flagStatus: newFlag },
      successMessage: `Question ${newFlag ? "flagged" : "unflagged"} successfully`,
      errorMessage: "Failed to update question flag status",
    });
  };

  const reasonValue = (question) =>
    reasonDrafts[question.id] !== undefined
      ? reasonDrafts[question.id]
      : question.flagReason || "";

  const setReasonDraft = (question, value) =>
    setReasonDrafts((prev) => ({ ...prev, [question.id]: value }));

  // Persist the reason on blur, only when it actually changed.
  const saveReason = (question) => {
    const draft = reasonDrafts[question.id];
    if (draft === undefined) return;
    const trimmed = draft.trim();
    setReasonDrafts((prev) => {
      const next = { ...prev };
      delete next[question.id];
      return next;
    });
    if (trimmed === (question.flagReason || "")) return;
    setSavingReasonId(question.id);
    updateMutation.mutate({
      questionId: question.id,
      updates: { flagReason: trimmed },
      successMessage: trimmed ? "Flag reason saved" : "Flag reason cleared",
      errorMessage: "Failed to save flag reason",
    }, {
      onSettled: () => setSavingReasonId(null),
    });
  };

  const toggleApproval = (question, approve) => {
    updateMutation.mutate({
      questionId: question.id,
      updates: { status: approve ? "Approved" : "Draft" },
      successMessage: `Question ${approve ? "approved" : "unapproved"} successfully`,
      errorMessage: "Failed to update question status",
    });
  };

  const confirmReassign = (granularObjectiveId) => {
    if (!reassignTarget || !granularObjectiveId) return;
    updateMutation.mutate({
      questionId: reassignTarget.id,
      updates: { granularObjectiveId },
      successMessage: "Learning objective attached; question restored to Draft",
      errorMessage: "Failed to attach learning objective",
    });
    setReassignTarget(null);
  };

  /* ----------------------------- Derived data ---------------------------- */

  const filtered = useMemo(() => {
    let result = [...questions];
    if (filters.quiz !== "all") {
      const selectedQuiz = quizzes.find(
        (quiz) => toStringId(quiz._id || quiz.id) === filters.quiz
      );
      const selectedQuestionIds = new Set(
        (selectedQuiz?.questions || []).map(getObjectId)
      );
      result = result.filter((question) => selectedQuestionIds.has(question.id));
    }
    if (filters.objective !== "all") {
      result = result.filter((q) => String(q.objectiveId || "") === filters.objective);
    }
    if (filters.bloom !== "all") {
      result = result.filter((q) => q.bloom === filters.bloom);
    }
    if (filters.status !== "all") {
      result = result.filter((q) => q.status === filters.status);
    }
    if (filters.flagged) {
      result = result.filter((q) => q.flagged === true);
    }
    if (filters.q) {
      const term = filters.q.toLowerCase();
      result = result.filter((q) => {
        const typeLabel = formatQuestionTypeLabel(q.questionType).toLowerCase();
        return (
          (q.title && q.title.toLowerCase().includes(term)) ||
          (q.stem && q.stem.toLowerCase().includes(term)) ||
          (q.glo && q.glo.toLowerCase().includes(term)) ||
          (q.calculationFormula &&
            String(q.calculationFormula).toLowerCase().includes(term)) ||
          typeLabel.includes(term)
        );
      });
    }
    return result;
  }, [questions, quizzes, filters.quiz, filters.objective, filters.bloom, filters.status, filters.flagged, filters.q]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const key = sort.key;
      const aValue = (a[key] || (key === "status" ? "Draft" : "")).toLowerCase();
      const bValue = (b[key] || (key === "status" ? "Draft" : "")).toLowerCase();
      if (sort.dir === "asc") return aValue > bValue ? 1 : -1;
      return aValue < bValue ? 1 : -1;
    });
  }, [filtered, sort]);

  // Filter option lists derived from data
  const bloomLevels = useMemo(
    () => Array.from(new Set(questions.map((q) => q.bloom).filter(Boolean))).sort(),
    [questions]
  );
  const statuses = useMemo(() => {
    const required = ["Approved", "Draft"];
    const extra = Array.from(
      new Set(
        questions
          .map((q) => q.status)
          .filter((status) => status && !required.includes(status))
      )
    ).sort();
    return [...required, ...extra];
  }, [questions]);
  const objectiveOptions = useMemo(() => {
    const ids = new Set(questions.map((q) => q.objectiveId).filter(Boolean));
    const map = new Map(objectives.map((o) => [o.id, o.name]));
    return Array.from(ids)
      .map((id) => ({ id, name: map.get(id) || `Objective ${id.substring(0, 8)}...` }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [questions, objectives]);

  const toggleSelection = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = (checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filtered.forEach((q) => {
        if (checked) next.add(q.id);
        else next.delete(q.id);
      });
      return next;
    });
  };

  const visibleSelectedCount = filtered.filter((q) => selectedIds.has(q.id)).length;
  const allVisibleSelected =
    filtered.length > 0 && visibleSelectedCount === filtered.length;

  /* -------------------------------- Render ------------------------------- */

  return (
    <div>
      <FiltersPanel
        filters={filters}
        setFilter={setFilter}
        quizzes={quizzes}
        objectiveOptions={objectiveOptions}
        bloomLevels={bloomLevels}
        statuses={statuses}
      />

      {isFaculty && (
        <>
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setShowAddWizard(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
            >
              <i className="fas fa-plus" /> Add New Question
            </button>
            {activeQuiz && (
              <button
                type="button"
                onClick={() => setShowAddExistingModal(true)}
                className="ml-3 inline-flex items-center gap-2 rounded-lg border border-primary px-4 py-2.5 font-medium text-primary transition-colors hover:bg-primary/5"
              >
                <i className="fas fa-plus" /> Add Existing Questions
              </button>
            )}
          </div>
          <BulkActionBar
            selectedCount={selectedIds.size}
            busy={bulkBusy}
            onAction={bulkUpdate}
            onDelete={bulkDelete}
          />
        </>
      )}

      {/* Questions table */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr>
                {isFaculty && (
                  <th className="w-12 border-b border-gray-200 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all questions"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) {
                          el.indeterminate =
                            visibleSelectedCount > 0 && !allVisibleSelected;
                        }
                      }}
                      onChange={(event) => handleSelectAll(event.target.checked)}
                      className="h-4 w-4 accent-primary"
                    />
                  </th>
                )}
                {SORT_COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    onClick={() =>
                      setSort((prev) => ({
                        key: column.key,
                        dir:
                          prev.key === column.key && prev.dir === "asc" ? "desc" : "asc",
                      }))
                    }
                    aria-sort={
                      sort.key === column.key
                        ? sort.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    className={`cursor-pointer border-b border-gray-200 px-4 py-3 text-left text-sm font-semibold text-muted select-none hover:text-ink ${
                      column.nowrap ? "whitespace-nowrap" : ""
                    }`}
                  >
                    {column.label}{" "}
                    <i
                      className={`fas ${
                        sort.key === column.key
                          ? sort.dir === "asc"
                            ? "fa-sort-up"
                            : "fa-sort-down"
                          : "fa-sort"
                      } ml-1 text-xs`}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isPending ? (
                <tr>
                  <td
                    colSpan={isFaculty ? 6 : 5}
                    className="py-12 text-center text-muted"
                  >
                    <i className="fas fa-spinner fa-spin mb-2 text-2xl" />
                    <p>Loading questions...</p>
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={isFaculty ? 6 : 5}
                    className="py-12 text-center text-muted"
                  >
                    <p>No questions available.</p>
                    <p>You haven't saved any questions from question generation yet.</p>
                    <p>
                      Go to{" "}
                      <Link to="/question-generation" className="text-primary underline">
                        Question Generation
                      </Link>{" "}
                      to create and save your first questions.
                    </p>
                  </td>
                </tr>
              ) : (
                sorted.map((question) => {
                  const isSelected = selectedIds.has(question.id);
                  const canEdit = canEditQuestion(question);
                  return (
                    <tr
                      key={question.id}
                      className={`group ${isSelected ? "bg-primary/5" : "hover:bg-gray-50"}`}
                    >
                      {isFaculty && (
                        <td className="border-b border-gray-100 px-4 py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelection(question.id)}
                            className="h-4 w-4 accent-primary"
                          />
                        </td>
                      )}
                      <td className="border-b border-gray-100 px-4 py-3">
                        <div
                          className={`flex items-start gap-1.5 text-sm font-medium ${
                            question.flagged ? "text-danger" : "text-ink"
                          }`}
                        >
                          {question.flagged && (
                            <i className="fas fa-flag mt-1 text-xs" />
                          )}
                          <RichText
                            as="span"
                            text={escapeHtml(question.title)}
                            className="min-w-0"
                          />
                        </div>
                        <div className="mt-1.5 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            title={question.flagged ? "Unflag Question" : "Flag Question"}
                            onClick={() => toggleFlag(question)}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                              question.flagged
                                ? "bg-danger/10 text-danger hover:bg-danger/20"
                                : "bg-gray-100 text-muted hover:bg-gray-200"
                            }`}
                          >
                            <i className="fas fa-flag" />
                            {question.flagged ? "Unflag" : "Flag"}
                          </button>
                          <button
                            type="button"
                            title={
                              canEdit
                                ? "View/Edit Question"
                                : "View Question (Read-only - approved question)"
                            }
                            onClick={() => setEditTarget({ id: question.id, canEdit })}
                            className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-gray-200"
                          >
                            <i className="fas fa-eye" />
                            {canEdit ? "View/Edit" : "View Only"}
                          </button>
                          {isFaculty &&
                            (question.orphaned ? (
                              <button
                                type="button"
                                title="This question has no learning objective. Attach one to enable approval."
                                onClick={() => setReassignTarget(question)}
                                className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-200"
                              >
                                <i className="fas fa-link" /> Attach objective
                              </button>
                            ) : (question.status || "").toLowerCase() === "approved" ? (
                              <button
                                type="button"
                                title="Unapprove Question"
                                onClick={() => toggleApproval(question, false)}
                                className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-2 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning/25"
                              >
                                <i className="fas fa-times-circle" /> Unapprove
                              </button>
                            ) : (
                              <button
                                type="button"
                                title="Approve Question"
                                onClick={() => toggleApproval(question, true)}
                                className="inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-1 text-xs font-medium text-success transition-colors hover:bg-success/20"
                              >
                                <i className="fas fa-check-circle" /> Approve
                              </button>
                            ))}
                        </div>
                        {question.flagged && (
                          <div className="mt-2 max-w-md">
                            <label className="mb-1 flex items-center gap-1 text-xs font-medium text-danger">
                              <i className="fas fa-flag text-[10px]" /> Flag reason
                              <span className="font-normal text-muted">(optional)</span>
                            </label>
                            <div className="flex items-end gap-2">
                              <textarea
                                value={reasonValue(question)}
                                onChange={(event) =>
                                  setReasonDraft(question, event.target.value)
                                }
                                onBlur={() => saveReason(question)}
                                rows={2}
                                placeholder="Add a note explaining why this question is flagged…"
                                className="min-w-0 flex-1 rounded-md border border-danger/30 bg-danger/5 px-2 py-1.5 text-xs text-ink placeholder:text-muted focus:border-danger focus:outline-none"
                              />
                              <button
                                type="button"
                                aria-label={`Save flag reason for ${question.title}`}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => saveReason(question)}
                                disabled={
                                  reasonDrafts[question.id] === undefined ||
                                  savingReasonId === question.id
                                }
                                className="rounded-md bg-danger px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {savingReasonId === question.id ? "Saving…" : "Save"}
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="border-b border-gray-100 px-4 py-3 text-sm text-muted">
                        {question.orphaned ? (
                          <span
                            title="The learning objective this question was generated from has been deleted. This question can no longer be added to quizzes."
                            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800"
                          >
                            <i className="fas fa-unlink text-[10px]" /> Objective deleted
                          </span>
                        ) : (
                          question.glo
                        )}
                      </td>
                      <td className="border-b border-gray-100 px-4 py-3 whitespace-nowrap">
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                          {question.bloom || "N/A"}
                        </span>
                      </td>
                      <td className="border-b border-gray-100 px-4 py-3 whitespace-nowrap">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            QUESTION_TYPE_CHIP_CLASSES[question.questionType] ||
                            QUESTION_TYPE_CHIP_CLASSES["multiple-choice"]
                          }`}
                        >
                          {formatQuestionTypeLabel(question.questionType)}
                        </span>
                      </td>
                      <td className="border-b border-gray-100 px-4 py-3 whitespace-nowrap">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            STATUS_PILL_CLASSES[
                              (question.status || "Draft").toLowerCase()
                            ] || STATUS_PILL_CLASSES.draft
                          }`}
                        >
                          {question.status || "Draft"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editTarget && (
        <QuestionEditModal
          questionId={editTarget.id}
          canEdit={editTarget.canEdit}
          courseId={courseId}
          onClose={() => setEditTarget(null)}
        />
      )}

      {showAddWizard && (
        <AddQuestionWizard
          courseId={courseId}
          quizzes={quizzes}
          onClose={() => setShowAddWizard(false)}
        />
      )}

      <AddExistingQuestionsModal
        open={showAddExistingModal}
        quiz={activeQuiz}
        questions={questions}
        questionIdsInQuiz={questionIdsInActiveQuiz}
        onClose={() => setShowAddExistingModal(false)}
        onAdd={(questionIds) =>
          activeQuiz &&
          addExistingQuestionsMutation.mutate({
            quizId: getObjectId(activeQuiz),
            questionIds,
          })
        }
        isSubmitting={addExistingQuestionsMutation.isPending}
      />

      <ReassignObjectiveModal
        open={!!reassignTarget}
        question={reassignTarget}
        objectives={detailedObjectives}
        onClose={() => setReassignTarget(null)}
        onConfirm={confirmReassign}
        isSubmitting={updateMutation.isPending}
      />

      <ConfirmModal
        open={confirmBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
        title="Delete Questions"
        message={`Are you sure you want to delete ${selectedIds.size} question(s)? This action cannot be undone.`}
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}
