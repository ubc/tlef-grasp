// Pure helpers for importing a Canvas Classic Quizzes export (.zip) into the
// question bank (issue #140). No React or DOM here so tests/client can cover the
// selection rules and the wording directly.
//
// The server reads the zip twice: once for a preview (nothing written), then
// once per Canvas quiz on commit. Shapes are the server's PreviewReport and
// CommitReport (src/services/canvas-quiz-import.js).

import { pluralize } from "./lmsRosterSync.js";

export const CANVAS_PREVIEW_URL = "/api/question-import/canvas/preview";
export const CANVAS_COMMIT_URL = "/api/question-import/canvas/commit";

// Statuses after which every later quiz would fail the same way (signed out,
// no permission, upload too large), so the rest are not sent.
const STOP_STATUSES = new Set([401, 403, 413]);

const count = (value) => (Number.isFinite(value) ? value : 0);
const listOf = (value) => (Array.isArray(value) ? value : []);
// The server may report a number or the list itself.
const tally = (value) => (Array.isArray(value) ? value.length : count(value));

// The server's COURSE_EXPORT message (src/utils/canvas-qti-package.js), word
// for word.
export const COURSE_EXPORT_MESSAGE =
  "This is a full Canvas course export. In Canvas, use Settings > Export Course Content > Quiz instead, and upload that .zip.";

// A Canvas quiz export is a .zip, and goes to the server for a preview. A full
// course export (.imscc) is a Canvas export too, but the modal answers it
// without uploading it (isCanvasCourseExportFile). Anything else goes through
// the JSON import.
export function isCanvasExportFile(file) {
  return /\.(zip|imscc)$/i.test(String(file?.name || "").trim());
}

// A full Canvas course export is always an .imscc. It bundles every course
// file, so it is often over the upload limit, and the server would answer "too
// large" instead of naming the export to make. The modal shows
// COURSE_EXPORT_MESSAGE without uploading it. A course export renamed to .zip
// still goes to the server, which answers with the same message.
export function isCanvasCourseExportFile(file) {
  return /\.imscc$/i.test(String(file?.name || "").trim());
}

/**
 * How many questions of this Canvas quiz, imported earlier, are missing from
 * its existing GRASP quiz (`unlinked`: an earlier import was cut off before it
 * linked them) and can be added by this user. Adding them needs permission to
 * create quizzes, as making the GRASP quiz did.
 */
export function linkableCount(quiz, permissions) {
  if (!permissions?.canCreateQuizzes || !quiz?.existingQuiz) return 0;
  return count(quiz.unlinked);
}

/**
 * Whether importing this quiz has work to do on its own: new questions to
 * save, or earlier ones to add to its existing GRASP quiz. These quizzes are
 * ticked from the start and by "Select all".
 */
export function quizHasWork(quiz, permissions) {
  return count(quiz?.importable) > 0 || linkableCount(quiz, permissions) > 0;
}

/**
 * Whether ticking "Import" on this quiz can do anything: it has work to do, or
 * its questions came in earlier without a GRASP quiz and one can be made now.
 */
export function quizCanBeImported(quiz, permissions) {
  if (quizHasWork(quiz, permissions)) return true;
  return Boolean(
    permissions?.canCreateQuizzes && count(quiz?.alreadyImported) > 0 && !quiz?.existingQuiz
  );
}

// { [quizIdent]: { import, createQuiz } } as the review first shows it.
export function initialSelections(preview) {
  const permissions = preview?.permissions;
  const canCreate = Boolean(permissions?.canCreateQuizzes);
  const selections = {};
  for (const quiz of listOf(preview?.quizzes)) {
    const inCourse = count(quiz.importable) + count(quiz.alreadyImported) + count(quiz.unlinked);
    selections[quiz.ident] = {
      import: quizHasWork(quiz, permissions),
      createQuiz: canCreate && inCourse > 0,
    };
  }
  return selections;
}

