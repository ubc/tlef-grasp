import { useEffect, useMemo, useState } from "react";
import { toDatetimeLocal, formatDate } from "../../lib/format";
import DeliveryFormatToggle from "../../components/DeliveryFormatToggle";
import Modal from "../../components/ui/Modal";
import { useQuizSchedules, useUpdateQuizSchedules } from "../../hooks/useQuizzes";
import { useToast } from "../../components/ui/Toast";

// Active / Scheduled (upcoming) / Expired badge for a section's window.
function scheduleStatus(row, now) {
  const release = new Date(row.releaseDate);
  const expire = new Date(row.expireDate);
  if (now < release) return { label: "Scheduled", cls: "bg-primary/10 text-primary" };
  if (now > expire) return { label: "Expired", cls: "bg-gray-100 text-muted" };
  return { label: "Active", cls: "bg-success/15 text-success" };
}

// Create/edit one section's release/expire window.
function ScheduleModal({ open, mode, section, available, initial, onClose, onSave, onRemove, saving }) {
  const [courseSectionId, setCourseSectionId] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [expireDate, setExpireDate] = useState("");

  useEffect(() => {
    if (!open) return;
    setCourseSectionId(mode === "edit" ? section?.courseSectionId || "" : "");
    setReleaseDate(initial?.releaseDate ? toDatetimeLocal(initial.releaseDate) : "");
    setExpireDate(initial?.expireDate ? toDatetimeLocal(initial.expireDate) : "");
  }, [open, mode, section, initial]);

  const valid =
    courseSectionId &&
    releaseDate &&
    expireDate &&
    new Date(expireDate) > new Date(releaseDate);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "edit" ? "Edit section schedule" : "Schedule a section"}
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
            onClick={() => onSave({ courseSectionId, releaseDate, expireDate })}
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
          <label className="mb-1 block text-sm font-semibold text-ink">Section</label>
          {mode === "edit" ? (
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-ink">
              {section?.label}
            </div>
          ) : (
            <select
              value={courseSectionId}
              onChange={(event) => setCourseSectionId(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">Select a section…</option>
              {available.map((s) => (
                <option key={s.courseSectionId} value={s.courseSectionId}>
                  {s.label}
                </option>
              ))}
            </select>
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

function SectionSchedule({ courseId, quizId, sections }) {
  const showToast = useToast();
  const { schedules } = useQuizSchedules(quizId);
  const [modal, setModal] = useState(null); // null | { mode, courseSectionId? }

  const updateMutation = useUpdateQuizSchedules(courseId, quizId, {
    onSuccess: () => {
      showToast("Schedule saved", "success");
      setModal(null);
    },
    onError: (error) => showToast(error.message || "Failed to save schedule", "error"),
  });

  // courseSectionId -> human label
  const labelFor = useMemo(() => {
    const map = new Map();
    for (const s of sections) map.set(s._id, s.sectionNumber || s.sectionId);
    return (id) => map.get(id) || "Unknown section";
  }, [sections]);

  // `sections` are the ones this instructor owns; only those sections' schedules
  // are theirs to view and edit. Other instructors' schedules are left alone.
  const ownedIds = useMemo(() => new Set(sections.map((s) => s._id)), [sections]);
  const mySchedules = useMemo(
    () => schedules.filter((s) => ownedIds.has(s.courseSectionId)),
    [schedules, ownedIds]
  );

  const now = new Date();
  const scheduledIds = new Set(mySchedules.map((s) => s.courseSectionId));
  const availableSections = sections
    .filter((s) => !scheduledIds.has(s._id))
    .map((s) => ({ courseSectionId: s._id, label: s.sectionNumber || s.sectionId }));

  // Rebuild the schedule payload for the sections this instructor owns (the
  // backend replaces this instructor's set) with one section changed or removed.
  // Untouched rows keep their stored ISO dates.
  const payloadWithout = (courseSectionId) =>
    mySchedules
      .filter((s) => s.courseSectionId !== courseSectionId)
      .map((s) => ({
        courseSectionId: s.courseSectionId,
        releaseDate: s.releaseDate,
        expireDate: s.expireDate,
      }));

  const handleSave = ({ courseSectionId, releaseDate, expireDate }) => {
    updateMutation.mutate([
      ...payloadWithout(courseSectionId),
      { courseSectionId, releaseDate, expireDate },
    ]);
  };

  const handleRemove = (courseSectionId) => {
    updateMutation.mutate(payloadWithout(courseSectionId));
  };

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
          disabled={sections.length === 0 || availableSections.length === 0}
          title={
            sections.length === 0
              ? "Add sections to this course first"
              : availableSections.length === 0
                ? "All sections are scheduled"
                : "Schedule a section"
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
            return (
              <button
                key={row.courseSectionId}
                type="button"
                onClick={() => setModal({ mode: "edit", courseSectionId: row.courseSectionId })}
                className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs transition-colors hover:border-primary hover:bg-primary/5"
              >
                <span className="font-semibold text-ink">{labelFor(row.courseSectionId)}</span>
                <span className={`rounded-full px-2 py-0.5 font-medium ${status.cls}`}>
                  {status.label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <ScheduleModal
        open={!!modal}
        mode={modal?.mode}
        section={
          editing
            ? { courseSectionId: editing.courseSectionId, label: labelFor(editing.courseSectionId) }
            : null
        }
        available={availableSections}
        initial={editing}
        saving={updateMutation.isPending}
        onClose={() => setModal(null)}
        onSave={handleSave}
        onRemove={editing ? () => handleRemove(editing.courseSectionId) : undefined}
      />
    </div>
  );
}

export default function QuizCard({ quiz, courseId, sections = [], onUpdate, onReview, onExport, onDelete }) {
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
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-ink">{quiz.name}</h3>
        <div className="text-xs text-muted">Created: {formatDate(quiz.createdAt)}</div>
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

      <SectionSchedule courseId={courseId} quizId={quiz.id} sections={sections} />

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
