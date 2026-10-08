import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Modal from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { LoadingRow } from "../../components/ui/states";
import { useDetailedObjectives } from "../../hooks/useObjectives";
import { useSaveQuestions } from "../../hooks/useQuestions";
import {
  parseQuestionsFile,
  flattenGranulars,
  matchGranular,
  toSavePayload,
  isRowResolved,
} from "../../lib/questionImport";
import {
  COURSE_EXPORT_MESSAGE,
  commitQueue,
  describeImportProgress,
  importButtonLabel,
  initialSelections,
  isCanvasCourseExportFile,
  isCanvasExportFile,
  mergeCommitReports,
  summarizeSelection,
} from "../../lib/canvasImport";
import { useImportedObjectives } from "../../hooks/useImportedObjectives";
import { useCanvasQuizImport } from "../../hooks/useCanvasQuizImport";
import ImportQuestionReview from "../../components/ImportQuestionReview";
import CanvasImportReview from "../../components/CanvasImportReview";
import CanvasImportResult from "../../components/CanvasImportResult";

const btnSecondary =
  "rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-60";
const btnPrimary =
  "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60";

// Import questions into the course question bank from either:
// - a GRASP JSON export. Each question must resolve to one of the course's
//   granular objectives before the import is allowed (matched automatically
//   where possible, picked from a dropdown otherwise) — the meta objective is
//   derived server-side from that granular.
// - a Canvas quiz export (.zip, issue #140). The server previews the file, the
//   instructor picks which Canvas quizzes to bring in, then each one is
//   committed in turn; the server creates the objectives itself.
export default function ImportQuestionsModal({ courseId, onClose, onBack, onImported }) {
  const showToast = useToast();
  const fileRef = useRef(null);
  const fileInputId = useId();
  const fileHelpId = useId();
  const { objectives: detailedObjectives, isPending: objectivesLoading } =
    useDetailedObjectives(courseId);

  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]); // { question, granularId }
  const [parseError, setParseError] = useState("");

  // Canvas flow: null (JSON flow) | "reading" | "review" | "importing" | "result".
  const canvasImport = useCanvasQuizImport(courseId);
  const [canvasPhase, setCanvasPhase] = useState(null);
  const [canvasFile, setCanvasFile] = useState(null);
  const [canvasPreview, setCanvasPreview] = useState(null);
  const [selections, setSelections] = useState({});
  const [progress, setProgress] = useState(null); // { index, total, title }
  const [canvasResult, setCanvasResult] = useState(null);
  // Bumped per file chosen, so a slow preview of an earlier file is ignored.
  const fileRequest = useRef(0);
  // While quizzes are being committed the dialog stays open: closing it would
  // hide the report of what was saved. The handler Modal gets must keep one
  // identity: Modal re-focuses its close button whenever onClose changes, and
  // parents pass a new inline onClose on every render (e.g. when the question
  // bank refetches after an import), which would pull focus off the result.
  // So the latest onClose is read from a ref.
  const committing = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const handleClose = useCallback(() => {
    if (!committing.current) onCloseRef.current();
  }, []);

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

  const objectives = useImportedObjectives(courseId, flatGranulars, detailedObjectives);

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

  const resetCanvas = () => {
    fileRequest.current += 1;
    setCanvasPhase(null);
    setCanvasFile(null);
    setCanvasPreview(null);
    setSelections({});
    setProgress(null);
    setCanvasResult(null);
  };

  // Sends the zip for a preview; nothing is written until the instructor imports.
  const readCanvasExport = async (file) => {
    const request = ++fileRequest.current;
    setFileName(file.name);
    setParseError("");
    setRows([]);
    objectives.load([]);
    setCanvasFile(file);
    setCanvasPreview(null);
    setCanvasResult(null);
    setCanvasPhase("reading");
    try {
      const preview = await canvasImport.preview(file);
      if (request !== fileRequest.current) return;
      setCanvasPreview(preview);
      setSelections(initialSelections(preview));
      setCanvasPhase("review");
    } catch (error) {
      if (request !== fileRequest.current) return;
      resetCanvas();
      setParseError(error.message || "Could not read that Canvas export.");
    }
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again (to retry a failed preview, or
    // to import the quizzes left out) fires change again. The File stays usable.
    event.target.value = "";
    if (!file) return;
    // A full course export is often over the upload limit, so it is answered
    // here: uploading it would only get "too large" back.
    if (isCanvasCourseExportFile(file)) {
      resetCanvas();
      setFileName(file.name);
      setRows([]);
      objectives.load([]);
      setParseError(COURSE_EXPORT_MESSAGE);
      return;
    }
    if (isCanvasExportFile(file)) {
      readCanvasExport(file);
      return;
    }
    resetCanvas();
    setFileName(file.name);
    setParseError("");
    try {
      const text = await file.text();
      const parsed = parseQuestionsFile(text);
      objectives.load(parsed.objectives, parsed.questions);
      setRows(
        parsed.questions.map((question) => ({
          question,
          granularId: matchGranular(question, flatGranulars),
        }))
      );
    } catch (error) {
      setRows([]);
      objectives.load([]);
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

  const unresolvedCount = rows.filter((row) => !isRowResolved(row, objectives.checkedKeys)).length;
  const canImport =
    rows.length > 0 && unresolvedCount === 0 && !saveMutation.isPending && !objectives.creating;

  // Creates the checked objectives, re-matches the rows against the granulars that
  // now exist, then saves. The server derives each meta from the granular's parent.
  const handleImport = async () => {
    if (!canImport) return;
    let granulars;
    try {
      granulars = await objectives.createChecked();
    } catch (error) {
      showToast(error.message || "Failed to create learning objectives", "error");
      return;
    }
    const resolved = rows.map((row) => ({
      ...row,
      granularId: row.granularId || matchGranular(row.question, granulars),
    }));
    if (resolved.some((row) => !row.granularId)) {
      setRows(resolved);
      showToast("Some questions still need a learning objective", "error");
      return;
    }
    saveMutation.mutate({
      questions: resolved.map((row) => toSavePayload(row.question, row.granularId)),
      quizId: null,
      dedupe: true,
    });
  };

  const canvasMode = canvasPhase !== null;
  const importing = canvasPhase === "importing";
  const canvasSummary = canvasPreview ? summarizeSelection(canvasPreview, selections) : null;

  // Commits the ticked Canvas quizzes one by one, then shows what happened.
  const handleCanvasImport = async () => {
    const queue = commitQueue(canvasPreview, selections);
    if (!canvasFile || queue.length === 0) return;
    committing.current = true;
    setCanvasPhase("importing");
    setProgress({ index: 1, total: queue.length, title: queue[0].title });
    try {
      const { reports, errors } = await canvasImport.commitAll(canvasFile, queue, (step) => {
        if (step.status === "importing") {
          setProgress({ index: step.index, total: step.total, title: step.title });
        }
      });
      setCanvasResult(mergeCommitReports(reports, errors));
      setCanvasPhase("result");
      onImported?.();
    } catch (error) {
      setCanvasPhase("review");
      showToast(error.message || "The Canvas import failed.", "error");
    } finally {
      committing.current = false;
    }
  };

  const jsonFooter = (
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
        {objectives.creating
          ? "Creating objectives..."
          : saveMutation.isPending
          ? "Importing..."
          : rows.length > 0
            ? `Import ${rows.length} question${rows.length === 1 ? "" : "s"}`
            : "Import"}
      </button>
    </>
  );

  const canvasFooter =
    canvasPhase === "result" ? (
      <button type="button" onClick={onClose} className={btnPrimary}>
        Done
      </button>
    ) : (
      <>
        <button type="button" onClick={onClose} disabled={importing} className={btnSecondary}>
          Cancel
        </button>
        {onBack && (
          <button type="button" onClick={onBack} disabled={importing} className={btnSecondary}>
            Back
          </button>
        )}
        <button
          type="button"
          disabled={canvasPhase !== "review" || !canvasSummary || canvasSummary.quizzes === 0}
          onClick={handleCanvasImport}
          className={btnPrimary}
        >
          {canvasPhase === "reading"
            ? "Reading..."
            : importing
              ? "Importing..."
              : canvasSummary
                ? importButtonLabel(canvasSummary)
                : "Import"}
        </button>
      </>
    );

  return (
    <Modal
      open
      onClose={handleClose}
      title="Import Questions"
      wide
      footer={canvasMode ? canvasFooter : jsonFooter}
    >
      <div className="space-y-4">
        <div>
          <p id={fileHelpId} className="mb-2 text-sm text-muted">
            Upload a GRASP JSON export or a Canvas quiz export (.zip). Questions from a JSON export
            must each be linked to one of this course's learning objectives before they can be
            imported; a Canvas export brings its own objectives, one per question group.
          </p>
          <label htmlFor={fileInputId} className="mb-1 block text-sm font-semibold text-ink">
            Export file
          </label>
          <input
            id={fileInputId}
            ref={fileRef}
            type="file"
            accept="application/json,.json,application/zip,.zip,.imscc"
            aria-describedby={fileHelpId}
            disabled={canvasPhase === "reading" || importing}
            onChange={handleFile}
            className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-primary-dark disabled:opacity-60"
          />
          {fileName && !parseError && !canvasMode && (
            <p className="mt-2 text-xs text-muted">
              <i className="fas fa-file-code mr-1" />
              {fileName} — {rows.length} question{rows.length === 1 ? "" : "s"}
            </p>
          )}
          {fileName && !parseError && canvasMode && (
            <p className="mt-2 text-xs text-muted">
              <i className="fas fa-file-zipper mr-1" aria-hidden="true" />
              {fileName} — Canvas quiz export
            </p>
          )}
          {parseError && (
            <p className="mt-2 text-sm text-danger">
              <i className="fas fa-triangle-exclamation mr-1" />
              {parseError}
            </p>
          )}
        </div>

        {canvasPhase === "reading" && (
          <div role="status">
            <LoadingRow label="Reading the Canvas export..." />
          </div>
        )}

        {canvasPhase === "review" && canvasPreview && (
          <CanvasImportReview
            preview={canvasPreview}
            selections={selections}
            onChange={setSelections}
          />
        )}

        {importing && progress && (
          <div className="rounded-xl border border-gray-200 p-4">
            <p role="status" aria-live="polite" className="text-sm font-medium text-ink">
              <i className="fas fa-spinner fa-spin mr-2 text-primary" aria-hidden="true" />
              {describeImportProgress(progress)}
            </p>
            <progress
              value={progress.index - 1}
              max={progress.total}
              aria-label="Canvas quizzes imported so far"
              className="mt-3 h-2 w-full accent-primary"
            />
            <p className="mt-2 text-xs text-muted">
              Images are downloaded from Canvas as each quiz is imported, so this can take a
              minute per quiz. Keep this window open.
            </p>
          </div>
        )}

        {canvasPhase === "result" && canvasResult && <CanvasImportResult result={canvasResult} />}

        {!canvasMode && (
          <ImportQuestionReview
            rows={rows}
            objectives={objectives}
            granularGroups={granularGroups}
            flatGranularsEmpty={flatGranulars.length === 0}
            objectivesLoading={objectivesLoading}
            onChangeRow={setRowGranular}
          />
        )}
      </div>
    </Modal>
  );
}
