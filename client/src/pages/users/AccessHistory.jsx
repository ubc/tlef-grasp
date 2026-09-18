import { useState } from "react";
import { useCourseAccessLog } from "../../hooks/useUsers";
import { LoadingRow } from "../../components/ui/states";
import { describeAccessEvent, formatDateTime } from "./userListUtils";

// Instructor-only, newest-first record of who added, promoted, demoted, or
// removed people in this course (issue #115). Collapsed by default and only
// fetched once opened, so the roster page stays light.
export default function AccessHistory({ courseId }) {
  const [open, setOpen] = useState(false);
  const { events, isPending, isError, error } = useCourseAccessLog(courseId, {
    enabled: open,
  });

  return (
    <section
      className="mb-8 rounded-2xl bg-white p-6 shadow-sm"
      aria-labelledby="access-history-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="access-history-heading" className="text-lg font-semibold text-ink">
            <i className="fas fa-clipboard-check mr-2 text-primary" />
            Access History
          </h2>
          <p className="mt-1 text-sm text-muted">
            Who added, promoted, demoted, or removed people in this course, newest first.
          </p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="access-history-panel"
          onClick={() => setOpen((current) => !current)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
        >
          <i className={`fas ${open ? "fa-chevron-up" : "fa-chevron-down"}`} aria-hidden="true" />
          {open ? "Hide history" : "Show history"}
        </button>
      </div>

      {open && (
        <div id="access-history-panel" className="mt-4">
          {isPending ? (
            <LoadingRow label="Loading access history..." />
          ) : isError ? (
            <p className="text-sm text-danger">
              {error?.message || "Failed to load access history."}
            </p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted">No access changes have been recorded yet.</p>
          ) : (
            <ol className="divide-y divide-gray-100 rounded-xl border border-gray-200">
              {events.map((event) => (
                <li
                  key={String(event._id)}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 text-sm"
                >
                  <time
                    dateTime={event.createdAt}
                    className="w-44 shrink-0 text-xs text-muted"
                  >
                    {formatDateTime(event.createdAt)}
                  </time>
                  <span className="text-ink">{describeAccessEvent(event)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
