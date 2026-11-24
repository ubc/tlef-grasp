import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal, { ConfirmModal } from "../../components/ui/Modal";
import AutoHeightTextarea from "../../components/AutoHeightTextarea";
import { useToast } from "../../components/ui/Toast";
import { useInvalidateObjectives } from "../../hooks/useObjectives";
import { api } from "../../lib/api";
import { runPool } from "../../lib/async-pool";
import { pluralize } from "../../lib/lmsRosterSync";
import {
  countObjectives,
  describeGenerationError,
  draftFromGenerated,
  draftProblems,
  newGranular,
  newObjective,
  objectivePayloads,
} from "../../lib/transcriptObjectives";

// Each generation is one long LLM call; two at a time keeps a large import
// moving without queueing behind the provider's rate limit.
const GENERATION_CONCURRENCY = 2;

const btnSecondary =
  "rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-60";
const btnPrimary =
  "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60";
const btnSmall =
  "rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-ink hover:bg-gray-50";
const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none";

const generateFor = (course, video) =>
  api.post("/api/rag-llm/generate-transcript-objectives", {
    courseId: course.id,
    courseName: course.name,
    materialId: video.sourceId,
  });

// Learning objectives from imported Panopto transcripts (issue #218): one set
// per video, linked only to that video's transcript. Nothing is saved until
// Save, so the instructor can reword, remove and add first. With askFirst it
// opens on a yes/no question, as offered right after an import.
export default function TranscriptObjectivesModal({ course, videos, askFirst = false, onClose }) {
  const showToast = useToast();
  const navigate = useNavigate();
  const invalidateObjectives = useInvalidateObjectives(course?.id);
  const [started, setStarted] = useState(!askFirst);
  // { [sourceId]: { status, message?, draft?, usedOutline?, savedCount?, saveError? } }
  // status: waiting | generating | ready | not-relevant | failed | saving | saved
  const [entries, setEntries] = useState(() =>
    Object.fromEntries(videos.map((video) => [video.sourceId, { status: "waiting" }]))
  );
  const [problems, setProblems] = useState([]);
  const [confirmClose, setConfirmClose] = useState(false);
  // Results that land after the modal closed are dropped.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setEntry = (sourceId, update) => {
    if (!mounted.current) return;
    setEntries((current) => ({
      ...current,
      [sourceId]: { ...current[sourceId], ...(typeof update === "function" ? update(current[sourceId]) : update) },
    }));
  };

  const generate = async (video) => {
    setEntry(video.sourceId, { status: "generating", message: "", saveError: "" });
    try {
      const data = await generateFor(course, video);
      setEntry(video.sourceId, {
        status: "ready",
        draft: draftFromGenerated(data.objectives),
        usedOutline: !!data.usedOutline,
      });
    } catch (error) {
      const { kind, message } = describeGenerationError(error);
      setEntry(video.sourceId, { status: kind, message });
      // Hand a rate limit back to the pool so it slows down.
      if (error?.status === 429) throw Object.assign(new Error(message), { rateLimited: true });
    }
  };

  // Started once, when the instructor says yes (or straight away without
  // askFirst). Retries go through generate() directly.
  const startedRun = useRef(false);
  useEffect(() => {
    if (!started || startedRun.current) return;
    startedRun.current = true;
    runPool(
      videos.map((video) => () => generate(video)),
      { concurrency: GENERATION_CONCURRENCY, onRateLimit: () => 15000 }
    );
    // generate() reads only stable values; this runs once per modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  const updateDraft = (sourceId, updater) =>
    setEntry(sourceId, (entry) => ({ draft: updater(entry.draft || []) }));

  const updateObjective = (sourceId, key, updater) =>
    updateDraft(sourceId, (draft) => draft.map((objective) => (objective.key === key ? updater(objective) : objective)));

  const list = videos.map((video) => ({ video, entry: entries[video.sourceId] || { status: "waiting" } }));
  const generating = list.some(({ entry }) => entry.status === "waiting" || entry.status === "generating");
  const saving = list.some(({ entry }) => entry.status === "saving");
  const toSave = list.filter(({ entry }) => entry.status === "ready" && (entry.draft || []).length > 0);
  const unsavedCount = countObjectives(toSave.map(({ entry }) => entry.draft));
  const savedTotal = list.reduce((total, { entry }) => total + (entry.savedCount || 0), 0);
  const finished = started && !generating && !saving && unsavedCount === 0 && savedTotal > 0;

  const save = async () => {
    const found = toSave.flatMap(({ video, entry }) =>
      draftProblems(entry.draft).map((problem) =>
        videos.length > 1 ? `${video.documentTitle || "Video"}: ${problem}` : problem
      )
    );
    setProblems(found);
    if (found.length > 0) return;

    let savedNow = 0;
    let failedNow = 0;
    for (const { video, entry } of toSave) {
      setEntry(video.sourceId, { status: "saving", saveError: "" });
      const payloads = objectivePayloads(entry.draft, { courseId: course.id, materialId: video.sourceId });
      const left = [];
      let saved = 0;
      let lastError = "";
      // One at a time, in order, so the Question Bank lists them as the lecture ran.
      for (let index = 0; index < payloads.length; index += 1) {
        try {
          const result = await api.post("/api/objective", payloads[index]);
          if (!result?.success) throw new Error(result?.error || "Not saved");
          saved += 1;
        } catch (error) {
          left.push(entry.draft[index]);
          lastError = error?.message || "Not saved";
        }
      }
      savedNow += saved;
      failedNow += left.length;
      setEntry(video.sourceId, (current) => ({
        savedCount: (current.savedCount || 0) + saved,
        ...(left.length === 0
          ? { status: "saved", draft: [] }
          : {
              status: "ready",
              draft: left,
              saveError: `${pluralize(left.length, "objective")} could not be saved (${lastError}). Try again.`,
            }),
      }));
    }

    if (savedNow > 0) invalidateObjectives();
    if (failedNow > 0) {
      showToast(
        `${pluralize(savedNow, "learning objective")} saved; ${pluralize(failedNow, "objective")} could not be saved.`,
        savedNow > 0 ? "warning" : "error"
      );
    } else if (savedNow > 0) {
      showToast(`Saved ${pluralize(savedNow, "learning objective")}`, "success");
    }
  };

  // Leaving drops whatever has not been saved, including a run still going.
  const requestClose = () => {
    if (saving) return;
    if (started && (generating || unsavedCount > 0)) setConfirmClose(true);
    else onClose();
  };

  const title = videos.length === 1 ? "Create learning objectives" : "Create learning objectives from videos";

  let footer;
  if (!started) {
    footer = (
      <>
        <button key="not-now" type="button" onClick={onClose} className={btnSecondary}>
          Not now
        </button>
        <button key="start" type="button" onClick={() => setStarted(true)} className={btnPrimary}>
          <i className="fas fa-magic" aria-hidden="true" /> Create learning objectives
        </button>
      </>
    );
  } else if (finished) {
    footer = (
      <>
        <button key="done" type="button" onClick={onClose} className={btnSecondary}>
          Done
        </button>
        <button
          key="to-question-generation"
          type="button"
          onClick={() => {
            onClose();
            navigate("/question-generation");
          }}
          className={btnPrimary}
        >
          Make questions from them
        </button>
      </>
    );
  } else {
    footer = (
      <>
        {/* Keyed so React never reuses the clicked "Create" button, focus and
            all, as Discard. */}
        <span key="status" className="mr-auto self-center text-sm text-muted" aria-live="polite">
          {generating
            ? "Reading the transcripts. This can take a minute per video."
            : savedTotal > 0
              ? `${pluralize(savedTotal, "learning objective")} saved so far.`
              : ""}
        </span>
        <button key="discard" type="button" onClick={requestClose} disabled={saving} className={btnSecondary}>
          {unsavedCount > 0 || generating ? "Discard" : "Close"}
        </button>
        <button
          key="save"
          type="button"
          onClick={save}
          disabled={generating || saving || unsavedCount === 0}
          className={btnPrimary}
        >
          {saving ? (
            <>
              <i className="fas fa-spinner fa-spin" aria-hidden="true" /> Saving...
            </>
          ) : unsavedCount > 0 ? (
            `Save ${pluralize(unsavedCount, "objective")}`
          ) : (
            "Save"
          )}
        </button>
      </>
    );
  }

  return (
    <>
      <Modal open onClose={requestClose} title={title} wide footer={footer}>
        {!started ? (
          <div>
            <p className="text-ink">
              {videos.length === 1
                ? "GRASP can read this video's transcript and write learning objectives from what the lecture teaches."
                : "GRASP can read these videos' transcripts and write learning objectives from what each lecture teaches."}{" "}
              You can edit them before anything is saved.
            </p>
            <ul className="mt-3 space-y-1 text-sm text-ink">
              {videos.map((video) => (
                <li key={video.sourceId} className="flex items-center gap-2">
                  <i className="fas fa-video text-purple-600" aria-hidden="true" />
                  <span className="truncate">{video.documentTitle || "Panopto video"}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-6">
            <p className="text-sm text-muted">
              Each video gets its own objectives, linked to its transcript. Reword them, remove what you don't want,
              or add your own. Bloom levels and question counts can be changed later on the Question Generation page.
            </p>
            {problems.length > 0 && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <p className="font-semibold">Fix these before saving:</p>
                <ul className="mt-1 list-disc pl-5">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            )}
            {list.map(({ video, entry }) => (
              <VideoSection
                key={video.sourceId}
                video={video}
                entry={entry}
                onRetry={() => generate(video).catch(() => {})}
                onUpdateObjective={(key, updater) => updateObjective(video.sourceId, key, updater)}
                onRemoveObjective={(key) =>
                  updateDraft(video.sourceId, (draft) => draft.filter((objective) => objective.key !== key))
                }
                onAddObjective={() => updateDraft(video.sourceId, (draft) => [...draft, newObjective()])}
              />
            ))}
          </div>
        )}
      </Modal>
      <ConfirmModal
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={onClose}
        title="Discard these objectives?"
        message={
          generating
            ? "Objectives still being written, and any you have not saved, will be lost."
            : `${pluralize(unsavedCount, "objective")} you have not saved will be lost.`
        }
        confirmLabel="Discard"
        danger
      />
    </>
  );
}

const STATUS_LABELS = {
  waiting: { text: "Waiting", className: "bg-gray-100 text-muted" },
  generating: { text: "Reading transcript", className: "bg-sky-100 text-sky-800" },
  ready: { text: "Ready to review", className: "bg-indigo-100 text-indigo-800" },
  saving: { text: "Saving", className: "bg-indigo-100 text-indigo-800" },
  saved: { text: "Saved", className: "bg-green-100 text-green-800" },
  "not-relevant": { text: "No objectives", className: "bg-amber-100 text-amber-900" },
  failed: { text: "Failed", className: "bg-red-100 text-red-800" },
};

function VideoSection({ video, entry, onRetry, onUpdateObjective, onRemoveObjective, onAddObjective }) {
  const title = video.documentTitle || "Panopto video";
  const label = STATUS_LABELS[entry.status] || STATUS_LABELS.waiting;
  const editable = entry.status === "ready";

  return (
    <section aria-label={title} className="rounded-xl border border-gray-200 p-4">
      <div className="mb-3 flex items-center gap-3">
        <i className="fas fa-video text-purple-600" aria-hidden="true" />
        <h4 className="min-w-0 flex-1 truncate font-semibold text-ink" title={title}>
          {title}
        </h4>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${label.className}`}>
          {label.text}
        </span>
      </div>

      {(entry.status === "waiting" || entry.status === "generating") && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <i className="fas fa-spinner fa-spin text-primary" aria-hidden="true" />
          {entry.status === "waiting" ? "Waiting for the videos ahead of it." : "Reading the transcript and writing objectives..."}
        </p>
      )}

      {(entry.status === "failed" || entry.status === "not-relevant") && (
        <div
          className={`flex items-start justify-between gap-3 rounded-lg p-3 text-sm ${
            entry.status === "failed" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-950"
          }`}
        >
          <p>{entry.message}</p>
          <button type="button" onClick={onRetry} className={`${btnSmall} shrink-0`}>
            Try again
          </button>
        </div>
      )}

      {entry.status === "saved" && (
        <p className="text-sm text-green-800">
          <i className="fas fa-check-circle mr-1.5" aria-hidden="true" />
          Saved {pluralize(entry.savedCount || 0, "learning objective")}.
        </p>
      )}

      {(editable || entry.status === "saving") && (
        <fieldset disabled={!editable} className="space-y-3">
          {entry.usedOutline && (
            <p className="text-xs text-muted">
              This recording is long, so the objectives were written from its outline instead of the whole transcript.
            </p>
          )}
          {entry.saveError && (
            <p role="alert" className="text-sm text-red-700">
              {entry.saveError}
            </p>
          )}
          {(entry.draft || []).length === 0 && (
            <p className="text-sm text-muted">No objectives left for this video. Nothing will be saved for it.</p>
          )}
          {(entry.draft || []).map((objective, index) => (
            <ObjectiveEditor
              key={objective.key}
              objective={objective}
              number={index + 1}
              onChange={(updater) => onUpdateObjective(objective.key, updater)}
              onRemove={() => onRemoveObjective(objective.key)}
            />
          ))}
          <button type="button" onClick={onAddObjective} className={btnSmall}>
            <i className="fas fa-plus mr-1" aria-hidden="true" /> Add objective
          </button>
        </fieldset>
      )}
    </section>
  );
}

function ObjectiveEditor({ objective, number, onChange, onRemove }) {
  const name = objective.name.trim() || `Objective ${number}`;
  const setGranular = (key, text) =>
    onChange((current) => ({
      ...current,
      granulars: current.granulars.map((granular) => (granular.key === key ? { ...granular, text } : granular)),
    }));

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={objective.name}
          aria-label={`Name of objective ${number}`}
          placeholder="Learning objective"
          onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
          className={`${inputClass} font-semibold`}
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove objective "${name}"`}
          title="Remove objective"
          className="p-2 text-red-500 hover:text-red-700"
        >
          <i className="fas fa-trash-alt" aria-hidden="true" />
        </button>
      </div>
      <ul className="mt-2 space-y-2 pl-4">
        {objective.granulars.map((granular, index) => (
          <li key={granular.key} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <AutoHeightTextarea
                value={granular.text}
                rows={1}
                aria-label={`Sub-objective ${index + 1} of "${name}"`}
                placeholder="Sub-objective, starting with a verb"
                onChange={(event) => setGranular(granular.key, event.target.value)}
                className={`${inputClass} resize-y bg-white`}
              />
              {granular.bloomTaxonomies.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {granular.bloomTaxonomies.map((level) => (
                    <span key={level} className="rounded bg-white px-1.5 py-0.5 text-[11px] text-muted ring-1 ring-gray-200">
                      {level}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() =>
                onChange((current) => ({
                  ...current,
                  granulars: current.granulars.filter((item) => item.key !== granular.key),
                }))
              }
              aria-label={`Remove sub-objective ${index + 1} of "${name}"`}
              title="Remove sub-objective"
              className="p-2 text-muted hover:text-red-700"
            >
              <i className="fas fa-times" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onChange((current) => ({ ...current, granulars: [...current.granulars, newGranular()] }))}
        className={`${btnSmall} ml-4 mt-2`}
      >
        <i className="fas fa-plus mr-1" aria-hidden="true" /> Add sub-objective
      </button>
    </div>
  );
}
