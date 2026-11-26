import { useMemo, useState } from "react";
import { formatFileSize } from "../../lib/format";
import { useCourseMaterials } from "../../hooks/useMaterials";
import { useDetailedObjectives } from "../../hooks/useObjectives";
import { isCanvasImportMaterial } from "../../lib/materials";
import { MAX_MATERIALS_PER_OBJECTIVE } from "../../lib/constants";
import Modal from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { generateAndSaveObjectives } from "./objectiveGeneration";
import { existingObjectiveCoverage } from "./existingObjectiveCoverage";

function getMaterialTypeLabel(fileType) {
  if (!fileType) return "Unknown";
  if (fileType.includes("pdf")) return "PDF";
  if (fileType.includes("text")) return "Text";
  if (fileType.includes("word")) return "Word";
  if (fileType === "link") return "Link";
  return fileType;
}

// Modal that generates learning objectives from selected materials (up to
// MAX_MATERIALS_PER_OBJECTIVE) via the RAG/LLM pipeline, with optional
// user-provided objectives to reorganize.
//
// Generating is the last thing that happens here. It used to hand back a
// preview to tick through and a Save Selected button, but instructors did not
// want to confirm a list they cannot edit (#101): everything the generator
// returns is saved and the modal closes onto the editable page, where
// rewording and removing already live.
//
// Generating never replaces or deletes anything. When the selected materials
// already have saved objectives, the modal lists them; generating shows the
// model those objectives so it only adds what they do not cover, instead of
// saving another reworded copy. "Use existing" is offered only when every
// selected material has objectives; otherwise one of them still needs
// generating.
export default function AIGenerateModal({ course, onClose, onSaved, onUseExisting }) {
  const showToast = useToast();
  const [customRows, setCustomRows] = useState([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [selectedMaterialIds, setSelectedMaterialIds] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [generationMessage, setGenerationMessage] = useState("");

  const { materials: courseMaterials, isPending: materialsPending } = useCourseMaterials(
    course?.id
  );
  // The "From Canvas" material has no content to generate objectives from.
  const materials = courseMaterials.filter((material) => !isCanvasImportMaterial(material));

  const { objectives: courseObjectives, isPending: objectivesPending } =
    useDetailedObjectives(course?.id);
  // Saved objectives linked to any of the selected materials, and which
  // selected materials have none yet.
  const {
    existing: existingObjectives,
    uncoveredMaterialIds,
    fullyCovered,
  } = useMemo(
    () => existingObjectiveCoverage(courseObjectives, selectedMaterialIds),
    [courseObjectives, selectedMaterialIds]
  );
  const hasExisting = existingObjectives.length > 0;
  const uncoveredTitles = uncoveredMaterialIds.map(
    (sourceId) => materials.find((m) => m.sourceId === sourceId)?.documentTitle || "Untitled"
  );
  // Until the course's objectives load, generating could not show the model
  // what already exists, so it waits for them.
  const checkingExisting = selectedMaterialIds.length > 0 && objectivesPending;

  const handleUseExisting = () => {
    onUseExisting(existingObjectives);
    showToast(
      `Added ${existingObjectives.length} existing learning objective${
        existingObjectives.length === 1 ? "" : "s"
      } to the page`,
      "success"
    );
    onClose();
  };

  // Cap is enforced here as well as server-side so the instructor is stopped
  // before a rejected save, not after.
  const toggleMaterial = (sourceId) => {
    setSelectedMaterialIds((prev) => {
      if (prev.includes(sourceId)) return prev.filter((id) => id !== sourceId);
      if (prev.length >= MAX_MATERIALS_PER_OBJECTIVE) return prev;
      return [...prev, sourceId];
    });
  };

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
    if (selectedMaterialIds.length === 0) {
      showToast("Please select at least one material", "warning");
      return;
    }
    setGenerating(true);
    setGenerationMessage("");
    const materialTitles = Object.fromEntries(
      selectedMaterialIds.map((sourceId) => [
        sourceId,
        materials.find((m) => m.sourceId === sourceId)?.documentTitle || "",
      ])
    );
    const userObjectives = customRows.map((row) => row.trim()).filter(Boolean);

    try {
      const { saved, failed } = await generateAndSaveObjectives({
        course,
        materialIds: selectedMaterialIds,
        materialTitles,
        userObjectives,
      });

      failed.forEach(({ name, error }) =>
        showToast(`Failed to save "${name}": ${error.message}`, "error")
      );

      // Nothing saved means there is nothing to land on, so the modal stays
      // open with its inputs intact — the instructor can pick a different
      // material or add their own objectives without setting this up again.
      if (saved.length === 0) {
        setGenerationMessage("Every generated objective failed to save.");
        return;
      }

      // The selection's existing objectives go on the page too: generating
      // only adds what they do not cover, so the new ones alone would leave
      // the materials' other objectives off the list. Ones already on the
      // page are skipped.
      if (hasExisting) onUseExisting(existingObjectives);
      onSaved(saved);
      const plural = (n) => (n === 1 ? "" : "s");
      showToast(
        hasExisting
          ? `Added ${saved.length} new and ${existingObjectives.length} existing learning objective${plural(existingObjectives.length)} to the page`
          : `Added ${saved.length} learning objective${plural(saved.length)} to the page`,
        "success"
      );
      onClose();
    } catch (error) {
      console.error("Error generating learning objectives:", error);
      // ALREADY_COVERED: the existing objectives cover the materials, so the
      // model had nothing new to add. Nothing was saved.
      const message =
        error.body?.code === "ALREADY_COVERED" && error.body?.details
          ? `${error.message} ${error.body.details}`
          : error.message || "Failed to generate learning objectives";
      setGenerationMessage(message);
      showToast(message, "error");
    } finally {
      setGenerating(false);
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
          <button
            type="button"
            disabled={selectedMaterialIds.length === 0 || generating || checkingExisting}
            onClick={handleGenerate}
            className={
              fullyCovered
                ?"inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-50"
                : "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
            }
          >
            {generating ? (
              <>
                <i className="fas fa-spinner fa-spin" /> Generating...
              </>
            ) : (
              <>
                <i className="fas fa-magic" /> {fullyCovered ? "Generate more" : "Generate"}
              </>
            )}
          </button>
          {/* Only a complete answer when no selected material is left without
              objectives. */}
          {fullyCovered && (
            <button
              type="button"
              disabled={generating}
              onClick={handleUseExisting}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
            >
              <i className="fas fa-check" /> Use existing ({existingObjectives.length})
            </button>
          )}
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">
        Select up to {MAX_MATERIALS_PER_OBJECTIVE} course materials to generate
        learning objectives from. The AI will analyze the content and create relevant learning objectives. If you
        provide your own learning objectives, the AI will reorganize them into a proper
        hierarchy rather than generating new ones (optional). Generated objectives
        are saved automatically and opened on the edit page. Existing learning
        objectives are never changed or removed by generating.
      </p>

      {/* Custom objectives */}
      <fieldset disabled={generating}>
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
      <label className="mb-1 block font-semibold text-ink">
        Select Materials:
      </label>
      <p className="mb-3 text-xs text-muted">
        <i className="fas fa-info-circle mr-1 text-primary" />
        Choose up to {MAX_MATERIALS_PER_OBJECTIVE} course materials. Each one is
        searched separately, so every material you pick contributes to the
        generated objectives.
        <span className="ml-1 font-semibold text-ink">
          {selectedMaterialIds.length} of {MAX_MATERIALS_PER_OBJECTIVE} selected
          {selectedMaterialIds.length >= MAX_MATERIALS_PER_OBJECTIVE ? " (max)" : ""}
        </span>
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
          materials.map((material) => {
            const isSelected = selectedMaterialIds.includes(material.sourceId);
            const atCap = selectedMaterialIds.length >= MAX_MATERIALS_PER_OBJECTIVE;
            const disabled = !isSelected && atCap;
            return (
              <label
                key={material.sourceId}
                className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-gray-200 hover:border-primary/40"
                } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={disabled}
                  onChange={() => toggleMaterial(material.sourceId)}
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
            );
          })
        )}
      </div>

      {/* Objectives already saved for the selection */}
      {checkingExisting && (
        <p className="mt-4 text-sm text-muted" role="status">
          <i className="fas fa-spinner fa-spin mr-2" /> Checking for existing learning objectives...
        </p>
      )}
      {hasExisting && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4" role="region" aria-label="Existing learning objectives">
          <p className="font-semibold text-emerald-900">
            {existingObjectives.length} learning objective
            {existingObjectives.length === 1 ? " already exists" : "s already exist"} for the
            selected materials
          </p>
          {fullyCovered ? (
            <p className="mt-1 text-sm text-emerald-800">
              Use them as they are, or generate more: new objectives are only added
              for content these do not cover yet, and both go on the page.
              Nothing here is changed or removed.
            </p>
          ) : (
            <p className="mt-1 text-sm text-emerald-800">
              No learning objectives yet for{" "}
              <span className="font-semibold">{uncoveredTitles.join(", ")}</span>.
              Generate creates them, without repeating the ones below, and adds
              both to the page. Nothing here is changed or removed.
            </p>
          )}
          <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-sm text-emerald-950">
            {existingObjectives.map((objective) => (
              <li key={objective.id} className="flex items-start gap-2">
                <i className="fas fa-bullseye mt-1 text-xs text-emerald-600" aria-hidden="true" />
                <span>
                  {objective.name}
                  <span className="ml-1 text-xs text-emerald-700">
                    ({objective.granular.length} granular)
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Generation status */}
      </fieldset>
      {generating && (
        <div role="status" className="mt-5 rounded-lg border border-sky-200 bg-sky-50 p-4">
          <div className="flex items-center gap-3 text-sky-900">
            <i className="fas fa-spinner fa-spin text-sky-600" />
            <div>
              <span className="font-medium">Generating learning objectives...</span>
              <p className="mt-0.5 text-sm text-sky-800">
                They will open for editing as soon as they are ready.
              </p>
            </div>
          </div>
        </div>
      )}

      {generationMessage && !generating && (
        <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4" role="alert">
          <div className="flex items-start gap-3 text-amber-950">
            <i className="fas fa-circle-info mt-0.5 text-amber-700" aria-hidden="true" />
            <div>
              <p className="font-semibold">No learning objectives were created</p>
              <p className="mt-1 text-sm">{generationMessage}</p>
              <p className="mt-2 text-sm">Try another material or add your own objectives above; we will preserve them.</p>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
