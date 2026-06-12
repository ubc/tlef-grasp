import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { BLOOM_LEVELS } from "../../lib/constants";
import Modal from "../../components/ui/Modal";
import RichText from "../../components/RichText";
import { useToast } from "../../components/ui/Toast";

function getMaterialTypeLabel(fileType) {
  if (!fileType) return "Unknown";
  if (fileType.includes("pdf")) return "PDF";
  if (fileType.includes("text")) return "Text";
  if (fileType.includes("word")) return "Word";
  if (fileType === "link") return "Link";
  return fileType;
}

function formatFileSize(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

// Auto-growing textarea used for inline title/granular editing.
function AutoGrowTextarea({ value, onCommit, className = "", placeholder }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);

  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [draft]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.target.blur();
        }
      }}
      className={`w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2 py-1 leading-snug transition-colors focus:border-gray-300 focus:bg-white focus:shadow-inner focus:outline-none ${className}`}
    />
  );
}

/* --------------------------- AI generate modal --------------------------- */

function AIGenerateModal({ course, onClose, onSaved }) {
  const showToast = useToast();
  const [customRows, setCustomRows] = useState([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generated, setGenerated] = useState(null); // [{ name, granularObjectives }]
  const [selectedIndices, setSelectedIndices] = useState(new Set());

  const materialsQuery = useQuery({
    queryKey: ["materials", course?.id],
    queryFn: () => api.get(`/api/material/course/${course.id}`),
    enabled: !!course?.id,
  });
  const materials = materialsQuery.data?.materials || [];

  const applyBulk = () => {
    const lines = bulkText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    setCustomRows((prev) => [...prev, ...lines]);
    setBulkText("");
    setBulkOpen(false);
  };

  const handleGenerate = async () => {
    if (!selectedMaterial) {
      showToast("Please select a material", "warning");
      return;
    }
    setGenerating(true);
    setGenerated(null);
    try {
      const material = materials.find((m) => m.sourceId === selectedMaterial);
      const data = await api.post("/api/rag-llm/generate-learning-objectives", {
        courseId: course.id,
        courseName: course.name,
        materialIds: [selectedMaterial],
        materialTitles: { [selectedMaterial]: material?.documentTitle || "" },
        userObjectives: customRows.map((r) => r.trim()).filter(Boolean),
      });
      if (!data.success || !data.objectives || data.objectives.length === 0) {
        throw new Error(data.error || "No objectives generated");
      }
      setGenerated(data.objectives);
      setSelectedIndices(new Set(data.objectives.map((_, i) => i)));
      showToast(`Generated ${data.objectives.length} learning objective(s)`, "success");
    } catch (error) {
      console.error("Error generating learning objectives:", error);
      showToast(error.message || "Failed to generate learning objectives", "error");
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    const indices = Array.from(selectedIndices);
    if (indices.length === 0) {
      showToast("Please select at least one objective to save", "warning");
      return;
    }
    setSaving(true);
    const savedGroups = [];
    try {
      for (const index of indices) {
        const objective = generated[index];
        if (!objective) continue;
        try {
          const data = await api.post("/api/objective", {
            name: objective.name,
            courseId: course.id,
            materialIds: [selectedMaterial],
            granularObjectives: objective.granularObjectives.map((go) => ({
              text: typeof go === "string" ? go : go.text,
              bloomTaxonomies: typeof go === "string" ? [] : go.bloomTaxonomies || [],
            })),
          });
          if (!data.success) {
            throw new Error(data.error || `Failed to save objective: ${objective.name}`);
          }
          savedGroups.push({
            objective: data.objective,
            granulars: data.granularObjectives,
            materialIds: [selectedMaterial],
          });
        } catch (saveError) {
          console.error(`Error saving objective "${objective.name}":`, saveError);
          showToast(
            `Failed to save "${objective.name}": ${saveError.message}`,
            "error"
          );
        }
      }
      if (savedGroups.length > 0) {
        onSaved(savedGroups);
        showToast(
          `Successfully added ${savedGroups.length} learning objective(s) to page`,
          "success"
        );
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={generating ? () => {} : onClose}
      title="Generate Learning Objectives"
      wide
      footer={
        <>
          <button
            type="button"
            disabled={generating}
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          {!generated ? (
            <button
              type="button"
              disabled={!selectedMaterial || generating}
              onClick={handleGenerate}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
            >
              {generating ? (
                <>
                  <i className="fas fa-spinner fa-spin" /> Generating...
                </>
              ) : (
                <>
                  <i className="fas fa-magic" /> Generate
                </>
              )}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={generating}
                onClick={handleGenerate}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                <i className="fas fa-sync-alt" /> Regenerate
              </button>
              <button
                type="button"
                disabled={saving || selectedIndices.size === 0}
                onClick={handleSave}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <i className="fas fa-spinner fa-spin" /> Saving...
                  </>
                ) : (
                  <>
                    <i className="fas fa-save" /> Save Selected ({selectedIndices.size})
                  </>
                )}
              </button>
            </>
          )}
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">
        Select the course materials you want to use for generating learning objectives.
        The AI will analyze the content and create relevant learning objectives. If you
        provide your own learning objectives, the AI will reorganize them into a proper
        hierarchy rather than generating new ones (optional).
      </p>

      {/* Custom objectives */}
      <div className="mb-5 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold text-indigo-900">
              Custom Learning Objectives (Optional)
            </div>
            <p className="text-xs text-indigo-700">
              Add your own learning objectives. AI will reorganize them into a proper
              hierarchy rather than generating new ones.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              className="rounded-md border border-indigo-300 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
            >
              <i className="fas fa-paste mr-1" /> Bulk Add
            </button>
            <button
              type="button"
              onClick={() => setCustomRows((prev) => [...prev, ""])}
              className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-dark"
            >
              <i className="fas fa-plus mr-1" /> Add Objective
            </button>
          </div>
        </div>

        {bulkOpen && (
          <div className="mb-3 rounded-md border border-indigo-200 bg-white p-3">
            <label className="mb-1.5 block text-xs font-semibold text-indigo-900">
              Paste objectives (one per line):
            </label>
            <textarea
              rows={4}
              value={bulkText}
              onChange={(event) => setBulkText(event.target.value)}
              className="mb-2 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBulkOpen(false)}
                className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-ink hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyBulk}
                className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-dark"
              >
                Apply
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {customRows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={row}
                placeholder="Enter a learning objective..."
                onChange={(event) =>
                  setCustomRows((prev) =>
                    prev.map((r, i) => (i === index ? event.target.value : r))
                  )
                }
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
              <button
                type="button"
                title="Remove objective"
                onClick={() =>
                  setCustomRows((prev) => prev.filter((_, i) => i !== index))
                }
                className="p-2 text-red-500 hover:text-red-700"
              >
                <i className="fas fa-trash-alt" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Material selection */}
      <label className="mb-1 block font-semibold text-ink">Select Material:</label>
      <p className="mb-3 text-xs text-muted">
        <i className="fas fa-info-circle mr-1 text-primary" />
        Select a course material to generate focused learning objectives from its
        content.
      </p>
      <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-3">
        {materialsQuery.isPending ? (
          <div className="py-5 text-center text-muted">
            <i className="fas fa-spinner fa-spin mr-2" /> Loading materials...
          </div>
        ) : materials.length === 0 ? (
          <div className="py-5 text-center text-muted">
            No materials available for this course. Please upload materials first.
          </div>
        ) : (
          materials.map((material) => (
            <label
              key={material.sourceId}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                selectedMaterial === material.sourceId
                  ? "border-primary bg-primary/5"
                  : "border-gray-200 hover:border-primary/40"
              }`}
            >
              <input
                type="radio"
                name="ai-material-selection"
                checked={selectedMaterial === material.sourceId}
                onChange={() => setSelectedMaterial(material.sourceId)}
                className="h-4 w-4 accent-primary"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">
                  {material.documentTitle || "Untitled"}
                </div>
                <div className="flex gap-4 text-xs text-muted">
                  <span>Type: {getMaterialTypeLabel(material.fileType)}</span>
                  <span>Size: {formatFileSize(material.fileSize || 0)}</span>
                  <span>
                    Uploaded: {new Date(material.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </label>
          ))
        )}
      </div>

      {/* Generation status */}
      {generating && (
        <div className="mt-5 rounded-lg border border-sky-200 bg-sky-50 p-4">
          <div className="flex items-center gap-3 text-sky-900">
            <i className="fas fa-spinner fa-spin text-sky-600" />
            <span className="font-medium">Generating learning objectives...</span>
          </div>
        </div>
      )}

      {/* Generated preview */}
      {generated && (
        <div className="mt-6">
          <label className="mb-2 block font-semibold text-ink">
            Generated Learning Objectives:
          </label>
          <div className="max-h-96 space-y-3 overflow-y-auto rounded-lg border border-gray-200 p-3">
            {generated.map((objective, index) => {
              const selected = selectedIndices.has(index);
              return (
                <div
                  key={index}
                  className={`flex gap-3 rounded-lg border-2 p-4 transition-colors ${
                    selected ? "border-blue-500 bg-white" : "border-gray-200 bg-gray-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() =>
                      setSelectedIndices((prev) => {
                        const next = new Set(prev);
                        if (next.has(index)) next.delete(index);
                        else next.add(index);
                        return next;
                      })
                    }
                    className="mt-1 h-4.5 w-4.5 shrink-0 accent-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <RichText
                      text={`${index + 1}. ${escapeHtml(objective.name)}`}
                      className="mb-2 font-semibold text-ink"
                    />
                    <ul className="space-y-1.5">
                      {objective.granularObjectives.map((granular, gIndex) => (
                        <li key={gIndex} className="flex gap-2 text-sm text-gray-600">
                          <span className="text-gray-400">•</span>
                          <RichText
                            text={escapeHtml(
                              typeof granular === "string" ? granular : granular.text
                            )}
                            className="min-w-0 flex-1"
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------ Main step 1 ------------------------------ */

export default function ObjectivesStep({
  course,
  objectiveGroups,
  setObjectiveGroups,
  showValidation,
}) {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [granularizeTarget, setGranularizeTarget] = useState(null);
  const [granularCount, setGranularCount] = useState(3);
  const [useDefaults, setUseDefaults] = useState(true);
  const dropdownRef = useRef(null);

  const objectivesQuery = useQuery({
    queryKey: ["objectives", course?.id],
    queryFn: () => api.get(`/api/objective?courseId=${encodeURIComponent(course.id)}`),
    enabled: !!course?.id,
  });
  const dbObjectives = objectivesQuery.data?.success
    ? objectivesQuery.data.objectives || []
    : [];

  useEffect(() => {
    const handleClick = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const addedObjectiveIds = new Set(
    objectiveGroups.filter((g) => g.objectiveId).map((g) => String(g.objectiveId))
  );

  const updateGroup = (groupId, updater) => {
    setObjectiveGroups((prev) =>
      prev.map((group) => (group.id === groupId ? updater(group) : group))
    );
  };

  // Persist a group's full objective record (name, materials, granular list)
  const saveObjectiveToDatabase = async (group) => {
    if (!group?.objectiveId || !course?.id) return;
    const granularObjectives = group.items.map((item) => {
      const granularObj = {
        text: item.text,
        bloomTaxonomies: item.bloom || [],
        questionCount: item.count,
      };
      if (item.granularId) granularObj.id = item.granularId;
      return granularObj;
    });

    try {
      const data = await api.put(`/api/objective/${group.objectiveId}`, {
        name: group.title,
        courseId: course.id,
        materialIds: group.materialIds || [],
        granularObjectives,
      });
      if (data.success && data.granularObjectives) {
        // Backfill database ids for newly created granular objectives
        setObjectiveGroups((prev) =>
          prev.map((g) => {
            if (g.id !== group.id) return g;
            const items = g.items.map((item) => {
              if (item.granularId) return item;
              const match = data.granularObjectives.find(
                (db) => db.name === item.text
              );
              return match ? { ...item, granularId: String(match._id) } : item;
            });
            return { ...g, items };
          })
        );
      }
      queryClient.invalidateQueries({ queryKey: ["detailed-objectives", course.id] });
    } catch (error) {
      console.error("Error saving objective to database:", error);
    }
  };

  const handleObjectiveSelection = async (objectiveId, objectiveName) => {
    const normalizedId = String(objectiveId);
    const existing = objectiveGroups.find(
      (group) => group.objectiveId && String(group.objectiveId) === normalizedId
    );
    if (existing) {
      updateGroup(existing.id, (group) => ({ ...group, isOpen: true }));
      return;
    }

    try {
      const [granularData, materialsData] = await Promise.all([
        api.get(
          `/api/objective/${objectiveId}/granular?courseId=${encodeURIComponent(course.id)}`
        ),
        api.get(`/api/objective/${objectiveId}/materials`),
      ]);

      const granularObjectives = granularData.success ? granularData.objectives : [];
      const materialIds = materialsData.success
        ? materialsData.materials.map((m) => m.sourceId || m._id)
        : [];

      const newGroupNumber = objectiveGroups.length + 1;
      const newGroup = {
        id: Date.now() + Math.random(),
        objectiveId,
        title: objectiveName,
        isOpen: true,
        materialIds,
        items: granularObjectives.map((granular, index) => ({
          id: parseFloat(`${newGroupNumber}.${index + 1}`),
          granularId: granular._id ? String(granular._id) : null,
          text: granular.name,
          bloom:
            granular.bloomTaxonomies && granular.bloomTaxonomies.length > 0
              ? granular.bloomTaxonomies
              : [],
          minQuestions: 2,
          count:
            granular.questionCount ||
            Math.max(2, granular.bloomTaxonomies?.length || 0),
          mode: "manual",
          level: 1,
          selected: false,
        })),
      };
      setObjectiveGroups((prev) => [...prev, newGroup]);
    } catch (error) {
      console.error("Error fetching granular objectives:", error);
      showToast("Failed to load granular objectives", "error");
    }
  };

  const handleAISaved = (savedGroups) => {
    setObjectiveGroups((prev) => {
      const next = [...prev];
      savedGroups.forEach(({ objective, granulars, materialIds }) => {
        const newGroupNumber = next.length + 1;
        next.push({
          id: Date.now() + Math.random(),
          objectiveId: objective._id,
          title: objective.name,
          isOpen: true,
          materialIds,
          items: (granulars || []).map((granular, gIdx) => ({
            id: parseFloat(`${newGroupNumber}.${gIdx + 1}`),
            granularId: String(granular._id),
            text: granular.name,
            bloom: granular.bloomTaxonomies || [],
            minQuestions: 2,
            count: 2,
            mode: "manual",
            level: 1,
            selected: false,
          })),
        });
      });
      return next;
    });
    objectivesQuery.refetch();
  };

  const toggleBloomChip = (group, item, level) => {
    if (item.mode !== "manual") return;
    updateGroup(group.id, (g) => {
      const items = g.items.map((i) => {
        if (i.id !== item.id) return i;
        const bloom = i.bloom.includes(level)
          ? i.bloom.filter((b) => b !== level)
          : [...i.bloom, level];
        return { ...i, bloom, count: Math.max(i.count, bloom.length) };
      });
      const updated = { ...g, items };
      if (g.objectiveId) saveObjectiveToDatabase(updated);
      return updated;
    });
  };

  const changeCount = (group, item, delta) => {
    const minAllowed = Math.max(2, item.bloom?.length || 0);
    const next = item.count + delta;
    if (delta > 0 && item.count >= 9) return;
    if (delta < 0 && item.count <= minAllowed) return;
    updateGroup(group.id, (g) => {
      const updated = {
        ...g,
        items: g.items.map((i) => (i.id === item.id ? { ...i, count: next } : i)),
      };
      saveObjectiveToDatabase(updated);
      return updated;
    });
  };

  const commitItemText = (group, item, newText) => {
    const trimmed = newText.trim();
    if (!trimmed || item.text.trim() === trimmed) return;
    updateGroup(group.id, (g) => {
      const updated = {
        ...g,
        items: g.items.map((i) => (i.id === item.id ? { ...i, text: trimmed } : i)),
      };
      saveObjectiveToDatabase(updated);
      return updated;
    });
  };

  const commitGroupTitle = (group, newTitle) => {
    const trimmed = newTitle.trim();
    if (!trimmed || group.title.trim() === trimmed) return;
    updateGroup(group.id, (g) => {
      const updated = { ...g, title: trimmed };
      saveObjectiveToDatabase(updated);
      return updated;
    });
  };

  const deleteItem = (group, item) => {
    updateGroup(group.id, (g) => {
      const updated = { ...g, items: g.items.filter((i) => i.id !== item.id) };
      saveObjectiveToDatabase(updated);
      return updated;
    });
  };

  const addNewGranular = (group) => {
    updateGroup(group.id, (g) => ({
      ...g,
      items: [
        ...g.items,
        {
          id: Date.now() + g.items.length + 1,
          granularId: null,
          text: "",
          bloom: [],
          minQuestions: 2,
          count: 2,
          mode: "manual",
          level: 1,
          selected: false,
        },
      ],
    }));
  };

  const confirmGranularization = () => {
    const group = objectiveGroups.find((g) => g.id === granularizeTarget);
    if (!group) return;
    const selectedItems = group.items.filter((item) => item.selected);
    if (selectedItems.length === 0) return;

    const templates = (parent) => [
      {
        title: `Identify key terms and quantities related to ${parent.text}.`,
        bloom: useDefaults ? ["Remember", "Understand"] : [],
      },
      {
        title: `Explain the underlying principle(s) behind ${parent.text} with one example.`,
        bloom: useDefaults ? ["Understand", "Analyze"] : [],
      },
      {
        title: `Apply ${parent.text} to solve a simple problem or predict an outcome.`,
        bloom: useDefaults ? ["Apply"] : [],
      },
    ];

    updateGroup(group.id, (g) => {
      const newItems = [];
      selectedItems.forEach((parent) => {
        templates(parent)
          .slice(0, granularCount)
          .forEach((template, i) => {
            newItems.push({
              id: parseFloat(`${parent.id}.${i + 1}`),
              text: template.title,
              bloom: template.bloom,
              minQuestions: 1,
              count: 1,
              mode: "manual",
              level: 2,
              parentId: parent.id,
              selected: false,
            });
          });
      });
      return {
        ...g,
        items: [...g.items.map((i) => ({ ...i, selected: false })), ...newItems],
      };
    });
    setGranularizeTarget(null);
  };

  const filteredDbObjectives = dbObjectives.filter((objective) =>
    (objective.name || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <h1 className="text-xl font-bold text-ink">
        Review learning objectives for every page
      </h1>
      <p className="mb-5 text-muted">
        Organize meta learning objectives and refine granular learning objectives.
      </p>

      {/* Action buttons */}
      <div className="mb-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setAiModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 font-medium text-ink transition-colors hover:bg-gray-50"
        >
          <i className="fas fa-magic" /> Create Learning Objectives
        </button>
        <div ref={dropdownRef} className="relative">
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
          >
            <i className="fas fa-plus" /> Add Existing Learning Objectives
          </button>
          {dropdownOpen && (
            <div className="absolute z-20 mt-1 w-96 rounded-lg border border-gray-200 bg-white shadow-lg">
              <div className="border-b border-gray-100 p-2">
                <input
                  type="text"
                  autoFocus
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search objectives..."
                  className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none"
                />
              </div>
              <ul className="max-h-60 overflow-y-auto py-1">
                {filteredDbObjectives.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-muted">
                    No learning objectives found. Create one to get started.
                  </li>
                ) : (
                  filteredDbObjectives.map((objective) => {
                    const disabled = addedObjectiveIds.has(String(objective._id));
                    return (
                      <li key={objective._id}>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={async () => {
                            setDropdownOpen(false);
                            await handleObjectiveSelection(
                              objective._id,
                              objective.name
                            );
                          }}
                          className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {objective.name}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Objective groups */}
      {objectiveGroups.length === 0 ? (
        <div className="rounded-2xl bg-white py-16 text-center shadow-sm">
          <i className="fas fa-lightbulb mb-4 text-4xl text-gray-300" />
          <h3 className="text-lg font-semibold text-ink">No learning objectives yet</h3>
          <p className="mt-1 text-muted">
            Start by adding your first learning objective to organize your course
            content.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {objectiveGroups.map((group) => {
            const totalCount = group.items.reduce(
              (sum, item) => sum + (item.count || 0),
              0
            );
            const isWarning = totalCount < 5;
            const selectedCount = group.items.filter((i) => i.selected).length;
            const allSelected =
              group.items.length > 0 && group.items.every((i) => i.selected);

            return (
              <div key={group.id} className="rounded-2xl bg-white shadow-sm">
                {/* Group header */}
                <div className="flex items-center gap-2 border-b border-gray-100 p-4">
                  <button
                    type="button"
                    title="Delete learning objective from page"
                    aria-label={`Delete ${group.title}`}
                    onClick={() => setDeleteTarget(group.id)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                  >
                    <i className="fas fa-trash-alt" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <AutoGrowTextarea
                      value={group.title}
                      onCommit={(value) => commitGroupTitle(group, value)}
                      className="text-lg font-semibold text-ink"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updateGroup(group.id, (g) => ({ ...g, isOpen: !g.isOpen }))
                    }
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-gray-100"
                    aria-label="Toggle group"
                  >
                    <i
                      className={`fas fa-chevron-down transition-transform ${
                        group.isOpen ? "" : "-rotate-90"
                      }`}
                    />
                  </button>
                </div>

                {group.isOpen && (
                  <div className="p-4">
                    {group.items.length === 0 && (
                      <p className="mb-4 text-sm text-muted">
                        No granular objectives yet
                      </p>
                    )}

                    {/* Selection toolbar */}
                    {group.items.length > 0 && selectedCount > 0 && (
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-page px-4 py-2.5">
                        <div className="flex items-center gap-4">
                          <label className="flex items-center gap-2 text-sm text-ink">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              ref={(el) => {
                                if (el)
                                  el.indeterminate = selectedCount > 0 && !allSelected;
                              }}
                              onChange={(event) =>
                                updateGroup(group.id, (g) => ({
                                  ...g,
                                  items: g.items.map((i) => ({
                                    ...i,
                                    selected: event.target.checked,
                                  })),
                                }))
                              }
                              className="h-4 w-4 accent-primary"
                            />
                            <span>Select all in this meta</span>
                          </label>
                          <span className="text-sm text-muted">
                            {selectedCount} selected
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setGranularCount(3);
                              setUseDefaults(true);
                              setGranularizeTarget(group.id);
                            }}
                            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-dark"
                          >
                            Make more granular
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateGroup(group.id, (g) => ({
                                ...g,
                                items: g.items.filter((i) => !i.selected),
                              }))
                            }
                            className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-danger/85"
                          >
                            Delete selected
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Items */}
                    <div className="space-y-3">
                      {group.items.map((item) => {
                        const showBloomValidation =
                          showValidation &&
                          item.mode === "manual" &&
                          item.bloom.length === 0;
                        return (
                          <div
                            key={item.id}
                            className={`flex gap-3 rounded-xl border border-gray-100 p-3 ${
                              item.level === 2 ? "ml-8" : ""
                            }`}
                          >
                            <div className="flex flex-col items-center gap-2 pt-1">
                              <input
                                type="checkbox"
                                checked={!!item.selected}
                                onChange={() =>
                                  updateGroup(group.id, (g) => ({
                                    ...g,
                                    items: g.items.map((i) =>
                                      i.id === item.id
                                        ? { ...i, selected: !i.selected }
                                        : i
                                    ),
                                  }))
                                }
                                className="h-4 w-4 accent-primary"
                              />
                              <button
                                type="button"
                                title="Delete granular objective from page"
                                onClick={() => deleteItem(group, item)}
                                className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                              >
                                <i className="fas fa-trash-alt text-sm" />
                              </button>
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                  <AutoGrowTextarea
                                    value={item.text}
                                    placeholder="Enter granular objective"
                                    onCommit={(value) =>
                                      commitItemText(group, item, value)
                                    }
                                    className="text-sm text-ink"
                                  />
                                </div>
                                {item.level === 2 && (
                                  <span className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
                                    Sub-LO
                                  </span>
                                )}
                              </div>

                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <div className="flex flex-wrap gap-1.5">
                                  {BLOOM_LEVELS.map((level) => {
                                    const isSelected = item.bloom.includes(level);
                                    return (
                                      <button
                                        key={level}
                                        type="button"
                                        aria-checked={isSelected}
                                        disabled={item.mode === "auto"}
                                        onClick={() =>
                                          toggleBloomChip(group, item, level)
                                        }
                                        className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                                          isSelected
                                            ? "bg-primary text-white"
                                            : "bg-gray-100 text-muted hover:bg-gray-200"
                                        } disabled:opacity-50`}
                                      >
                                        {level}
                                      </button>
                                    );
                                  })}
                                </div>
                                <div className="ml-auto flex shrink-0 overflow-hidden rounded-md border border-gray-200 text-xs">
                                  <span className="bg-primary px-2 py-1 font-medium text-white">
                                    Choose Bloom
                                  </span>
                                  <span
                                    title="Not yet implemented"
                                    className="cursor-not-allowed bg-gray-50 px-2 py-1 text-gray-400"
                                  >
                                    AI decide later
                                  </span>
                                </div>
                              </div>

                              {showBloomValidation && (
                                <div className="mt-2 flex items-center gap-1.5 text-xs text-danger">
                                  <i className="fas fa-exclamation-circle" />
                                  <span>
                                    Please select at least one Bloom's Taxonomy level.
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Count stepper */}
                            <div className="flex shrink-0 items-center gap-1.5 self-start pt-1">
                              <button
                                type="button"
                                disabled={
                                  item.count <= Math.max(2, item.bloom.length)
                                }
                                onClick={() => changeCount(group, item, -1)}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-muted transition-colors hover:bg-gray-50 disabled:opacity-30"
                              >
                                <i className="fas fa-minus text-xs" />
                              </button>
                              <span className="w-6 text-center text-sm font-semibold text-ink">
                                {item.count}
                              </span>
                              <button
                                type="button"
                                disabled={item.count >= 9}
                                onClick={() => changeCount(group, item, 1)}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-muted transition-colors hover:bg-gray-50 disabled:opacity-30"
                              >
                                <i className="fas fa-plus text-xs" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Footer */}
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => addNewGranular(group)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-primary bg-white px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/5"
                      >
                        <i className="fas fa-plus" /> Add Granular Objective
                      </button>
                      <span
                        className={`text-xs ${isWarning ? "font-semibold text-danger" : "text-muted"}`}
                      >
                        Total questions: {totalCount} Minimum required per learning
                        objective: 5 ({totalCount >= 5 ? "≥5" : "<5"})
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* AI generate modal */}
      {aiModalOpen && (
        <AIGenerateModal
          course={course}
          onClose={() => setAiModalOpen(false)}
          onSaved={handleAISaved}
        />
      )}

      {/* Delete confirmation modal */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Remove Learning Objective?"
        footer={null}
      >
        <p className="mb-5 text-ink">
          This will remove the learning objective from the current page. It will not be
          deleted from the database.
        </p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => {
              setObjectiveGroups((prev) => prev.filter((g) => g.id !== deleteTarget));
              setDeleteTarget(null);
            }}
            className="rounded-lg bg-danger px-4 py-2.5 font-medium text-white transition-colors hover:bg-danger/85"
          >
            <i className="fas fa-trash-alt mr-2" /> Remove from current view
          </button>
          <button
            type="button"
            onClick={() => setDeleteTarget(null)}
            className="text-sm text-muted underline"
          >
            Cancel
          </button>
        </div>
      </Modal>

      {/* Granularization modal */}
      <Modal
        open={granularizeTarget !== null}
        onClose={() => setGranularizeTarget(null)}
        title="Make more granular"
        footer={
          <>
            <button
              type="button"
              onClick={() => setGranularizeTarget(null)}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmGranularization}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
            >
              Confirm
            </button>
          </>
        }
      >
        <div className="space-y-5">
          <div>
            <label className="mb-2 block font-semibold text-ink">
              How many per selected LO?
            </label>
            <div className="flex gap-4">
              {[2, 3].map((count) => (
                <label key={count} className="flex items-center gap-2 text-ink">
                  <input
                    type="radio"
                    name="granular-count"
                    checked={granularCount === count}
                    onChange={() => setGranularCount(count)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span>{count}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-2 block font-semibold text-ink">
              Bloom assignment:
            </label>
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={useDefaults}
                  onChange={() => setUseDefaults(true)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span>
                  Use defaults (Identify=Remember/Understand, Explain=Understand/Analyze,
                  Apply=Apply)
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={!useDefaults}
                  onChange={() => setUseDefaults(false)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span>I'll choose later (creates with no chips selected)</span>
              </label>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
