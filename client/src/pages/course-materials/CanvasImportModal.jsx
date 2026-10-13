import { useId, useMemo, useState } from "react";
import Modal from "../../components/ui/Modal";
import { LoadingRow } from "../../components/ui/states";
import { useCanvasCourseFiles } from "../../hooks/useCanvasMaterialImport";
import {
  canvasCourseLabel,
  canvasFileNote,
  canvasFileSelectable,
  filterCanvasFiles,
} from "../../lib/canvasMaterialImport";
import { formatDate, formatFileSize } from "../../lib/format";
import { getMaterialTypeMeta } from "../../lib/materials";
import { pluralize } from "../../lib/lmsRosterSync";

const KIND_LABELS = { pdf: "PDF", docx: "Word", pptx: "PowerPoint", txt: "Text" };

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none";
const btnSecondary =
  "rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-60";
const btnPrimary =
  "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60";

const STATUS_ICONS = {
  importing: "fa-spinner fa-spin text-primary",
  imported: "fa-check-circle text-green-600",
  failed: "fa-exclamation-circle text-danger",
};

// Picker for importing Canvas course files into Course Materials (issue #141).
// Mount it only while open: the selection and per-file progress live here.
export default function CanvasImportModal({ courseId, courses, importing, onImport, onClose }) {
  const [canvasCourseId, setCanvasCourseId] = useState(courses[0]?.id || "");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  // { [fileId]: { status: "importing" | "imported" | "failed", message? } }
  const [progress, setProgress] = useState({});
  // How many files the running import was started with.
  const [batchSize, setBatchSize] = useState(0);
  const courseFieldId = useId();
  const searchFieldId = useId();

  const { files, maxFileBytes, isPending, isFetching, error } = useCanvasCourseFiles(
    courseId,
    canvasCourseId
  );

  const canvasCourse = courses.find((course) => course.id === canvasCourseId);
  const visibleFiles = useMemo(() => filterCanvasFiles(files, search), [files, search]);
  const selectableVisible = visibleFiles.filter(canvasFileSelectable);
  const chosen = files.filter((file) => selected.has(file.id) && canvasFileSelectable(file));
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((file) => selected.has(file.id));

  const toggle = (fileId) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });

  const toggleAllVisible = () =>
    setSelected((current) => {
      const next = new Set(current);
      for (const file of selectableVisible) {
        if (allVisibleSelected) next.delete(file.id);
        else next.add(file.id);
      }
      return next;
    });

  const changeCourse = (id) => {
    setCanvasCourseId(id);
    setSelected(new Set());
    setProgress({});
    setSearch("");
  };

  const startImport = () => {
    setProgress({});
    setBatchSize(chosen.length);
    onImport(canvasCourseId, chosen, (fileId, status, message) => {
      setProgress((current) => ({ ...current, [fileId]: { status, message } }));
      // A file that made it in needs no second try; a failed one stays picked.
      if (status === "imported") {
        setSelected((current) => {
          const next = new Set(current);
          next.delete(fileId);
          return next;
        });
      }
    });
  };

  const done = Object.values(progress).filter((entry) => entry.status !== "importing").length;

  return (
    <Modal
      open
      onClose={importing ? undefined : onClose}
      title="Import from Canvas"
      wide
      footer={
        <>
          <span className="mr-auto self-center text-sm text-muted" aria-live="polite">
            {importing
              ? `Importing ${Math.min(done + 1, batchSize)} of ${batchSize}. This can take a minute per file.`
              : chosen.length > 0
                ? `${pluralize(chosen.length, "file")} selected`
                : ""}
          </span>
          <button type="button" onClick={onClose} disabled={importing} className={btnSecondary}>
            Close
          </button>
          <button
            type="button"
            onClick={startImport}
            disabled={importing || chosen.length === 0}
            className={btnPrimary}
          >
            {importing
              ? "Importing..."
              : chosen.length > 0
                ? `Import ${pluralize(chosen.length, "file")}`
                : "Import"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {courses.length > 1 ? (
          <div>
            <label htmlFor={courseFieldId} className="mb-1 block text-sm font-semibold text-ink">
              Canvas course
            </label>
            <select
              id={courseFieldId}
              value={canvasCourseId}
              disabled={importing}
              onChange={(event) => changeCourse(event.target.value)}
              className={inputClass}
            >
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {canvasCourseLabel(course)}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Files from the Canvas course{" "}
            <span className="font-semibold text-ink">{canvasCourseLabel(canvasCourse)}</span>,
            which your section is linked to.
          </p>
        )}

        <div>
          <label htmlFor={searchFieldId} className="sr-only">
            Search files by name
          </label>
          <input
            id={searchFieldId}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search files by name..."
            className={inputClass}
          />
        </div>

        {isPending ? (
          <LoadingRow label="Loading files from Canvas..." />
        ) : error ? (
          <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-ink">
            <p>{error.message || "Could not load files from Canvas."}</p>
            {error.body?.connected === false && (
              <a
                href="/settings?canvas=connect"
                className="mt-2 inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
              >
                <i className="fas fa-plug" aria-hidden="true" /> Reconnect Canvas in Settings
              </a>
            )}
          </div>
        ) : files.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-muted">
            This Canvas course has no PDF, Word, PowerPoint or text files.
          </p>
        ) : (
          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <label className="inline-flex items-center gap-2 font-medium text-ink">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={importing || selectableVisible.length === 0}
                  onChange={toggleAllVisible}
                  className="h-4 w-4 accent-primary"
                />
                Select all
              </label>
              <span className="text-muted">
                {isFetching ? "Refreshing..." : `${pluralize(visibleFiles.length, "file")}, newest first`}
              </span>
            </div>

            {visibleFiles.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-muted">
                No files match &ldquo;{search.trim()}&rdquo;.
              </p>
            ) : (
              <ul className="max-h-[45vh] divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
                {visibleFiles.map((file) => {
                  const selectable = canvasFileSelectable(file);
                  const meta = getMaterialTypeMeta(file.mimeType);
                  const state = progress[file.id];
                  const note = state?.status === "failed" ? state.message : canvasFileNote(file, maxFileBytes);
                  return (
                    <li key={file.id}>
                      <label
                        className={`flex items-start gap-3 px-3 py-2.5 ${
                          selectable && !importing ? "cursor-pointer hover:bg-gray-50" : ""
                        } ${selectable ? "" : "bg-gray-50"}`}
                      >
                        <input
                          type="checkbox"
                          checked={selectable && selected.has(file.id)}
                          disabled={!selectable || importing}
                          onChange={() => toggle(file.id)}
                          className="mt-1 h-4 w-4 shrink-0 accent-primary"
                        />
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.badgeClasses}`}
                          aria-hidden="true"
                        >
                          <i className={`fas ${meta.icon}`} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate font-medium ${selectable ? "text-ink" : "text-muted"}`} title={file.name}>
                            {file.name}
                          </span>
                          <span className="block text-xs text-muted">
                            {[
                              KIND_LABELS[file.kind],
                              file.size ? formatFileSize(file.size) : "",
                              file.updatedAt ? `Updated ${formatDate(file.updatedAt)}` : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          {note && (
                            <span
                              className={`mt-0.5 block text-xs ${
                                state?.status === "failed" ? "text-danger" : "text-muted"
                              }`}
                            >
                              {note}
                            </span>
                          )}
                        </span>
                        {state && (
                          <i
                            className={`fas ${STATUS_ICONS[state.status]} mt-1 shrink-0`}
                            role="img"
                            aria-label={state.status}
                          />
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
