// Which course the sidebar should have selected, given what the API says the
// user can reach.
//
// Extracted from the CourseSelector effect because archiving made the rule
// non-obvious: archived courses are deliberately absent from /api/courses/my,
// so a naive "is the selection still in the list?" check ejects an owner the
// instant they open an archived course from the Manage-courses hub. An
// archived course is a valid selection; it is simply never an automatic one.
//
// Returns:
//   action "keep"   — the selection is still reachable, leave it alone
//   action "switch" — fall back to `course` (the first live course)
//   action "clear"  — nothing is reachable; drop the selection so the
//                     onboarding guard sends the user back to the hub
export function resolveCourseSelection({
  selectedCourse,
  courses = [],
  archivedCourses = [],
}) {
  const isLive = selectedCourse
    ? courses.some((course) => course.id === selectedCourse.id)
    : false;
  const isArchived = selectedCourse
    ? archivedCourses.some((course) => course.id === selectedCourse.id)
    : false;

  if (isLive || isArchived) return { action: "keep", isArchived };

  if (courses.length === 0) {
    return selectedCourse
      ? { action: "clear", isArchived: false }
      : { action: "keep", isArchived: false };
  }

  return { action: "switch", course: courses[0], isArchived: false };
}
