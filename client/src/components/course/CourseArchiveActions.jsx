import { useState } from "react";
import Modal from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { useArchiveCourse, useUnarchiveCourse } from "../../hooks/useCourses";

// Archive / unarchive controls, shared by the Settings page (where a course is
// archived), the Archived tab in the Manage-courses hub, and the read-only
// banner (where it is restored). Keeping both in one place keeps the wording of
// what archiving actually does consistent wherever it is offered.

export function ArchiveCourseButton({ courseId, courseName, onArchived, className = "" }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { showToast } = useToast();

  const archive = useArchiveCourse({
    onSuccess: () => {
      setConfirmOpen(false);
      showToast(`"${courseName}" has been archived`, "success");
      onArchived?.();
    },
    onError: (error) => {
      showToast(error?.message || "Could not archive this course", "error");
    },
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={archive.isPending}
        className={
          className ||
          "inline-flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm font-semibold text-warning transition-colors hover:bg-warning/20 disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        <i className={`fas ${archive.isPending ? "fa-spinner fa-spin" : "fa-box-archive"}`} />
        <span>Archive course</span>
      </button>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Archive this course?"
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => archive.mutate(courseId)}
              disabled={archive.isPending}
              className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-danger/85 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {archive.isPending ? "Archiving..." : "Archive course"}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-ink">
          <p>
            <span className="font-semibold">{courseName}</span> will be archived.
            Nothing is deleted — materials, questions, quizzes, and student scores
            are all kept, and you can restore the course at any time.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>Students and co-instructors lose access immediately.</li>
            <li>Any quiz attempt in progress right now is abandoned.</li>
            <li>The invite code stops working.</li>
            <li>
              The course code is released, so you can reuse it for next term's
              course.
            </li>
            <li>
              You keep read-only access from{" "}
              <span className="font-medium">Manage courses &rarr; Archived</span>.
            </li>
          </ul>
        </div>
      </Modal>
    </>
  );
}

export function UnarchiveCourseButton({ course, onRestored, className = "" }) {
  const courseId = course?._id || course?.id;
  const courseName = course?.courseName || course?.name || "This course";

  // Populated when the server comes back 409 code_conflict: archiving released
  // the course code and another shell has since taken it, so the restore needs
  // a new one before it can go through.
  const [conflict, setConflict] = useState(null);
  const [newCode, setNewCode] = useState("");
  const { showToast } = useToast();

  const unarchive = useUnarchiveCourse({
    onSuccess: () => {
      setConflict(null);
      setNewCode("");
      showToast(`"${courseName}" has been restored`, "success");
      onRestored?.();
    },
    onError: (error) => {
      if (error?.status === 409 && error?.body?.error === "code_conflict") {
        setConflict(error.body);
        setNewCode(error.body.suggestedCode || "");
        return;
      }
      showToast(error?.message || "Could not restore this course", "error");
    },
  });

  const submitWithCode = (event) => {
    event.preventDefault();
    const trimmed = newCode.trim();
    if (!trimmed) return;
    unarchive.mutate({ courseId, courseCode: trimmed });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => unarchive.mutate({ courseId })}
        disabled={unarchive.isPending}
        className={
          className ||
          "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        <i className={`fas ${unarchive.isPending ? "fa-spinner fa-spin" : "fa-box-open"}`} />
        <span>Unarchive</span>
      </button>

      <Modal
        open={!!conflict}
        onClose={() => setConflict(null)}
        title="Choose a new course code"
        footer={
          <>
            <button
              type="button"
              onClick={() => setConflict(null)}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="unarchive-code-form"
              disabled={unarchive.isPending || !newCode.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {unarchive.isPending ? "Restoring..." : "Restore course"}
            </button>
          </>
        }
      >
        <form id="unarchive-code-form" onSubmit={submitWithCode} className="space-y-4">
          <p className="text-sm text-ink">
            While <span className="font-semibold">{courseName}</span> was archived,
            its code{" "}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
              {conflict?.currentCode || course?.courseCode}
            </code>{" "}
            was taken by{" "}
            <span className="font-semibold">{conflict?.conflictingCourseName}</span>.
            Give the course you are restoring a different code.
          </p>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">
              New course code
            </span>
            <input
              value={newCode}
              onChange={(event) => setNewCode(event.target.value)}
              autoFocus
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
        </form>
      </Modal>
    </>
  );
}
