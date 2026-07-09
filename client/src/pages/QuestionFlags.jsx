import { useState } from "react";
import { useSelectedCourseId } from "../stores/appStore";
import {
  useCourseQuizQuestionFlags,
  useUpdateQuizQuestionFlagStatus,
} from "../hooks/useQuizQuestionFlags";
import { useToast } from "../components/ui/Toast";
import { formatDateTime } from "../lib/format";

const STATUSES = ["pending", "reviewed", "resolved", "dismissed"];

export default function QuestionFlags() {
  const courseId = useSelectedCourseId();
  const showToast = useToast();
  const [statusFilter, setStatusFilter] = useState("pending");
  const { flags, isPending } = useCourseQuizQuestionFlags(courseId);
  const updateStatus = useUpdateQuizQuestionFlagStatus({
    onSuccess: () => showToast("Report status updated", "success"),
    onError: (error) => showToast(error.message || "Could not update report", "error"),
  });
  const visibleFlags = statusFilter ? flags.filter((flag) => flag.status === statusFilter) : flags;

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Student Question Flags</h1>
          <p className="mt-1 text-muted">Review questions that students reported during quizzes.</p>
        </div>
        <label className="text-sm font-medium text-ink">
          Status
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="ml-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal focus:border-primary focus:outline-none"
          >
            <option value="">All reports</option>
            {STATUSES.map((status) => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}
          </select>
        </label>
      </div>

      {!courseId ? (
        <EmptyState text="Select a course from the sidebar to view student reports." />
      ) : isPending ? (
        <EmptyState loading text="Loading student reports..." />
      ) : visibleFlags.length === 0 ? (
        <EmptyState text={statusFilter ? `No ${statusFilter} reports for this course.` : "No student reports for this course."} />
      ) : (
        <div className="space-y-4">
          {visibleFlags.map((flag) => (
            <article key={flag._id} className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="font-semibold text-ink">{flag.quizName}</div>
                  <div className="mt-1 text-sm text-muted">
                    {flag.studentName || "Unknown student"} · Reported {formatDateTime(flag.updatedAt)}
                  </div>
                </div>
                <label className="text-sm font-medium text-ink">
                  <span className="sr-only">Report status</span>
                  <select
                    value={flag.status}
                    disabled={updateStatus.isPending}
                    onChange={(event) => updateStatus.mutate({ flagId: flag._id, status: event.target.value })}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium capitalize focus:border-primary focus:outline-none disabled:opacity-50"
                  >
                    {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </label>
              </div>
              {flag.questionText && (
                <div className="mt-4 rounded-lg bg-page p-3 text-sm text-ink whitespace-pre-wrap">
                  {flag.questionText}
                </div>
              )}
              <p className="mt-4 text-sm text-ink">
                <span className="font-semibold">Issue:</span> {flag.reason.replace("-", " ")}
              </p>
              {flag.comment && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{flag.comment}</p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ text, loading = false }) {
  return (
    <div className="rounded-2xl bg-white py-16 text-center shadow-sm">
      <i className={`fas ${loading ? "fa-circle-notch fa-spin" : "fa-flag"} mb-3 text-3xl text-gray-300`} />
      <p className="text-muted">{text}</p>
    </div>
  );
}
