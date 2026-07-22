import { useMemo, useRef, useState } from "react";
import Modal from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { useDetailedObjectives } from "../../hooks/useObjectives";
import { useSaveQuestions } from "../../hooks/useQuestions";
import {
  parseQuestionsFile,
  flattenGranulars,
  matchGranular,
  importQuestionLabel,
  toSavePayload,
} from "../../lib/questionImport";
import { formatQuestionTypeLabel } from "../../lib/utils";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none";

// Import questions from a GRASP JSON export into the course question bank. Each
// question must resolve to one of the course's granular objectives before the
// import is allowed (matched automatically where possible, picked from a dropdown
// otherwise) — the meta objective is derived server-side from that granular.
export default function ImportQuestionsModal({ courseId, onClose, onBack, onImported }) {
  const showToast = useToast();
  const fileRef = useRef(null);
  const { objectives: detailedObjectives, isPending: objectivesLoading } =
    useDetailedObjectives(courseId);

  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]); // { question, granularId }
  const [parseError, setParseError] = useState("");

  const flatGranulars = useMemo(
    () => flattenGranulars(detailedObjectives),
    [detailedObjectives]
  );
  // Group granulars by meta objective for the dropdown's optgroups.
  const granularGroups = useMemo(() => {
    const byMeta = new Map();
    flatGranulars.forEach((g) => {
      if (!byMeta.has(g.metaId)) byMeta.set(g.metaId, { metaName: g.metaName, items: [] });
      byMeta.get(g.metaId).items.push(g);
    });
    return Array.from(byMeta.values());
  }, [flatGranulars]);

  const saveMutation = useSaveQuestions(courseId, {
    onSuccess: (data) => {
      const count = data?.savedCount ?? rows.length;
      showToast(`Imported ${count} question${count === 1 ? "" : "s"}`, "success");
      onImported?.();
      onClose();
    },
    onError: (error) => showToast(error.message || "Failed to import questions", "error"),
  });

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    try {
      const text = await file.text();
      const { questions } = parseQuestionsFile(text);
      setRows(
        questions.map((question) => ({
          question,
          granularId: matchGranular(question, flatGranulars),
        }))
      );
    } catch (error) {
      setRows([]);
      setParseError(error.message || "Could not read that file.");
    }
  };

  const setRowGranular = (index, granularId) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, granularId } : row)));
  };

  const unresolvedCount = rows.filter((row) => !row.granularId).length;
  const canImport = rows.length > 0 && unresolvedCount === 0 && !saveMutation.isPending;

  const handleImport = () => {
    if (!canImport) return;
    const questions = rows.map((row) => toSavePayload(row.question, row.granularId));
    saveMutation.mutate({ questions, quizId: null });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Import Questions"
      wide
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
            >
              Back
            </button>
          )}
          <button
            type="button"
            disabled={!canImport}
            onClick={handleImport}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
          >
            {saveMutation.isPending
              ? "Importing..."
              : rows.length > 0
                ? `Import ${rows.length} question${rows.length === 1 ? "" : "s"}`
                : "Import"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm text-muted">
            Upload a GRASP JSON export. Each question must be linked to one of this course's
            learning objectives before it can be imported.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFile}
            className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-primary-dark"
          />
          {fileName && !parseError && (
            <p className="mt-2 text-xs text-muted">
              <i className="fas fa-file-code mr-1" />
              {fileName} — {rows.length} question{rows.length === 1 ? "" : "s"}
            </p>
          )}
          {parseError && (
            <p className="mt-2 text-sm text-danger">
              <i className="fas fa-triangle-exclamation mr-1" />
              {parseError}
            </p>
          )}
        </div>

        {rows.length > 0 && (
          <>
            {unresolvedCount > 0 && (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <i className="fas fa-circle-info mr-1" />
                {unresolvedCount} question{unresolvedCount === 1 ? "" : "s"} still need a learning
                objective before you can import.
              </div>
            )}
            {objectivesLoading ? (
              <p className="text-sm text-muted">Loading objectives…</p>
            ) : flatGranulars.length === 0 ? (
              <p className="text-sm text-danger">
                This course has no granular learning objectives yet. Add objectives before
                importing questions.
              </p>
            ) : (
              <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
                {rows.map((row, index) => {
                  const matched = Boolean(row.granularId);
                  return (
                    <div
                      key={index}
                      className={`rounded-xl border p-3 ${matched ? "border-gray-200" : "border-amber-300 bg-amber-50/40"}`}
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-ink line-clamp-2">
                          {importQuestionLabel(row.question) || "(untitled question)"}
                        </p>
                        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-muted">
                          {formatQuestionTypeLabel(
                            row.question.questionType || row.question.type
                          )}
                        </span>
                      </div>
                      <label className="mb-1 block text-xs font-semibold text-ink">
                        Learning Objective{" "}
                        {matched ? (
                          <span className="font-normal text-success">
                            <i className="fas fa-check mr-0.5" />
                            matched
                          </span>
                        ) : (
                          <span className="font-normal text-danger">— required</span>
                        )}
                      </label>
                      <select
                        aria-label={`Learning objective for question ${index + 1}`}
                        value={row.granularId}
                        onChange={(event) => setRowGranular(index, event.target.value)}
                        className={inputClass}
                      >
                        <option value="">— Select a learning objective —</option>
                        {granularGroups.map((group) => (
                          <optgroup key={group.metaName} label={group.metaName}>
                            {group.items.map((granular) => (
                              <option key={granular.id} value={granular.id}>
                                {granular.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
