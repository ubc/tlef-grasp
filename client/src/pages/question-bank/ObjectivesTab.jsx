import { useEffect, useState } from "react";
import { getObjectId, getMaterialIcon } from "../../lib/utils";
import {
  useDetailedObjectives,
  useSaveObjective,
  useDeleteObjective,
  useUpdateGranularObjectives,
  useObjectiveDeletionImpact,
} from "../../hooks/useObjectives";
import { useCourseMaterials } from "../../hooks/useMaterials";
import Modal from "../../components/ui/Modal";
import SearchableSelect from "../../components/ui/SearchableSelect";
import { useToast } from "../../components/ui/Toast";

function GranularItem({ objective, granular, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const gId = getObjectId(granular);
  const displayText = granular.name || granular.text || "";

  if (editing) {
    return (
      <li className="flex items-center gap-2 rounded-lg bg-page px-3 py-2">
        <input
          type="text"
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onUpdate(objective, gId, text);
              setEditing(false);
            }
            if (event.key === "Escape") setEditing(false);
          }}
          className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-primary focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            onUpdate(objective, gId, text);
            setEditing(false);
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-white"
        >
          <i className="fas fa-check text-xs" />
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-gray-200"
        >
          <i className="fas fa-times text-xs" />
        </button>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-2 rounded-lg bg-page px-3 py-2">
      <span className="text-sm text-ink">{displayText}</span>
      <div className="flex gap-1">
        <button
          type="button"
          title="Edit"
          onClick={() => {
            setText(displayText);
            setEditing(true);
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-gray-200 hover:text-ink"
        >
          <i className="fas fa-pencil-alt text-[11px]" />
        </button>
        <button
          type="button"
          title="Delete"
          onClick={() => onDelete(objective, gId)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <i className="fas fa-times text-[11px]" />
        </button>
      </div>
    </li>
  );
}

// Delete confirmation that first checks for linked questions and, when any
// exist, makes the instructor choose whether to delete them or keep them as
// orphaned drafts. Works for both a whole learning objective and a single
// granular objective (both are queried by id).
function DeleteObjectiveModal({ open, target, onClose, onConfirm, isSubmitting }) {
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
      onClose={onClose}
      title={title}
      wide={hasLinkedQuestions}
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

export default function ObjectivesTab({ courseId, isFaculty, materialFilter, onMaterialFilterChange }) {
  const showToast = useToast();
  const { objectives, isPending, isError } = useDetailedObjectives(courseId);
  const { materials: courseMaterials } = useCourseMaterials(courseId);

  // Modal state: { editingId: string|null }
  const [objectiveModal, setObjectiveModal] = useState(null);
  const [objectiveName, setObjectiveName] = useState("");
  const [selectedMaterialIds, setSelectedMaterialIds] = useState([]);
  const [granularInputs, setGranularInputs] = useState({});
  // { kind: 'objective', objectiveId } | { kind: 'granular', objective, granularId }
  const [deleteTarget, setDeleteTarget] = useState(null);

  const saveMutation = useSaveObjective(courseId, {
    onSuccess: (data, { objectiveId }) => {
      setObjectiveModal(null);
      showToast(
        `Objective ${objectiveId ? "updated" : "created"} successfully`,
        "success"
      );
    },
    onError: (error) => {
      console.error("Error saving objective:", error);
      showToast(error.message, "error");
    },
  });

  const deleteMutation = useDeleteObjective(courseId, {
    onSuccess: () => showToast("Learning objective deleted", "success"),
    onError: (error) => {
      console.error("Error deleting objective:", error);
      showToast(error.message, "error");
    },
  });

  const granularMutation = useUpdateGranularObjectives(courseId, {
    onSuccess: (data, { successMessage }) => showToast(successMessage, "success"),
    onError: (error) => {
      console.error("Error updating granular objectives:", error);
      showToast(error.message, "error");
    },
  });

  const filteredObjectives =
    materialFilter === "all"
      ? objectives
      : objectives.filter(
          (objective) =>
            objective.materialIds && objective.materialIds.includes(materialFilter)
        );

  const openAddModal = () => {
    if (!isFaculty) {
      showToast("Only faculty can add learning objectives", "error");
      return;
    }
    setObjectiveName("");
    setSelectedMaterialIds([]);
    setObjectiveModal({ editingId: null });
  };

  const openEditModal = (objective) => {
    setObjectiveName(objective.name);
    setSelectedMaterialIds(objective.materialIds || []);
    setObjectiveModal({ editingId: objective.id });
  };

  const handleSaveObjective = () => {
    const name = objectiveName.trim();
    if (!name) {
      showToast("Please enter an objective name", "error");
      return;
    }
    if (selectedMaterialIds.length === 0) {
      showToast("Please associate at least one course material", "error");
      return;
    }
    saveMutation.mutate({
      objectiveId: objectiveModal.editingId,
      name,
      materialIds: selectedMaterialIds,
    });
  };

  const handleDeleteObjective = (objectiveId) =>
    setDeleteTarget({ kind: "objective", objectiveId });

  const updateGranularList = (objective, updatedList, successMessage, questionAction) => {
    granularMutation.mutate({
      objectiveId: objective.id,
      granularObjectives: updatedList,
      successMessage,
      questionAction,
    });
  };

  const handleAddGranular = (objective) => {
    const text = (granularInputs[objective.id] || "").trim();
    if (!text) return;
    setGranularInputs((prev) => ({ ...prev, [objective.id]: "" }));
    updateGranularList(
      objective,
      [...objective.granular, { text }],
      "Granular objective added"
    );
  };

  const handleUpdateGranular = (objective, granularId, newText) => {
    if (!newText.trim()) return;
    const updatedList = objective.granular.map((g) =>
      getObjectId(g) === granularId
        ? { ...g, text: newText.trim(), name: newText.trim() }
        : g
    );
    updateGranularList(objective, updatedList, "Granular objective updated");
  };

  const handleDeleteGranular = (objective, granularId) =>
    setDeleteTarget({ kind: "granular", objective, granularId });

  const confirmDelete = (questionAction) => {
    if (!deleteTarget) return;
    if (deleteTarget.kind === "objective") {
      deleteMutation.mutate({
        objectiveId: deleteTarget.objectiveId,
        questionAction,
      });
    } else {
      const { objective, granularId } = deleteTarget;
      const updatedList = objective.granular.filter(
        (g) => getObjectId(g) !== granularId
      );
      updateGranularList(
        objective,
        updatedList,
        "Granular objective deleted",
        questionAction
      );
    }
    setDeleteTarget(null);
  };

  const materialOptions = [
    { value: "all", label: "All Materials", icon: "fas fa-list", iconColor: "#3498db" },
    ...courseMaterials.map((material) => {
      const iconInfo = getMaterialIcon(material.fileType || "");
      return {
        value: material.sourceId,
        label:
          material.documentTitle || material.fileName || material.name || "Unnamed Material",
        icon: iconInfo.icon,
        iconColor: iconInfo.color,
      };
    }),
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h2 className="text-lg font-semibold text-ink">Manage Learning Objectives</h2>
          <p className="mt-1 text-sm text-muted">
            Manage learning objectives for this course. Update titles, attach course
            materials, and define granular sub-objectives.
          </p>
          <div className="mt-4">
            <label className="mb-1 block text-sm font-semibold text-ink">
              Filter by Material
            </label>
            <SearchableSelect
              value={materialFilter}
              onChange={onMaterialFilterChange}
              options={materialOptions}
              placeholder="Search materials..."
              className="w-80"
            />
          </div>
        </div>
        {isFaculty && (
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
          >
            <i className="fas fa-plus" /> Add Learning Objective
          </button>
        )}
      </div>

      {/* Content */}
      {isPending ? (
        <div className="py-12 text-center text-muted">
          <i className="fas fa-spinner fa-spin mb-3 text-2xl" />
          <p>Loading learning objectives...</p>
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 py-10 text-center text-danger">
          Failed to load learning objectives. Please try again.
        </div>
      ) : objectives.length === 0 ? (
        <div className="rounded-2xl bg-white py-16 text-center shadow-sm">
          <i className="fas fa-bullseye mb-4 block text-5xl text-gray-200" />
          <h3 className="text-xl font-semibold text-ink">No Learning Objectives Found</h3>
          <p className="mt-2 text-muted">
            {isFaculty ? (
              <>
                Use the <strong>Add Learning Objective</strong> button above to create
                one manually, or import from course materials.
              </>
            ) : (
              "Learning objectives are usually imported from course materials."
            )}
          </p>
        </div>
      ) : filteredObjectives.length === 0 ? (
        <div className="rounded-2xl bg-white py-16 text-center shadow-sm">
          <i className="fas fa-filter mb-4 block text-5xl text-gray-200" />
          <h3 className="text-xl font-semibold text-ink">No matching objectives</h3>
          <p className="mt-2 text-muted">Try adjusting your material filter.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {filteredObjectives.map((objective) => {
            const associatedMaterials = courseMaterials.filter((m) =>
              objective.materialIds.includes(m.sourceId)
            );
            return (
              <div key={objective.id} className="rounded-2xl bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <i className="fas fa-bullseye text-xl text-primary" />
                    <h3 className="text-lg font-semibold text-ink">{objective.name}</h3>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      title="Edit Objective"
                      onClick={() => openEditModal(objective)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-gray-100 hover:text-ink"
                    >
                      <i className="fas fa-edit" />
                    </button>
                    <button
                      type="button"
                      title="Delete Objective"
                      onClick={() => handleDeleteObjective(objective.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                    >
                      <i className="fas fa-trash" />
                    </button>
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
                  {/* Granular objectives */}
                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-ink">
                      <i className="fas fa-level-down-alt mr-1.5 text-muted" />
                      Granular Objectives
                    </h4>
                    {objective.granular.length > 0 ? (
                      <ul className="space-y-2">
                        {objective.granular.map((granular) => (
                          <GranularItem
                            key={getObjectId(granular)}
                            objective={objective}
                            granular={granular}
                            onUpdate={handleUpdateGranular}
                            onDelete={handleDeleteGranular}
                          />
                        ))}
                      </ul>
                    ) : (
                      <p className="rounded-lg border border-dashed border-gray-200 bg-page px-4 py-3 text-sm text-gray-400">
                        No granular objectives defined.
                      </p>
                    )}
                    <div className="mt-3 flex gap-2">
                      <input
                        type="text"
                        value={granularInputs[objective.id] || ""}
                        onChange={(event) =>
                          setGranularInputs((prev) => ({
                            ...prev,
                            [objective.id]: event.target.value,
                          }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") handleAddGranular(objective);
                        }}
                        placeholder="Enter granular objective..."
                        className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddGranular(objective)}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
                      >
                        <i className="fas fa-plus" /> Add Granular Learning Objective
                      </button>
                    </div>
                  </div>

                  {/* Associated materials */}
                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-ink">
                      Associated Materials
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {associatedMaterials.length > 0 ? (
                        associatedMaterials.map((material) => {
                          const iconInfo = getMaterialIcon(material.fileType || "");
                          return (
                            <span
                              key={material.sourceId}
                              title={material.source || material.filename || ""}
                              className="inline-flex items-center rounded-full bg-page px-3 py-1.5 text-xs font-medium text-ink"
                            >
                              <i
                                className={`${iconInfo.icon} mr-1.5`}
                                style={{ color: iconInfo.color }}
                              />
                              {material.documentTitle ||
                                material.fileName ||
                                material.name ||
                                "Unnamed"}
                            </span>
                          );
                        })
                      ) : (
                        <span className="text-sm text-gray-400">No materials linked.</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/edit objective modal */}
      <Modal
        open={!!objectiveModal}
        onClose={() => setObjectiveModal(null)}
        title={objectiveModal?.editingId ? "Edit Learning Objective" : "Add Learning Objective"}
        wide
        footer={
          <>
            <button
              type="button"
              onClick={() => setObjectiveModal(null)}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saveMutation.isPending}
              onClick={handleSaveObjective}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
            >
              {saveMutation.isPending ? "Saving..." : "Save Objective"}
            </button>
          </>
        }
      >
        <div>
          <label className="mb-1 block text-sm font-semibold text-ink">
            Objective Name
          </label>
          <input
            type="text"
            value={objectiveName}
            onChange={(event) => setObjectiveName(event.target.value)}
            placeholder="e.g., Understanding Cellular Respiration"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </div>
        <div className="mt-6">
          <label className="mb-1 block text-sm font-semibold text-ink">
            Associated Course Materials <span className="text-danger">*</span>
          </label>
          <p className="mb-3 text-xs text-muted">
            Select at least one material that covers this learning objective.
          </p>
          {courseMaterials.length === 0 ? (
            <p className="py-5 text-center text-sm text-muted">
              No course materials available.
            </p>
          ) : (
            <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {courseMaterials.map((material) => {
                const id = material.sourceId;
                const iconInfo = getMaterialIcon(material.fileType || "");
                return (
                  <label
                    key={id}
                    title={material.source || material.filename || ""}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm transition-colors hover:border-primary/40"
                  >
                    <input
                      type="checkbox"
                      checked={selectedMaterialIds.includes(id)}
                      onChange={() =>
                        setSelectedMaterialIds((prev) =>
                          prev.includes(id)
                            ? prev.filter((m) => m !== id)
                            : [...prev, id]
                        )
                      }
                      className="h-4 w-4 accent-primary"
                    />
                    <i
                      className={`${iconInfo.icon} w-5 text-center`}
                      style={{ color: iconInfo.color }}
                    />
                    <span className="truncate">
                      {material.documentTitle ||
                        material.fileName ||
                        material.name ||
                        "Unnamed"}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </Modal>

      <DeleteObjectiveModal
        open={!!deleteTarget}
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        isSubmitting={deleteMutation.isPending || granularMutation.isPending}
      />
    </div>
  );
}
