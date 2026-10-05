// Building the per-section schedule payload for PUT /api/quiz/:id/schedules.
//
// The endpoint replaces the instructor's whole set of rows rather than patching
// one, so every save has to resend the sections it is not touching — otherwise
// scheduling 005 would silently unschedule 002. One window can now be applied
// to several sections at once, which is the same replace with more rows in it,
// so both paths go through here and are covered by tests.

/**
 * A datetime-local input gives a wall-clock string with no zone
 * ("2026-09-30T23:59"). Send the instant it means in the browser's zone, so
 * the server stores the same moment whatever timezone it runs in, and the
 * Canvas due date (issue #125) is the moment the instructor saw.
 */
export function localToIso(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

// Rows carry Dates from the API; the payload only needs the stored values back.
const asRow = (schedule) => ({
  courseSectionId: schedule.courseSectionId,
  releaseDate: schedule.releaseDate,
  expireDate: schedule.expireDate,
});

/**
 * The instructor's rows with `courseSectionIds` dropped — the untouched
 * remainder every save is rebuilt on top of.
 */
export function schedulesWithout(schedules, courseSectionIds) {
  const removed = new Set(courseSectionIds);
  return schedules.filter((s) => !removed.has(s.courseSectionId)).map(asRow);
}

/**
 * Apply one release/expire window to every selected section, leaving the
 * instructor's other sections exactly as they were. Sections that already had a
 * window and were selected again are overwritten — that is what makes
 * "schedule all my sections at once" work on a course that is partly scheduled.
 */
export function applyScheduleWindow(schedules, { courseSectionIds, releaseDate, expireDate }) {
  return [
    ...schedulesWithout(schedules, courseSectionIds),
    ...courseSectionIds.map((courseSectionId) => ({
      courseSectionId,
      releaseDate,
      expireDate,
    })),
  ];
}

/**
 * Options for the section picker: every section the instructor owns, with the
 * already-scheduled ones marked. They stay selectable so one window can be
 * re-applied across the whole course in a single save.
 */
export function sectionPickerOptions(sections, schedules) {
  const scheduled = new Set(schedules.map((s) => s.courseSectionId));
  return sections.map((section) => ({
    value: section._id,
    label: section.sectionNumber || section.sectionId,
    hint: scheduled.has(section._id) ? "Scheduled" : undefined,
  }));
}

// Active / Scheduled (upcoming) / Expired badge for a section's window.
export function scheduleStatus(row, now) {
  const release = new Date(row.releaseDate);
  const expire = new Date(row.expireDate);
  if (now < release) return { label: "Scheduled", cls: "bg-primary/10 text-primary" };
  if (now > expire) return { label: "Expired", cls: "bg-gray-100 text-muted" };
  return { label: "Active", cls: "bg-success/15 text-success" };
}

/**
 * Request body for POST /api/quiz/course/:courseId/schedules/shift, or null
 * when the offset is not a non-zero whole number. Days shift in wall-clock time
 * for the browser's zone, so a 23:59 deadline stays 23:59 across DST.
 */
export function shiftRequestBody({ quizIds, amount, unit, dryRun = false }) {
  const n = Number(amount);
  if (!quizIds.length || !Number.isInteger(n) || n === 0) return null;
  return {
    quizIds,
    amount: n,
    unit,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    dryRun,
  };
}

export function shiftApplyBody(body, previewRows) {
  return {
    ...body,
    dryRun: false,
    expected: previewRows.map(({ quizId, courseSectionId, oldReleaseDate, oldExpireDate }) => ({
      quizId,
      courseSectionId,
      oldReleaseDate,
      oldExpireDate,
    })),
  };
}