// Ticks or clears "Import" on every quiz with work to do. Quizzes that could
// only gain a GRASP quiz are left as they are: that is a separate choice.
export function withAllImports(preview, selections, on) {
  const next = { ...selections };
  for (const quiz of listOf(preview?.quizzes)) {
    if (!quizHasWork(quiz, preview?.permissions)) continue;
    next[quiz.ident] = { ...next[quiz.ident], import: on };
  }
  return next;
}

// True when every quiz with work to do is ticked.
export function allImportsSelected(preview, selections) {
  const candidates = listOf(preview?.quizzes).filter((quiz) =>
    quizHasWork(quiz, preview?.permissions)
  );
  return candidates.length > 0 && candidates.every((quiz) => selections?.[quiz.ident]?.import);
}

/**
 * The commits to send, in preview order (the server's creation order, so
 * "earlier quiz" in spaced repetition follows Canvas due dates). Quizzes that
 * would change nothing are left out.
 */
export function commitQueue(preview, selections) {
  const permissions = preview?.permissions;
  const canCreate = Boolean(permissions?.canCreateQuizzes);
  const queue = [];
  for (const quiz of listOf(preview?.quizzes)) {
    const selection = selections?.[quiz.ident];
    if (!selection?.import || !quizCanBeImported(quiz, permissions)) continue;
    const createQuiz = canCreate && Boolean(selection.createQuiz);
    if (count(quiz.importable) === 0 && !createQuiz) continue;
    queue.push({ quizIdent: quiz.ident, title: quiz.title, createQuiz });
  }
  return queue;
}

/**
 * Counts for the footer button: `questions` new ones to save, `unlinked`
 * earlier ones to add to existing GRASP quizzes, and the GRASP quizzes to
 * create or add to.
 */
export function summarizeSelection(preview, selections) {
  const permissions = preview?.permissions;
  const byIdent = new Map(listOf(preview?.quizzes).map((quiz) => [quiz.ident, quiz]));
  const summary = { quizzes: 0, questions: 0, unlinked: 0, newQuizzes: 0, updatedQuizzes: 0 };
  for (const entry of commitQueue(preview, selections)) {
    const quiz = byIdent.get(entry.quizIdent);
    summary.quizzes += 1;
    summary.questions += count(quiz.importable);
    if (entry.createQuiz) {
      summary.unlinked += linkableCount(quiz, permissions);
      if (quiz.existingQuiz) summary.updatedQuizzes += 1;
      else summary.newQuizzes += 1;
    }
  }
  return summary;
}

export function importButtonLabel(summary) {
  if (summary.questions > 0) return `Import ${pluralize(summary.questions, "question")}`;
  if (summary.newQuizzes > 0) {
    return `Create ${pluralize(summary.newQuizzes, "GRASP quiz", "GRASP quizzes")}`;
  }
  if (count(summary.unlinked) > 0) {
    return `Add ${pluralize(summary.unlinked, "question")} to ${pluralize(
      summary.updatedQuizzes,
      "GRASP quiz",
      "GRASP quizzes"
    )}`;
  }
  return "Import";
}

/**
 * The review row's note for a quiz whose existing GRASP quiz lacks questions
 * imported earlier: "3 imported questions are not in the GRASP quiz “Thermo 1”
 * yet; importing adds them." Without permission to add them, the note only
 * says they are missing. Empty when nothing is missing.
 */
export function describeUnlinked(quiz, permissions) {
  const missing = count(quiz?.unlinked);
  if (missing === 0 || !quiz?.existingQuiz) return "";
  const subject = missing === 1 ? "1 imported question is" : `${missing} imported questions are`;
  const note = `${subject} not in the GRASP quiz “${quiz.existingQuiz.name}” yet`;
  if (linkableCount(quiz, permissions) === 0) return `${note}.`;
  return `${note}; importing adds ${missing === 1 ? "it" : "them"}.`;
}

// "11 quizzes · 358 of 419 questions can be imported · 61 skipped"
export function describePreviewSummary(preview) {
  const totals = preview?.totals || {};
  const parts = [
    pluralize(count(totals.quizzes), "quiz", "quizzes"),
    `${count(totals.importable)} of ${pluralize(count(totals.items), "question")} can be imported`,
  ];
  if (count(totals.skipped) > 0) parts.push(`${totals.skipped} skipped`);
  if (count(totals.alreadyImported) > 0) parts.push(`${totals.alreadyImported} already imported`);
  return parts.join(" · ");
}

