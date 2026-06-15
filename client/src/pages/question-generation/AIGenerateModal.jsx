import { useState } from "react";
import { api } from "../../lib/api";
import { escapeHtml, formatFileSize } from "../../lib/format";
import { useCourseMaterials } from "../../hooks/useMaterials";
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

// Modal that generates learning objectives from a selected material via the
// RAG/LLM pipeline, with optional user-provided objectives to reorganize.
export default function AIGenerateModal({ course, onClose, onSaved }) {
  const showToast = useToast();
  const [customRows, setCustomRows] = useState([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generated, setGenerated] = useState(null); // [{ name, granularObjectives }]
  const [selectedIndices, setSelectedIndices] = useState(new Set());

  const { materials, isPending: materialsPending } = useCourseMaterials(course?.id);

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
        {materialsPending ? (
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
