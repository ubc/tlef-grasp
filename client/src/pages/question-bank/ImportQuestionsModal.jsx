import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { useDetailedObjectives } from "../../hooks/useObjectives";
import { useSaveQuestions } from "../../hooks/useQuestions";
import {
  parseQuestionsFile,
  flattenGranulars,
  matchGranular,
  toSavePayload,
} from "../../lib/questionImport";
import ImportQuestionReview from "../../components/ImportQuestionReview";

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
      const skipped = data?.duplicateCount || 0;
      const suffix = skipped ? ` (skipped ${skipped} duplicate${skipped === 1 ? "" : "s"})` : "";
      showToast(`Imported ${count} question${count === 1 ? "" : "s"}${suffix}`, "success");
      onImported?.();
      onClose();
    },
    onError: (error) =>
      showToast(error.message || "Failed to import questions", "error"),
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

  // Objectives may finish loading after a file is chosen; re-match any rows that
  // are still unresolved once they arrive.
  useEffect(() => {
    if (flatGranulars.length === 0) return;
    setRows((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        if (row.granularId) return row;
        const match = matchGranular(row.question, flatGranulars);
        if (match) {
          changed = true;
          return { ...row, granularId: match };
        }
        return row;
      });
      return changed ? next : prev;
    });
  }, [flatGranulars]);

  const setRowGranular = (index, granularId) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, granularId } : row)));
  };

  const unresolvedCount = rows.filter((row) => !row.granularId).length;
  const canImport = rows.length > 0 && unresolvedCount === 0 && !saveMutation.isPending;

  const handleImport = () => {
    if (!canImport) return;
    const questions = rows.map((row) => toSavePayload(row.question, row.granularId));
    saveMutation.mutate({ questions, quizId: null, dedupe: true });
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

        <ImportQuestionReview
          rows={rows}
          granularGroups={granularGroups}
          flatGranularsEmpty={flatGranulars.length === 0}
          objectivesLoading={objectivesLoading}
          onChangeRow={setRowGranular}
        />
      </div>
    </Modal>
  );
}