export function describeRemoteImages(preview) {
  const images = count(preview?.totals?.remoteImages);
  if (images === 0) return "";
  return `${pluralize(images, "image")} will be downloaded from Canvas.`;
}

// "26 questions in 6 groups · 20 to import · 4 already imported"
export function describeQuizCounts(quiz) {
  const parts = [
    `${pluralize(count(quiz?.items), "question")} in ${pluralize(listOf(quiz?.slots).length, "group")}`,
    `${count(quiz?.importable)} to import`,
  ];
  if (count(quiz?.alreadyImported) > 0) parts.push(`${quiz.alreadyImported} already imported`);
  return parts.join(" · ");
}

// Slot names carry their quiz title ("A01 – Q03"); inside that quiz's own row
// the group part is enough.
export function slotLabel(slotName, quizTitle) {
  const name = String(slotName || "");
  const prefix = `${quizTitle} – `;
  return quizTitle && name.startsWith(prefix) && name.length > prefix.length
    ? name.slice(prefix.length)
    : name;
}

const skipReasonOf = (entry) => String(entry?.reason || "Not imported");

// [{ reason, count }], most common first, ties in alphabetical order.
export function describeSkipReasonCounts(skipped) {
  const counts = new Map();
  for (const entry of listOf(skipped)) {
    const reason = skipReasonOf(entry);
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return Array.from(counts, ([reason, n]) => ({ reason, count: n })).sort(
    (a, b) => b.count - a.count || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0)
  );
}

/**
 * One quiz's skipped items by reason, naming the groups they came from:
 * [{ reason, count, slots: ["Q03 (9)", "Question 4"] }]. A group with several
 * skipped variants is named once, with how many.
 */
export function groupSkippedByReason(skipped, quizTitle) {
  return describeSkipReasonCounts(skipped).map(({ reason, count: n }) => {
    const perSlot = new Map();
    for (const entry of listOf(skipped)) {
      if (skipReasonOf(entry) !== reason) continue;
      const label = slotLabel(entry.slotName, quizTitle);
      perSlot.set(label, (perSlot.get(label) || 0) + 1);
    }
    const slots = Array.from(perSlot, ([label, times]) => (times > 1 ? `${label} (${times})` : label));
    return { reason, count: n, slots };
  });
}

// The Draft lists in the review and the result hold only the questions the
// import flagged, each with its reasons, so they are headed as the Drafts to
// check. The result's "Saved as Draft" total counts every Draft, which for
// someone who can't approve is every question imported.

// "Will be saved as Draft to check (2)", or "" when nothing in the quiz is flagged.
export function predictedDraftsLabel(quiz) {
  const flagged = listOf(quiz?.predictedDrafts).length;
  return flagged > 0 ? `Will be saved as Draft to check (${flagged})` : "";
}

// The result screen's totals, as [label, value] rows.
export function resultTotalsRows(totals) {
  return [
    ["Questions imported", count(totals?.questions)],
    ["Approved", count(totals?.approved)],
    ["Saved as Draft", count(totals?.drafts)],
    ["Learning objectives created", count(totals?.objectives)],
    ["GRASP quizzes created", count(totals?.quizzesCreated)],
    ["GRASP quizzes updated", count(totals?.quizzesUpdated)],
    ["Already imported", count(totals?.alreadyImported)],
    ["Skipped", count(totals?.skipped)],
    ["Images that could not be imported", count(totals?.imageFailures)],
  ];
}

// "Drafts to check (2)" across a whole run (mergeCommitReports), or "" when
// nothing was flagged.
export function draftsToCheckLabel(result) {
  const flagged = listOf(result?.quizzes).reduce(
    (sum, quiz) => sum + listOf(quiz?.drafts).length,
    0
  );
  return flagged > 0 ? `Drafts to check (${flagged})` : "";
}

