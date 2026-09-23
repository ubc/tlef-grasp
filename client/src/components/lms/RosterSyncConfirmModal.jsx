import { useId } from "react";
import Modal from "../ui/Modal";
import {
  describeConfirmationReason,
  planCounts,
  pluralize,
} from "../../lib/lmsRosterSync";

// Shown when a Canvas roster sync comes back 'confirmation-required': nothing
// has been applied yet. The instructor either confirms exactly the listed
// drops, syncs adds/restores only, or cancels.
export default function RosterSyncConfirmModal({
  open,
  onClose,
  sectionLabel,
  reason,
  plan,
  onConfirmDrops,
  onSkipDrops,
}) {
  const dropListHeadingId = useId();
  const drops = Array.isArray(plan?.drop) ? plan.drop : [];
  const unmatchedCount = Array.isArray(plan?.unmatched) ? plan.unmatched.length : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Review Canvas sync"
      wide
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSkipDrops}
            className="rounded-lg border border-primary/40 bg-white px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/5"
          >
            Sync without dropping
          </button>
          <button
            type="button"
            onClick={() => onConfirmDrops?.(drops.map((student) => student.userId))}
            className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-danger/85"
          >
            {`Sync and drop ${drops.length}`}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-ink">
        {sectionLabel ? (
          <p>
            Section <span className="font-semibold">{sectionLabel}</span>
          </p>
        ) : null}
        <p>{describeConfirmationReason(reason, plan)}</p>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {planCounts(plan).map((row) => (
            <div key={row.key} className="rounded-xl border border-gray-200 px-3 py-2">
              <dt className="text-xs text-muted">{row.label}</dt>
              <dd className="text-lg font-semibold text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>

        {drops.length > 0 ? (
          <div>
            <h4 id={dropListHeadingId} className="mb-1.5 font-semibold text-ink">
              {pluralize(drops.length, "student")} would be dropped
            </h4>
            {/* Focusable so keyboard users can scroll a long list. */}
            <div
              role="region"
              aria-labelledby={dropListHeadingId}
              tabIndex={0}
              className="max-h-48 overflow-y-auto rounded-xl border border-gray-200"
            >
              <ul className="divide-y divide-gray-100">
                {drops.map((student) => (
                  <li key={student.userId} className="px-4 py-2">
                    {student.name || "Unknown student"}
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              Dropped students are no longer in this section and lose access to its
              quizzes. A later sync restores anyone who is back on the Canvas roster.
            </p>
          </div>
        ) : null}

        {unmatchedCount > 0 ? (
          <p className="text-xs text-muted">
            {pluralize(unmatchedCount, "Canvas student")} could not be matched because
            Canvas did not return a UBC ID for them. They will not be added.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
