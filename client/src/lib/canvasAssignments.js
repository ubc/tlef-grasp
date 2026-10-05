// Pure helpers for the Canvas assignment a scheduled quiz gets on a linked
// section (issue #125). No React or DOM here so tests/client can cover them.

import { formatDateTime } from "./format.js";

/** Canvas is configured, this instructor is connected, and the scopes allow assignments. */
export function canvasAssignmentsEnabled(canvas) {
  return Boolean(canvas?.configured && canvas?.connected && canvas?.capabilities?.assignments !== false);
}

/**
 * After a schedule save for `savedSectionIds`, split the (freshly re-read)
 * per-section status into what GRASP does on its own and what it asks about:
 *  - `sync`: sections whose assignment exists, so Canvas's due date follows the
 *    new schedule without a prompt;
 *  - `prompt`: linked, scheduled sections with nothing recorded yet. A decline
 *    is recorded too, so a declined section is not asked again.
 */
export function partitionAfterSave(statusSections, savedSectionIds) {
  const saved = new Set((savedSectionIds || []).map(String));
  const sync = [];
  const prompt = [];
  for (const section of statusSections || []) {
    if (!saved.has(String(section.courseSectionId)) || !section.linked || !section.scheduled) continue;
    if (section.assignment?.status === "created") sync.push(section.courseSectionId);
    else if (!section.assignment) prompt.push(section);
  }
  return { sync, prompt };
}

/**
 * What to show beside a section's schedule chip:
 *   { kind: "created", href, title }  — a link to the assignment
 *   { kind: "failed", title }         — created, but the last Canvas update failed; offer a retry
 *   { kind: "offer" }                 — linked and scheduled, nothing in Canvas (declined or never asked)
 *   null                              — not linked to Canvas, or not scheduled
 */
export function canvasChipState(section) {
  if (!section?.linked || !section.scheduled) return null;
  const assignment = section.assignment;
  if (assignment?.status === "created") {
    if (assignment.lastError) {
      return {
        kind: "failed",
        title: `Canvas was not updated: ${assignment.lastError.message}. Click to retry.`,
      };
    }
    return {
      kind: "created",
      href: assignment.htmlUrl || null,
      title: assignment.dueAt
        ? `In Canvas, due ${formatDateTime(assignment.dueAt)}`
        : "In Canvas",
    };
  }
  return { kind: "offer" };
}

/** Rows for the "create in Canvas?" prompt, one per section. */
export function promptItemsForSections(sections) {
  return (sections || []).map((section) => ({
    key: section.courseSectionId,
    label: `Section ${section.sectionNumber || section.sectionId || ""}`.trim(),
    dueAt: section.expireDate || null,
  }));
}

/** Rows for the prompt shown after a section is linked, one per scheduled quiz. */
export function promptItemsForQuizzes(quizzes) {
  return (quizzes || [])
    .filter((quiz) => !quiz.assignment)
    .map((quiz) => ({ key: quiz.quizId, label: quiz.name || "Quiz", dueAt: quiz.expireDate || null }));
}

/**
 * Toast text + tone for the outcome of one ensure call. `labelFor(sectionId)`
 * names a section. Nothing to say when nothing changed.
 */
export function describeEnsureResults(results, labelFor = (id) => id) {
  const by = (status) => (results || []).filter((r) => r.status === status);
  const names = (rows) => rows.map((r) => labelFor(r.courseSectionId)).join(", ");
  const created = by("created");
  const updated = by("updated");
  const failed = by("failed");
  const inProgress = by("in-progress");

  const noun = (rows) => (rows.length === 1 ? "assignment" : "assignments");
  const parts = [];
  if (created.length) parts.push(`Canvas ${noun(created)} created for ${names(created)}.`);
  if (updated.length) parts.push(`Canvas due date updated for ${names(updated)}.`);
  if (inProgress.length) parts.push(`Canvas ${noun(inProgress)} for ${names(inProgress)} already being created.`);
  for (const row of failed) {
    parts.push(`Canvas could not be updated for ${labelFor(row.courseSectionId)}: ${row.error || "unknown error"}`);
  }
  if (parts.length === 0) return { message: "", type: "success" };
  return {
    message: parts.join(" "),
    type: failed.length ? (created.length || updated.length ? "warning" : "error") : "success",
  };
}
