import { Link } from "react-router-dom";
import { useSelectedCourseId } from "../stores/appStore";
import { useMyQuizQuestionFlags } from "../hooks/useQuizQuestionFlags";
import { formatDateTime } from "../lib/format";

const STATUS_STYLE = {
  pending: "bg-warning/15 text-warning",
  reviewed: "bg-primary/10 text-primary",
  resolved: "bg-success/10 text-success",
  dismissed: "bg-gray-100 text-muted",
};

export default function MyQuestionFlags() {
  const courseId = useSelectedCourseId();
  const { flags, isPending } = useMyQuizQuestionFlags(courseId);

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">My Flagged Questions</h1>
        <p className="mt-1 text-muted">Track issues you have reported while taking quizzes.</p>
      </div>

      {!courseId ? (
        <EmptyState text="Select a course from the sidebar to see your reports." />
      ) : isPending ? (
        <EmptyState loading text="Loading your reports..." />
      ) : flags.length === 0 ? (
        <EmptyState text="You have not flagged any quiz questions in this course." />
      ) : (
        <div className="space-y-4">
          {flags.map((flag) => (
            <article key={flag._id} className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">{flag.quizName}</p>
                  <p className="mt-1 text-sm text-muted">Reported {formatDateTime(flag.updatedAt)}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${STATUS_STYLE[flag.status] || STATUS_STYLE.pending}`}>
                  {flag.status}
                </span>
              </div>
              {flag.questionText && <p className="mt-4 whitespace-pre-wrap text-sm text-ink">{flag.questionText}</p>}
              <p className="mt-4 text-sm text-ink">
                <span className="font-semibold">Issue:</span> {flag.reason.replace("-", " ")}
              </p>
              {flag.comment && <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{flag.comment}</p>}
              <Link
                to={`/quiz?quiz=${encodeURIComponent(flag.quizId)}`}
                className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary-dark"
              >
                <i className="fas fa-arrow-right" /> Open quiz
              </Link>
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
