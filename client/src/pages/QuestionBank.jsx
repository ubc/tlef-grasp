import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAppStore } from "../stores/appStore";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useToast } from "../components/ui/Toast";
import { toStringId, formatQuestionTypeLabel, QUESTION_TYPE_CHIP_CLASSES } from "../lib/utils";
import { useQuestionBankData } from "./question-bank/useQuestionBankData";
import QuestionEditModal from "./question-bank/QuestionEditModal";
import AddQuestionWizard from "./question-bank/AddQuestionWizard";
import ObjectivesTab from "./question-bank/ObjectivesTab";

const VALID_TABS = ["overview", "objectives"];

const STATUS_PILL_CLASSES = {
  approved: "bg-green-100 text-green-700",
  draft: "bg-gray-100 text-gray-600",
  flagged: "bg-red-100 text-red-700",
};

const SORT_COLUMNS = [
  { key: "title", label: "Question Title" },
  { key: "glo", label: "Associated GLO" },
  { key: "bloom", label: "Bloom's Level" },
  { key: "questionType", label: "Question Type" },
  { key: "status", label: "Status" },
];

function QuestionsTab({ courseId, isFaculty }) {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { questions, quizzes, objectives, isPending } = useQuestionBankData(courseId);

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
  const [showAddWizard, setShowAddWizard] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const refetch = () =>
    queryClient.invalidateQueries({ queryKey: ["question-bank", courseId] });

  // Staff cannot edit approved questions; faculty can edit everything
  const canEditQuestion = (question) =>
    isFaculty || (question.status || "Draft").toLowerCase() !== "approved";

  const filtered = useMemo(() => {
    let result = [...questions];
    if (filters.quiz !== "all") {
      result = result.filter((q) => toStringId(q.quizId) === filters.quiz);
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
  }, [questions, filters.quiz, filters.objective, filters.bloom, filters.status, filters.flagged, filters.q]);

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

  const updateQuestion = async (id, body) => {
    try {
      await api.put(`/api/question/${id}`, body);
      return true;
    } catch {
      return false;
    }
  };

  const requireFaculty = (action) => {
    if (!isFaculty) {
      showToast(`Only faculty can ${action}`, "error");
      return false;
    }
    return true;
  };

  const bulkUpdate = async (action) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      let body;
      let label;
      if (action === "approve") {
        if (!requireFaculty("bulk approve questions")) return;
        body = { status: "Approved" };
        label = "Approved";
      } else if (action === "unapprove") {
        if (!requireFaculty("bulk unapprove questions")) return;
        body = { status: "Draft" };
        label = "Unapproved";
      } else if (action === "flag") {
        if (!requireFaculty("bulk flag questions")) return;
        const firstQuestion = questions.find((q) => q.id === ids[0]);
        const shouldFlag = !firstQuestion?.flagged;
        body = { flagStatus: shouldFlag };
        label = shouldFlag ? "Flagged" : "Unflagged";
      }

      const results = await Promise.all(ids.map((id) => updateQuestion(id, body)));
      const successCount = results.filter(Boolean).length;
      if (successCount > 0) {
        showToast(`${label} ${successCount} question(s)`, "success");
        refetch();
      } else {
        showToast("Failed to update questions", "error");
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = async () => {
    if (!requireFaculty("delete questions")) return;
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `Are you sure you want to delete ${ids.length} question(s)? This action cannot be undone.`
      )
    ) {
      return;
    }
    setBulkBusy(true);
    try {
      const results = await Promise.all(
        ids.map((id) =>
          api
            .delete(`/api/question/${id}`)
            .then(() => true)
            .catch(() => false)
        )
      );
      const successCount = results.filter(Boolean).length;
      if (successCount > 0) {
        setSelectedIds(new Set());
        showToast(`Deleted ${successCount} question(s)`, "success");
        refetch();
      } else {
        showToast("Failed to delete questions", "error");
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const toggleFlag = async (question) => {
    const newFlag = !question.flagged;
    const ok = await updateQuestion(question.id, { flagStatus: newFlag });
    if (ok) {
      showToast(`Question ${newFlag ? "flagged" : "unflagged"} successfully`, "success");
      refetch();
    } else {
      showToast("Failed to update question flag status", "error");
    }
  };

  const toggleApproval = async (question, approve) => {
    const ok = await updateQuestion(question.id, {
      status: approve ? "Approved" : "Draft",
    });
    if (ok) {
      showToast(
        `Question ${approve ? "approved" : "unapproved"} successfully`,
        "success"
      );
      refetch();
    } else {
      showToast("Failed to update question status", "error");
    }
  };

  const selectClass =
    "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none";

  return (
    <div>
      {/* Filters */}
      <div className="mb-5 rounded-2xl bg-white p-5 shadow-sm">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Quiz</label>
            <select
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
            <label className="mb-1 block text-xs font-semibold text-muted">
              Learning Objectives
            </label>
            <select
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
            <label className="mb-1 block text-xs font-semibold text-muted">
              Bloom Levels
            </label>
            <select
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
            <label className="mb-1 block text-xs font-semibold text-muted">Status</label>
            <select
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

      {/* Toolbar + action bar (faculty only) */}
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
          </div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 shadow-sm">
            <span className="text-sm text-muted">
              {selectedIds.size} question{selectedIds.size !== 1 ? "s" : ""} selected
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={selectedIds.size === 0 || bulkBusy}
                onClick={() => bulkUpdate("approve")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-40"
              >
                <i className="fas fa-check" /> Approve
              </button>
              <button
                type="button"
                disabled={selectedIds.size === 0 || bulkBusy}
                onClick={() => bulkUpdate("unapprove")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-40"
              >
                <i className="fas fa-times" /> Unapprove
              </button>
              <button
                type="button"
                disabled={selectedIds.size === 0 || bulkBusy}
                onClick={() => bulkUpdate("flag")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-40"
              >
                <i className="fas fa-flag" /> Flag
              </button>
              <button
                type="button"
                disabled={selectedIds.size === 0 || bulkBusy}
                onClick={bulkDelete}
                className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-40"
              >
                <i className="fas fa-trash" /> Delete
              </button>
            </div>
          </div>
        </>
      )}

      {/* Questions table */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
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
                    className="cursor-pointer border-b border-gray-200 px-4 py-3 text-left text-sm font-semibold text-muted select-none hover:text-ink"
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
                          className={`text-sm font-medium ${
                            question.flagged ? "text-danger" : "text-ink"
                          }`}
                        >
                          {question.flagged && <i className="fas fa-flag mr-1.5 text-xs" />}
                          {question.title}
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
                            onClick={() =>
                              setEditTarget({ id: question.id, canEdit })
                            }
                            className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-gray-200"
                          >
                            <i className="fas fa-eye" />
                            {canEdit ? "View/Edit" : "View Only"}
                          </button>
                          {isFaculty &&
                            ((question.status || "").toLowerCase() === "approved" ? (
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
                      </td>
                      <td className="border-b border-gray-100 px-4 py-3 text-sm text-muted">
                        {question.glo}
                      </td>
                      <td className="border-b border-gray-100 px-4 py-3">
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                          {question.bloom || "N/A"}
                        </span>
                      </td>
                      <td className="border-b border-gray-100 px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            QUESTION_TYPE_CHIP_CLASSES[question.questionType] ||
                            QUESTION_TYPE_CHIP_CLASSES["multiple-choice"]
                          }`}
                        >
                          {formatQuestionTypeLabel(question.questionType)}
                        </span>
                      </td>
                      <td className="border-b border-gray-100 px-4 py-3">
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
          onClose={() => setEditTarget(null)}
          onSaved={refetch}
        />
      )}

      {showAddWizard && (
        <AddQuestionWizard
          courseId={courseId}
          quizzes={quizzes}
          onClose={() => setShowAddWizard(false)}
          onSaved={refetch}
        />
      )}
    </div>
  );
}

export default function QuestionBank() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isFaculty } = useCurrentUser();
  const selectedCourse = useAppStore((state) => state.selectedCourse);
  const courseId = selectedCourse?.id;

  const tabParam = searchParams.get("tab");
  const activeTab = VALID_TABS.includes(tabParam) ? tabParam : "overview";
  const materialFilter = searchParams.get("material") || "all";

  const switchTab = (tab) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", tab);
        return next;
      },
      { replace: true }
    );
  };

  return (
    <div className="mx-auto max-w-7xl p-8">
      {/* Tabs */}
      <div className="mb-6 flex gap-2">
        {[
          { id: "overview", label: "Questions" },
          { id: "objectives", label: "Learning Objectives" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => switchTab(tab.id)}
            className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors ${
              activeTab === tab.id
                ? "bg-primary text-white"
                : "bg-white text-muted shadow-sm hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <QuestionsTab courseId={courseId} isFaculty={isFaculty} />
      ) : (
        <ObjectivesTab
          courseId={courseId}
          isFaculty={isFaculty}
          materialFilter={materialFilter}
          onMaterialFilterChange={(value) =>
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                if (value && value !== "all") next.set("material", value);
                else next.delete("material");
                return next;
              },
              { replace: true }
            )
          }
        />
      )}
    </div>
  );
}
