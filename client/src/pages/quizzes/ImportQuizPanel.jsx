import { useEffect, useMemo, useState } from "react";
import { useToast } from "../../components/ui/Toast";
import { useDetailedObjectives } from "../../hooks/useObjectives";
import { useCreateQuiz } from "../../hooks/useQuizzes";
import {
  parseQuestionsFile,
  flattenGranulars,
  matchGranular,
  toSavePayload,
} from "../../lib/questionImport";
import ImportQuestionReview from "../../components/ImportQuestionReview";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary focus:outline-none";

// Default quiz settings when the uploaded file is a bare questions export with
// no `quiz` metadata block.
const DEFAULT_META = {
  name: "",
  description: "",
  deliveryFormat: "all-approved",
  disablePreviousNavigation: false,
  timeLimitMinutes: 60,
};

// Import a whole quiz from a GRASP JSON export: recreate it with the file's
// settings (name, time limit, delivery format, navigation) and its questions,
// each gated on one of the course's learning objectives.
export default function ImportQuizPanel({ courseId, onBack, onCreated }) {
  const showToast = useToast();
  const { objectives: detailedObjectives, isPending: objectivesLoading } =
    useDetailedObjectives(courseId);

  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [meta, setMeta] = useState(DEFAULT_META);
  const [name, setName] = useState("");
  const [rows, setRows] = useState([]); // { question, granularId }

  const flatGranulars = useMemo(
    () => flattenGranulars(detailedObjectives),
    [detailedObjectives]
  );
  const granularGroups = useMemo(() => {
    const byMeta = new Map();
    flatGranulars.forEach((g) => {
      if (!byMeta.has(g.metaId)) byMeta.set(g.metaId, { metaName: g.metaName, items: [] });
      byMeta.get(g.metaId).items.push(g);
    });
    return Array.from(byMeta.values());
  }, [flatGranulars]);

  const createMutation = useCreateQuiz(courseId, {
    onSuccess: (data) => {
      const added = data?.questionsAdded ?? rows.length;
      const skipped = data?.duplicateCount || 0;
      const suffix = skipped ? ` (skipped ${skipped} duplicate${skipped === 1 ? "" : "s"})` : "";
      showToast(
        `Imported quiz with ${added} question${added === 1 ? "" : "s"}${suffix}`,
        "success"
      );
      onCreated();
    },
    onError: (error) => showToast(error.message || "Failed to import quiz", "error"),
  });

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    try {
      const text = await file.text();
      const parsed = parseQuestionsFile(text);
      const importedMeta = { ...DEFAULT_META, ...(parsed.quiz || {}) };
      setMeta(importedMeta);
      setName(importedMeta.name || "");
      setRows(
        parsed.questions.map((question) => ({
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
  const canCreate =
    Boolean(name.trim()) &&
    rows.length > 0 &&
    unresolvedCount === 0 &&
    flatGranulars.length > 0 &&
    !createMutation.isPending;

  const handleCreate = () => {
    if (!canCreate) return;
    createMutation.mutate({
      courseId,
      name: name.trim(),
      description: meta.description || "",
      deliveryFormat: meta.deliveryFormat === "spaced-3phase" ? "spaced-3phase" : "all-approved",
      disablePreviousNavigation: meta.disablePreviousNavigation === true,
      timeLimitMinutes:
        Number.isInteger(Number(meta.timeLimitMinutes)) && Number(meta.timeLimitMinutes) > 0
          ? Number(meta.timeLimitMinutes)
          : undefined,
      // Quiz import keeps each question's original status so an approved quiz
      // comes back ready to schedule.
      newQuestions: rows.map((row) =>
        toSavePayload(row.question, row.granularId, { preserveStatus: true })
      ),
    });
  };

  return (
    <div className="rounded-2xl bg-white p-8 shadow-sm">
      <div className="mb-6 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-ink">Import a Quiz</h3>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
        >
          <i className="fas fa-arrow-left" /> Back
        </button>
      </div>

      <p className="mb-3 text-sm text-muted">
        Upload a GRASP quiz JSON export. Its settings are restored, and each question must be
        linked to one of this course's learning objectives.
      </p>
      <input
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

      {rows.length > 0 && (
        <div className="mt-6 space-y-4">
          <div>
            <label htmlFor="import-quiz-name" className="mb-1 block text-sm font-semibold text-ink">
              Quiz Name
            </label>
            <input
              id="import-quiz-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Quiz name"
              className={inputClass}
            />
          </div>

          <div className="rounded-lg bg-page px-4 py-3 text-sm text-muted">
            <i className="fas fa-sliders mr-1.5 text-primary" />
            Restored settings: {meta.timeLimitMinutes} min ·{" "}
            {meta.deliveryFormat === "spaced-3phase" ? "Spaced (3-phase)" : "All approved"}
            {meta.disablePreviousNavigation ? " · previous-question navigation disabled" : ""}.
            Availability is set per section after import.
          </div>

          <ImportQuestionReview
            rows={rows}
            granularGroups={granularGroups}
            flatGranularsEmpty={flatGranulars.length === 0}
            objectivesLoading={objectivesLoading}
            onChangeRow={setRowGranular}
          />
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={handleCreate}
          disabled={!canCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
        >
          {createMutation.isPending ? (
            <>
              <i className="fas fa-spinner fa-spin" /> Importing...
            </>
          ) : (
            <>
              <i className="fas fa-check" /> Import Quiz
            </>
          )}
        </button>
      </div>
    </div>
  );
}
