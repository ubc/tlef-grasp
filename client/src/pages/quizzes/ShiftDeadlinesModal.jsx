import { useEffect, useMemo, useState } from "react";
import Modal from "../../components/ui/Modal";
import { formatDateTime } from "../../lib/format";
import { useShiftQuizSchedules } from "../../hooks/useQuizzes";
import { useToast } from "../../components/ui/Toast";
import { scheduleStatus, shiftApplyBody, shiftRequestBody } from "./schedulePayload";

// Identifies which inputs a preview was computed for, so a stale one can't be applied.
const previewKey = (body) => (body ? `${body.amount}|${body.unit}|${body.quizIds.join(",")}` : null);

const FLAG_LABELS = {
  expired: { label: "Already closed", cls: "bg-danger/10 text-danger" },
  "opens-now": { label: "Opens immediately", cls: "bg-warning/15 text-warning" },
  "becomes-upcoming": {
    label: "Open now — hidden until the new release",
    cls: "bg-warning/15 text-warning",
  },
  reopens: { label: "Closed — will reopen", cls: "bg-warning/15 text-warning" },
  collision: { label: "Same start as another quiz", cls: "bg-warning/15 text-warning" },
};

// Shift every owned section's window of the selected quizzes by one offset.
// The server computes the preview (dry run) so it matches exactly what applies.
export default function ShiftDeadlinesModal({ open, courseId, quizzes, sections, onClose, onApplied }) {
  const showToast = useToast();
  const [amount, setAmount] = useState("7");
  const [unit, setUnit] = useState("days");
  const [preview, setPreview] = useState(null); // { key, rows }

  useEffect(() => {
    if (open) setPreview(null);
  }, [open]);

  const quizIds = useMemo(() => quizzes.map((q) => q.id), [quizzes]);
  const body = shiftRequestBody({ quizIds, amount, unit });
  const previewIsCurrent = preview && preview.key === previewKey(body);

  const quizName = useMemo(() => new Map(quizzes.map((q) => [q.id, q.name])), [quizzes]);
  const sectionLabel = useMemo(
    () => new Map(sections.map((s) => [s._id, s.sectionNumber || s.sectionId])),
    [sections]
  );

  const mutation = useShiftQuizSchedules(courseId, {
    onSuccess: (data, sent) => {
      if (sent.dryRun) {
        setPreview({ key: previewKey(sent), rows: data.rows || [] });
      } else {
        showToast(`Shifted ${data.rows.length} schedule(s)`, "success");
        onApplied?.();
      }
    },
    onError: (error, sent) => {
      // The apply may have gone through anyway; require a fresh preview.
      if (!sent.dryRun) setPreview(null);
      showToast(error.message || "Failed to shift deadlines", "error");
    },
  });

  const now = new Date();
  const flagged = previewIsCurrent ? preview.rows.filter((r) => r.flags.length).length : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={`Shift deadlines (${quizzes.length} quiz${quizzes.length === 1 ? "" : "zes"})`}
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
            onClick={() => mutation.mutate({ ...body, dryRun: true })}
            disabled={!body || mutation.isPending}
            className="rounded-lg border border-primary bg-white px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/5 disabled:opacity-60"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate(shiftApplyBody(body, preview.rows))}
            disabled={!previewIsCurrent || preview.rows.length === 0 || mutation.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
          >
            {mutation.isPending ? "Working…" : "Apply shift"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-end gap-3">
          <div>
            <label htmlFor="shift-amount" className="mb-1 block text-sm font-semibold text-ink">
              Shift by
            </label>
            <input
              id="shift-amount"
              type="number"
              step="1"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <select
            aria-label="Unit"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          >
            <option value="days">days</option>
            <option value="hours">hours</option>
          </select>
        </div>
        <p className="text-xs text-muted">
          Use a negative number to move earlier. Release and expire dates move together
          on every one of your sections, so spacing is preserved. Day shifts keep the same
          local time of day across daylight-saving changes. Students already mid-attempt
          keep the deadline they started with; moving an open quiz later hides it from
          everyone else until its new release date.
        </p>
        {!body && <p className="text-xs text-danger">Enter a whole, non-zero number.</p>}

        {previewIsCurrent &&
          (preview.rows.length === 0 ? (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-muted">
              None of your sections are scheduled for the selected quizzes — nothing to shift.
            </p>
          ) : (
            <>
              {flagged > 0 && (
                <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                  {flagged} row(s) need attention — review the flags below before applying.
                </p>
              )}
              <div className="max-h-80 overflow-auto rounded-lg border border-gray-200">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-muted">
                    <tr>
                      <th className="px-3 py-2">Quiz</th>
                      <th className="px-3 py-2">Section</th>
                      <th className="px-3 py-2">Release</th>
                      <th className="px-3 py-2">Expire</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => {
                      const status = scheduleStatus(row, now);
                      return (
                        <tr key={`${row.quizId}-${row.courseSectionId}`} className="border-t border-gray-100 align-top">
                          <td className="px-3 py-2 font-medium text-ink">{quizName.get(row.quizId)}</td>
                          <td className="px-3 py-2">{sectionLabel.get(row.courseSectionId) || "—"}</td>
                          <td className="px-3 py-2">
                            <div className="text-muted line-through">{formatDateTime(row.oldReleaseDate)}</div>
                            <div>{formatDateTime(row.releaseDate)}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-muted line-through">{formatDateTime(row.oldExpireDate)}</div>
                            <div>{formatDateTime(row.expireDate)}</div>
                          </td>
                          <td className="space-y-1 px-3 py-2">
                            <span className={`inline-block rounded-full px-2 py-0.5 font-medium ${status.cls}`}>
                              {status.label}
                            </span>
                            {row.flags.map((flag) => (
                              <span
                                key={flag}
                                className={`block w-fit rounded-full px-2 py-0.5 font-medium ${FLAG_LABELS[flag].cls}`}
                              >
                                {FLAG_LABELS[flag].label}
                              </span>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ))}
      </div>
    </Modal>
  );
}
