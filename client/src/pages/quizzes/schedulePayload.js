// Building the per-section schedule payload for PUT /api/quiz/:id/schedules.
//
// The endpoint replaces the instructor's whole set of rows rather than patching
// one, so every save has to resend the sections it is not touching — otherwise
// scheduling 005 would silently unschedule 002. One window can now be applied
// to several sections at once, which is the same replace with more rows in it,
// so both paths go through here and are covered by tests.

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
