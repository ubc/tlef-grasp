// Pure helpers for the My Sections "Sync from Canvas" flow (issue #113).
// No React or DOM here so tests/client can cover the wording directly.

// The Canvas features a deployment's CANVAS_SCOPES enable, from
// /api/lms/canvas/status. A server that does not report them (or a response
// that omits one) predates scoped keys: treat the feature as on.
export function canvasCapabilities(statusData) {
  const reported = statusData?.capabilities || {};
  return {
    link: reported.link !== false,
    rosterSync: reported.rosterSync !== false,
    files: reported.files !== false,
    assignments: reported.assignments !== false,
  };
}

export const CANVAS_ROSTER_SYNC_DISABLED_NOTE =
  "Canvas roster sync isn't enabled on this deployment";

/**
 * Which per-row student sync a My Sections row gets:
 *   "canvas"          — Sync from Canvas;
 *   "canvas-disabled" — Canvas-linked, but this deployment's Canvas scopes do
 *                       not include roster sync: a short note, no button;
 *   "academic"        — the UBC Academic API "Sync Students";
 *   "none"            — no button yet (status still loading, or Canvas not
 *                       connected: the row offers "Connect Canvas").
 * A Canvas-linked section never falls back to the Academic API while Canvas is
 * configured: once linked, its students come from Canvas only.
 */
export function sectionSyncMode(section, canvas) {
  if (section?.lmsLink?.provider !== "canvas") return "academic";
  if (canvas.pending) return "none";
  if (!canvas.enabled) return "academic";
  if (!canvas.connected) return "none";
  return canvas.capabilities?.rosterSync === false ? "canvas-disabled" : "canvas";
}

/**
 * Button state of one section's "Sync from Canvas" given the page's single
 * Canvas sync mutation. Only one Canvas sync runs at a time: the mutation
 * observer tracks just the latest mutate() call, so letting a second row start
 * one would re-enable the first mid-flight and let two confirmation replies
 * overwrite each other's review. While any Canvas sync is pending every Canvas
 * row is busy (disabled); the spinner shows only on the row being synced.
 */
export function canvasSyncRowState(mutation, section) {
  const busy = Boolean(mutation?.isPending);
  return {
    busy,
    syncing: busy && mutation?.variables?.sectionId === section?.sectionId,
  };
}

export const CONFIRMATION_REASONS = {
  FIRST_SYNC: "first-sync",
  LARGE_DROP: "large-drop",
  ROSTER_CHANGED: "roster-changed",
};

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function pluralize(n, singular, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function formatCoverage(coverage) {
  return typeof coverage === "number" && Number.isFinite(coverage)
    ? `${Math.round(coverage * 100)}%`
    : "";
}

const largeDropCounts = (dropCount, activeCount) =>
  `${dropCount}${activeCount ? ` of ${activeCount}` : ""}`;

// Why the server wants the instructor to review drops before applying them.
export function describeConfirmationReason(reason, plan) {
  const dropCount = Array.isArray(plan?.drop) ? plan.drop.length : 0;
  const activeCount = count(plan?.activeCount);

  switch (reason) {
    case CONFIRMATION_REASONS.FIRST_SYNC:
      return "This is the first sync since this section was linked to Canvas. Nobody is dropped automatically on a first sync, so please review the students below who are enrolled in GRASP but are not in the Canvas section.";
    case CONFIRMATION_REASONS.LARGE_DROP:
      return `This sync would drop more than half of the students currently in this section (${largeDropCounts(
        dropCount,
        activeCount
      )}). Please confirm before they are dropped.`;
    case CONFIRMATION_REASONS.ROSTER_CHANGED:
      // Sent when a confirmed list is now incomplete, so it may still be a
      // large drop; keep that context visible on the re-prompt.
      return `The Canvas roster changed since you last reviewed it. Please review the updated list of students who would be dropped.${
        activeCount && dropCount > 0.5 * activeCount
          ? ` This sync would drop more than half of the students currently in this section (${largeDropCounts(
              dropCount,
              activeCount
            )}).`
          : ""
      }`;
    default:
      return "Please review the students who would be dropped before syncing.";
  }
}

// Label/count rows for the confirmation dialog's summary list.
export function planCounts(plan) {
  return [
    { key: "add", label: "Students to add", value: count(plan?.add) },
    { key: "restore", label: "Students to restore", value: count(plan?.restore) },
    {
      key: "drop",
      label: "Students to drop",
      value: Array.isArray(plan?.drop) ? plan.drop.length : 0,
    },
    {
      key: "unmatched",
      label: "Canvas students without a UBC ID (not matched)",
      value: Array.isArray(plan?.unmatched) ? plan.unmatched.length : 0,
    },
  ];
}

// Toast text + tone for an applied Canvas sync summary.
export function describeCanvasSyncResult(summary) {
  const added = count(summary?.added);
  const restored = count(summary?.restored);
  const dropped = count(summary?.dropped);
  const unmatched = Array.isArray(summary?.unmatched) ? summary.unmatched.length : 0;
  const previouslyRemoved = count(summary?.previouslyRemovedRestored);
  const errors = Array.isArray(summary?.errors) ? summary.errors : [];

  const notes = [];
  if (previouslyRemoved > 0) {
    notes.push(
      `${pluralize(previouslyRemoved, "student")} removed from the course earlier ${
        previouslyRemoved === 1 ? "was" : "were"
      } re-added because they are still on the Canvas roster.`
    );
  }
  if (unmatched > 0) {
    notes.push(
      `${pluralize(unmatched, "Canvas student")} could not be matched because Canvas did not return a UBC ID.`
    );
  }
  if (summary?.dropsSkipped === "low-coverage") {
    const coverage = formatCoverage(summary?.coverage);
    notes.push(
      `No students were dropped because only ${coverage || "some"} of the Canvas roster had UBC IDs.`
    );
  } else if (summary?.dropsSkipped === "instructor-skipped") {
    notes.push("No students were dropped, as you chose.");
  }
  if (errors.length > 0) {
    const names = errors
      .map((error) => error?.name)
      .filter(Boolean)
      .slice(0, 5)
      .join(", ");
    notes.push(
      `${pluralize(errors.length, "student")} could not be updated${names ? ` (${names}${errors.length > 5 ? ", …" : ""})` : ""}. Try syncing again.`
    );
  }

  const message = [
    `Synced from Canvas — ${added} added, ${restored} restored, ${dropped} dropped.`,
    ...notes,
  ].join(" ");
  const type =
    errors.length > 0 || summary?.dropsSkipped === "low-coverage" ? "warning" : "success";
  return { message, type, hasNotes: notes.length > 0 };
}

// "Last synced" text for the linked-section cell; empty when never synced.
export function formatLastSynced(at) {
  if (!at) return "";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return `Last synced ${date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}
