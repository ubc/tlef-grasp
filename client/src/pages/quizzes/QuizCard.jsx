import { useEffect, useMemo, useRef, useState } from "react";
import { toDatetimeLocal, formatDate } from "../../lib/format";
import DeliveryFormatToggle from "../../components/DeliveryFormatToggle";
import Modal from "../../components/ui/Modal";
import MultiSelect from "../../components/ui/MultiSelect";
import CanvasAssignmentPromptModal from "../../components/lms/CanvasAssignmentPromptModal";
import {
  applyScheduleWindow,
  localToIso,
  scheduleStatus,
  schedulesWithout,
  sectionPickerOptions,
} from "./schedulePayload";
import { useQuizSchedules, useUpdateQuizSchedules } from "../../hooks/useQuizzes";
import {
  useDeclineQuizCanvasAssignments,
  useEnsureQuizCanvasAssignments,
  useQuizCanvasAssignments,
} from "../../hooks/useCanvasAssignments";
import {
  canvasAssignmentsEnabled,
  canvasChipState,
  describeEnsureResults,
  partitionAfterSave,
  promptItemsForSections,
} from "../../lib/canvasAssignments";
import { useToast } from "../../components/ui/Toast";

// Set a release/expire window: on one section when editing, on any number of
// them when scheduling (instructors run the same window across 002, 005, ...).
function ScheduleModal({ open, mode, section, options, initial, onClose, onSave, onRemove, saving }) {
  const [courseSectionIds, setCourseSectionIds] = useState([]);
  const [releaseDate, setReleaseDate] = useState("");
  const [expireDate, setExpireDate] = useState("");

  useEffect(() => {
    if (!open) return;
    setCourseSectionIds(mode === "edit" && section ? [section.courseSectionId] : []);
    setReleaseDate(initial?.releaseDate ? toDatetimeLocal(initial.releaseDate) : "");
    setExpireDate(initial?.expireDate ? toDatetimeLocal(initial.expireDate) : "");
  }, [open, mode, section, initial]);

  const valid =
    courseSectionIds.length > 0 &&
    releaseDate &&
    expireDate &&
    new Date(expireDate) > new Date(releaseDate);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "edit" ? "Edit section schedule" : "Schedule sections"}
      footer={
        <>
          {mode === "edit" && (
            <button
              type="button"
              onClick={onRemove}
              disabled={saving}
              className="mr-auto rounded-lg border border-danger/40 bg-white px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-60"
            >
              Remove
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave({ courseSectionIds, releaseDate, expireDate })}
            disabled={!valid || saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-semibold text-ink">
            {mode === "edit" ? "Section" : "Sections"}
          </label>
          {mode === "edit" ? (
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-ink">
              {section?.label}
            </div>
          ) : (
            <>
              <MultiSelect
                value={courseSectionIds}
                onChange={setCourseSectionIds}
                options={options}
                placeholder="Select sections…"
                searchPlaceholder="Search sections…"
                selectAllLabel="All my sections"
              />
              <p className="mt-1 text-xs text-muted">
                The dates below apply to every section you pick. Picking one marked
                “Scheduled” replaces its current window.
              </p>
            </>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold text-ink">Release date</label>
          <input
            type="datetime-local"
            value={releaseDate}
            onChange={(event) => setReleaseDate(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold text-ink">Expire date</label>
          <input
            type="datetime-local"
            value={expireDate}
            onChange={(event) => setExpireDate(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
          {releaseDate && expireDate && new Date(expireDate) <= new Date(releaseDate) && (
            <p className="mt-1 text-xs text-danger">Expire date must be after the release date.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function SectionSchedule({ courseId, quizId, sections, canvas }) {
  const showToast = useToast();
  const { schedules } = useQuizSchedules(quizId);
  const [modal, setModal] = useState(null); // null | { mode, courseSectionId? }
  // The "Create in Canvas?" question on screen: which sections, and whether a
  // "no" is remembered (after a schedule save) or is just a cancel (the chip).
  const [canvasPrompt, setCanvasPrompt] = useState(null); // null | { sections, remember }
  // The sections of the save in flight, for the Canvas follow-up once it lands.
  const lastSavedRef = useRef([]);

  // courseSectionId -> human label
  const labelFor = useMemo(() => {
    const map = new Map();
    for (const s of sections) map.set(s._id, s.sectionNumber || s.sectionId);
    return (id) => map.get(id) || "Unknown section";
  }, [sections]);

  // Canvas assignments (issue #125): one per quiz per linked section, created
  // after the instructor says yes, and kept at the section's close time.
  const canvasOn = canvasAssignmentsEnabled(canvas);
  const assignmentsQuery = useQuizCanvasAssignments(courseId, quizId, { enabled: canvasOn });
  const canvasBySection = useMemo(
    () => new Map(assignmentsQuery.sections.map((s) => [s.courseSectionId, s])),
    [assignmentsQuery.sections]
  );
  const ensureMutation = useEnsureQuizCanvasAssignments(courseId, quizId, {
    onSuccess: (data) => {
      const { message, type } = describeEnsureResults(data.results, labelFor);
      if (message) showToast(message, type);
    },
    onError: (error) =>
      showToast(error.message || "Canvas could not be updated. Please try again.", "error"),
  });
  const declineMutation = useDeclineQuizCanvasAssignments(courseId, quizId, {
    onError: (error) => showToast(error.message || "Could not save your choice.", "error"),
  });

  // Rescheduling moves the Canvas due date on its own; a newly scheduled linked
  // section is asked about first. The GRASP save has already succeeded either
  // way, so a Canvas failure only warns and leaves a retry on the chip.
  const followUpInCanvas = async (savedSectionIds) => {
    if (!canvasOn || savedSectionIds.length === 0) return;
    const { data } = await assignmentsQuery.refetch();
    const { sync, prompt } = partitionAfterSave(data?.sections || [], savedSectionIds);
    if (sync.length > 0) ensureMutation.mutate(sync);
    if (prompt.length > 0) setCanvasPrompt({ sections: prompt, remember: true });
  };

  // The chip's "Canvas" button asks first too: nothing is created in Canvas
  // without the instructor seeing what and when.
  const offerFromChip = (courseSectionId) => {
    const section = canvasBySection.get(courseSectionId);
    if (section) setCanvasPrompt({ sections: [section], remember: false });
  };

  const updateMutation = useUpdateQuizSchedules(courseId, quizId, {
    onSuccess: () => {
      showToast("Schedule saved", "success");
      setModal(null);
      followUpInCanvas(lastSavedRef.current);
    },
    onError: (error) => showToast(error.message || "Failed to save schedule", "error"),
  });

  // `sections` are the ones this instructor owns; only those sections' schedules
  // are theirs to view and edit. Other instructors' schedules are left alone.
  const ownedIds = useMemo(() => new Set(sections.map((s) => s._id)), [sections]);
  const mySchedules = useMemo(
    () => schedules.filter((s) => ownedIds.has(s.courseSectionId)),
    [schedules, ownedIds]
  );

  const now = new Date();
  // Every owned section is offered, already-scheduled ones included, so a single
  // save can put the same window on all of them.
  const pickerOptions = sectionPickerOptions(sections, mySchedules);

  const handleSave = ({ courseSectionIds, releaseDate, expireDate }) => {
    lastSavedRef.current = courseSectionIds;
    updateMutation.mutate(
      applyScheduleWindow(mySchedules, {
        courseSectionIds,
        releaseDate: localToIso(releaseDate),
        expireDate: localToIso(expireDate),
      })
    );
  };

  // Unscheduling never touches Canvas: the assignment stays there.
  const handleRemove = (courseSectionId) => {
    lastSavedRef.current = [];
    updateMutation.mutate(schedulesWithout(mySchedules, [courseSectionId]));
  };

  const promptIds = (canvasPrompt?.sections || []).map((s) => s.courseSectionId);

  const editing =
    modal?.mode === "edit"
      ? mySchedules.find((s) => s.courseSectionId === modal.courseSectionId)
      : null;

  return (
    <div className="my-5 border-y border-gray-200 py-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-ink">
          <i className="fas fa-calendar-alt mr-1.5 text-primary" />
          Section schedule
        </span>
        <button
          type="button"
          onClick={() => setModal({ mode: "create" })}
          disabled={sections.length === 0}
          title={
            sections.length === 0
              ? "Add sections to this course first"
              : "Schedule one or more sections"
          }
          className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <i className="fas fa-plus mr-1" />
          Schedule
        </button>
      </div>

      {sections.length === 0 ? (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          You have no sections in this course yet. Add sections under My Sections —
          until one is scheduled, this quiz is visible to no one in your sections.
        </p>
      ) : mySchedules.length === 0 ? (
        <p className="text-xs text-muted">
          Not scheduled for any section — visible to no one.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {mySchedules.map((row) => {
            const status = scheduleStatus(row, now);
            const chip = canvasOn ? canvasChipState(canvasBySection.get(row.courseSectionId)) : null;
            const label = labelFor(row.courseSectionId);
            return (
              <div key={row.courseSectionId} className="flex items-stretch gap-1">
                <button
                  type="button"
                  onClick={() => setModal({ mode: "edit", courseSectionId: row.courseSectionId })}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs transition-colors hover:border-primary hover:bg-primary/5"
                >
                  <span className="font-semibold text-ink">{label}</span>
                  <span className={`rounded-full px-2 py-0.5 font-medium ${status.cls}`}>
                    {status.label}
                  </span>
                </button>
                {chip && (
                  <CanvasChip
                    chip={chip}
                    label={label}
                    busy={ensureMutation.isPending}
                    onCreate={() => offerFromChip(row.courseSectionId)}
                    onRetry={() => ensureMutation.mutate([row.courseSectionId])}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <CanvasAssignmentPromptModal
        open={!!canvasPrompt}
        items={promptItemsForSections(canvasPrompt?.sections)}
        busy={ensureMutation.isPending || declineMutation.isPending}
        onClose={() => setCanvasPrompt(null)}
        onCreate={() => {
          setCanvasPrompt(null);
          ensureMutation.mutate(promptIds);
        }}
        onDecline={
          canvasPrompt?.remember
            ? () => {
                setCanvasPrompt(null);
                declineMutation.mutate(promptIds);
              }
            : undefined
        }
      />

      <ScheduleModal
        open={!!modal}
        mode={modal?.mode}
        section={
          editing
            ? { courseSectionId: editing.courseSectionId, label: labelFor(editing.courseSectionId) }
            : null
        }
        options={pickerOptions}
        initial={editing}
        saving={updateMutation.isPending}
        onClose={() => setModal(null)}
        onSave={handleSave}
        onRemove={editing ? () => handleRemove(editing.courseSectionId) : undefined}
      />
    </div>
  );
}

// Beside a schedule chip: the Canvas assignment, a retry, or an offer to create
// one. Never a button inside the chip button (nested buttons are invalid HTML).
// `onCreate` opens the confirmation; `onRetry` re-syncs an existing assignment.
function CanvasChip({ chip, label, busy, onCreate, onRetry }) {
  const base =
    "inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs transition-colors";
  if (chip.kind === "created") {
    const content = (
      <>
        <i className="fas fa-graduation-cap" aria-hidden="true" />
        <span>Canvas</span>
      </>
    );
    return chip.href ? (
      <a
        href={chip.href}
        target="_blank"
        rel="noreferrer"
        title={chip.title}
        aria-label={`Canvas assignment for section ${label}`}
        className={`${base} border-success/40 text-success hover:bg-success/10`}
      >
        {content}
      </a>
    ) : (
      <span title={chip.title} aria-label={`Canvas assignment for section ${label}`} className={`${base} border-success/40 text-success`}>
        {content}
      </span>
    );
  }
  if (chip.kind === "failed") {
    return (
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        title={chip.title}
        aria-label={`Retry Canvas update for section ${label}`}
        className={`${base} border-warning/50 text-warning hover:bg-warning/10 disabled:opacity-60`}
      >
        <i className="fas fa-triangle-exclamation" aria-hidden="true" />
        <span>Retry Canvas</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onCreate}
      disabled={busy}
      title="Create a Canvas assignment for this section"
      aria-label={`Create in Canvas for section ${label}`}
      className={`${base} border-dashed border-gray-300 text-muted hover:border-primary hover:text-primary disabled:opacity-60`}
    >
      <i className="fas fa-plus" aria-hidden="true" />
      <span>Canvas</span>
    </button>
  );
}

export default function QuizCard({ quiz, courseId, sections = [], canvas, selected = false, onToggleSelect, onUpdate, onReview, onExport, onDelete }) {
  const totalQuestions = quiz.questions.length;
  const approvedQuestions = quiz.questions.filter(
    (q) => q.status === "Approved"
  ).length;
  const progress = totalQuestions > 0 ? (approvedQuestions / totalQuestions) * 100 : 0;
  const deliveryFormat =
    quiz.deliveryFormat === "spaced-3phase" ? "spaced-3phase" : "all-approved";
  const disablePreviousNavigation = quiz.disablePreviousNavigation === true;
  const timeLimitMinutes = Number.isInteger(Number(quiz.timeLimitMinutes)) && Number(quiz.timeLimitMinutes) > 0
    ? Number(quiz.timeLimitMinutes)
    : 60;

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(quiz.id)}
            aria-label={`Select ${quiz.name}`}
            className="mt-1.5 h-4 w-4 accent-primary"
          />
        )}
        <div>
          <h3 className="text-lg font-semibold text-ink">{quiz.name}</h3>
          <div className="text-xs text-muted">Created: {formatDate(quiz.createdAt)}</div>
        </div>
      </div>

      <div className="mb-4">
        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-success transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-1 text-xs text-muted">{Math.round(progress)}% Approved</div>
      </div>

      <SectionSchedule courseId={courseId} quizId={quiz.id} sections={sections} canvas={canvas} />

      <div className="mb-5">
        <label className="mb-1 block text-xs font-semibold text-muted">
          Delivery Format
        </label>
        <DeliveryFormatToggle
          value={deliveryFormat}
          onChange={(value) => {
            if (value !== deliveryFormat) {
              onUpdate(quiz.id, { deliveryFormat: value }, "Delivery format updated");
            }
          }}
        />
      </div>

      <div className="mb-5">
        <label htmlFor={`quiz-time-limit-${quiz.id}`} className="mb-1 block text-xs font-semibold text-muted">
          Time limit (minutes)
        </label>
        <input
          id={`quiz-time-limit-${quiz.id}`}
          type="number"
          min="1"
          defaultValue={timeLimitMinutes}
          onBlur={(event) => {
            const value = Number(event.target.value);
            if (Number.isInteger(value) && value > 0 && value !== timeLimitMinutes) {
              onUpdate(quiz.id, { timeLimitMinutes: value }, "Time limit updated");
            } else {
              event.target.value = timeLimitMinutes;
            }
          }}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
      </div>

      <div className="mb-5">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={disablePreviousNavigation}
            onChange={(event) =>
              onUpdate(
                quiz.id,
                { disablePreviousNavigation: event.target.checked },
                event.target.checked
                  ? "Previous navigation disabled"
                  : "Previous navigation enabled"
              )
            }
            className="mt-1 h-4 w-4 accent-primary"
          />
          <span>
            <span className="block font-semibold text-ink">
              Disable previous question
            </span>
            <span className="block text-xs text-muted">
              Students cannot return to earlier questions while taking this quiz.
            </span>
          </span>
        </label>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => onReview(quiz.id)}
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
          >
            Review
          </button>
          <button
            type="button"
            onClick={() => onExport(quiz)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
          >
            Export
          </button>
          <button
            type="button"
            onClick={() => onUpdate(quiz.id, { published: !quiz.published })}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              quiz.published
                ? "bg-warning/15 text-warning hover:bg-warning/25"
                : "bg-success text-white hover:bg-success/85"
            }`}
          >
            {quiz.published ? "Unpublish" : "Publish"}
          </button>
        </div>
        <button
          type="button"
          onClick={() => onDelete(quiz.id)}
          className="w-full rounded-lg border border-danger/40 bg-white px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/5"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