// "Importing quiz 3 of 11: A03 Kinetics"
export function describeImportProgress({ index, total, title }) {
  return `Importing quiz ${index} of ${total}: ${title}`;
}

/**
 * Totals and a per-quiz list across one import run. `reports` are the commit
 * responses; `errors` are the quizzes whose request failed outright
 * ([{ quizIdent, title, message }]).
 */
export function mergeCommitReports(reports, errors = []) {
  const totals = {
    questions: 0,
    approved: 0,
    drafts: 0,
    objectives: 0,
    quizzesCreated: 0,
    quizzesUpdated: 0,
    alreadyImported: 0,
    skipped: 0,
    imageFailures: 0,
    failures: 0,
    failedQuizzes: listOf(errors).length,
  };
  const allSkipped = [];
  const quizzes = listOf(reports).map((report) => {
    const created = report?.created || {};
    const quiz = {
      quizIdent: report?.quizIdent,
      title: report?.title || "",
      created: {
        questions: count(created.questions),
        approved: count(created.approved),
        drafts: count(created.drafts),
        objectives: count(created.objectives),
      },
      alreadyImported: count(report?.alreadyImported),
      skipped: listOf(report?.skipped),
      drafts: listOf(report?.drafts),
      failures: listOf(report?.failures),
      imageFailures: tally(report?.imageFailures),
      quiz: report?.quiz || null,
    };
    totals.questions += quiz.created.questions;
    totals.approved += quiz.created.approved;
    totals.drafts += quiz.created.drafts;
    totals.objectives += quiz.created.objectives;
    totals.alreadyImported += quiz.alreadyImported;
    totals.skipped += quiz.skipped.length;
    totals.imageFailures += quiz.imageFailures;
    totals.failures += quiz.failures.length;
    if (quiz.quiz?.created) totals.quizzesCreated += 1;
    else if (quiz.quiz) totals.quizzesUpdated += 1;
    allSkipped.push(...quiz.skipped);
    return quiz;
  });
  return {
    totals,
    quizzes,
    errors: listOf(errors),
    skipReasons: describeSkipReasonCounts(allSkipped),
  };
}

/**
 * Sends one commit per quiz, one after another: the server creates each GRASP
 * quiz as it goes, and their creation order decides "earlier quiz". A failed
 * quiz does not stop the others unless the failure would repeat for all of
 * them. `commitOne(entry)` resolves with that quiz's CommitReport;
 * `onProgress({ index, total, quizIdent, title, status, message? })` reports
 * each quiz as "importing", then "imported" or "failed".
 */
export async function commitQuizzesInOrder(queue, commitOne, onProgress) {
  const reports = [];
  const errors = [];
  const total = queue.length;
  let stopMessage = null;

  for (let i = 0; i < total; i += 1) {
    const { quizIdent, title } = queue[i];
    const step = { index: i + 1, total, quizIdent, title };
    if (stopMessage) {
      errors.push({ quizIdent, title, message: stopMessage });
      onProgress?.({ ...step, status: "failed", message: stopMessage });
      continue;
    }
    onProgress?.({ ...step, status: "importing" });
    try {
      reports.push(await commitOne(queue[i]));
      onProgress?.({ ...step, status: "imported" });
    } catch (error) {
      const message = error?.message || "The Canvas import failed.";
      if (STOP_STATUSES.has(error?.status)) stopMessage = message;
      errors.push({ quizIdent, title, message });
      onProgress?.({ ...step, status: "failed", message });
    }
  }
  return { reports, errors };
}

// Text fields go before the file so they are on req.body whenever multer's
// file handling runs.
export function canvasPreviewForm(file, courseId) {
  const form = new FormData();
  form.append("courseId", courseId);
  form.append("file", file);
  return form;
}

export function canvasCommitForm(file, courseId, { quizIdent, createQuiz }) {
  const form = new FormData();
  form.append("courseId", courseId);
  form.append("quizIdent", quizIdent);
  form.append("createQuiz", createQuiz ? "true" : "false");
  form.append("file", file);
  return form;
}
