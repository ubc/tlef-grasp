import { useEffect, useId, useMemo, useState } from "react";
import Modal from "../../components/ui/Modal";
import { LoadingRow } from "../../components/ui/states";
import { usePanoptoFolderSessions, usePanoptoFolders } from "../../hooks/usePanopto";
import { filterCanvasFiles } from "../../lib/canvasMaterialImport";
import { formatDate } from "../../lib/format";
import { pluralize } from "../../lib/lmsRosterSync";
import {
  formatDuration,
  panoptoConnectUrl,
  panoptoFolderLabel,
  panoptoSessionNote,
  panoptoSessionSelectable,
} from "../../lib/panoptoImport";

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

// Coming back here after connecting reopens this picker.
const RETURN_TO = "/course-materials?panopto=import";

// Picker for importing Panopto videos' captions into Course Materials. Mount
// it only while open: the selection and per-video progress live here.
export default function PanoptoImportModal({ courseId, status, importing, onImport, onClose }) {
  const connected = status.connected;
  const [folderId, setFolderId] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  // { [sessionId]: { status: "importing" | "imported" | "failed", message? } }
  const [progress, setProgress] = useState({});
  // How many videos the running import was started with.
  const [batchSize, setBatchSize] = useState(0);
  const folderFieldId = useId();
  const searchFieldId = useId();

  const folders = usePanoptoFolders({ enabled: connected });
  const sessions = usePanoptoFolderSessions(courseId, connected ? folderId : "");

  // Start on the first folder once they arrive.
  useEffect(() => {
    if (!folderId && folders.folders.length > 0) setFolderId(folders.folders[0].id);
  }, [folderId, folders.folders]);

  const visible = useMemo(() => filterCanvasFiles(sessions.sessions, search), [sessions.sessions, search]);
  const selectableVisible = visible.filter(panoptoSessionSelectable);
  const chosen = sessions.sessions.filter(
    (session) => selected.has(session.id) && panoptoSessionSelectable(session)
  );
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((session) => selected.has(session.id));

  const toggle = (sessionId) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });

  const toggleAllVisible = () =>
    setSelected((current) => {
      const next = new Set(current);
      for (const session of selectableVisible) {
        if (allVisibleSelected) next.delete(session.id);
        else next.add(session.id);
      }
      return next;
    });

  const changeFolder = (id) => {
    setFolderId(id);
    setSelected(new Set());
    setProgress({});
    setSearch("");
  };

  const startImport = () => {
    setProgress({});
    setBatchSize(chosen.length);
    onImport(chosen, (sessionId, state, message) => {
      setProgress((current) => ({ ...current, [sessionId]: { status: state, message } }));
      // A video that made it in needs no second try; a failed one stays picked.
      if (state === "imported") {
        setSelected((current) => {
          const next = new Set(current);
          next.delete(sessionId);
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
      title="Import from Panopto"
      wide
      footer={
        <>
          <span className="mr-auto self-center text-sm text-muted" aria-live="polite">
            {importing
              ? `Importing ${Math.min(done + 1, batchSize)} of ${batchSize}. This can take a minute per video.`
              : chosen.length > 0
                ? `${pluralize(chosen.length, "video")} selected`
                : ""}
          </span>
          <button type="button" onClick={onClose} disabled={importing} className={btnSecondary}>
            Close
          </button>
          {connected && (
            <button
              type="button"
              onClick={startImport}
              disabled={importing || chosen.length === 0}
              className={btnPrimary}
            >
              {importing
                ? "Importing..."
                : chosen.length > 0
                  ? `Import ${pluralize(chosen.length, "video")}`
                  : "Import"}
            </button>
          )}
        </>
      }
    >
      {status.isPending ? (
        <LoadingRow label="Checking your Panopto connection..." />
      ) : status.isError ? (
        <ErrorBox message={status.error?.message || "Panopto is unavailable right now."} />
      ) : !connected ? (
        <div className="space-y-4 py-2">
          <p className="text-sm text-ink">
            Connect your UBC Panopto account to import your videos&rsquo; captions. GRASP
            adds each video&rsquo;s captions to this course as a text material, which
            question generation can then draw on.
          </p>
          <a
            href={panoptoConnectUrl(RETURN_TO)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
          >
            <i className="fas fa-link" aria-hidden="true" /> Connect Panopto
          </a>
        </div>
      ) : folders.isPending ? (
        <LoadingRow label="Loading your Panopto folders..." />
      ) : folders.error ? (
        <ErrorBox message={folders.error.message || "Could not load your Panopto folders."} />
      ) : folders.folders.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-muted">
          Your Panopto account has no folders you create videos in.
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            GRASP imports each video&rsquo;s captions as text. Videos stay in Panopto.
          </p>
          <div>
            <label htmlFor={folderFieldId} className="mb-1 block text-sm font-semibold text-ink">
              Panopto folder
            </label>
            <select
              id={folderFieldId}
              value={folderId}
              disabled={importing}
              onChange={(event) => changeFolder(event.target.value)}
              className={inputClass}
            >
              {folders.folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {panoptoFolderLabel(folder)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={searchFieldId} className="sr-only">
              Search videos by name
            </label>
            <input
              id={searchFieldId}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search videos by name..."
              className={inputClass}
            />
          </div>

          {sessions.isPending ? (
            <LoadingRow label="Loading videos from Panopto..." />
          ) : sessions.error ? (
            <ErrorBox message={sessions.error.message || "Could not load this folder's videos."} />
          ) : sessions.sessions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-muted">
              This folder has no videos.
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
                  {sessions.isFetching ? "Refreshing..." : `${pluralize(visible.length, "video")}, newest first`}
                </span>
              </div>

              {visible.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-muted">
                  No videos match &ldquo;{search.trim()}&rdquo;.
                </p>
              ) : (
                <ul className="max-h-[45vh] divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
                  {visible.map((session) => {
                    const selectable = panoptoSessionSelectable(session);
                    const state = progress[session.id];
                    const note = state?.status === "failed" ? state.message : panoptoSessionNote(session);
                    return (
                      <li key={session.id}>
                        <label
                          className={`flex items-start gap-3 px-3 py-2.5 ${
                            selectable && !importing ? "cursor-pointer hover:bg-gray-50" : ""
                          } ${selectable ? "" : "bg-gray-50"}`}
                        >
                          <input
                            type="checkbox"
                            checked={selectable && selected.has(session.id)}
                            disabled={!selectable || importing}
                            onChange={() => toggle(session.id)}
                            className="mt-1 h-4 w-4 shrink-0 accent-primary"
                          />
                          <span
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-100 text-purple-600"
                            aria-hidden="true"
                          >
                            <i className="fas fa-video" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              className={`block truncate font-medium ${selectable ? "text-ink" : "text-muted"}`}
                              title={session.name}
                            >
                              {session.name || "Untitled video"}
                            </span>
                            <span className="block text-xs text-muted">
                              {[
                                session.startTime ? formatDate(session.startTime) : "",
                                formatDuration(session.durationSeconds),
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
      )}
    </Modal>
  );
}

function ErrorBox({ message }) {
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-ink">
      {message}
    </div>
  );
}
