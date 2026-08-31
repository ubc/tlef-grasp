// Academic-period formatting, shared by the "My Sections" table and the course
// switcher. Both render the same underlying fields (academicPeriod, a bare code
// like "2025W1", and academicPeriodName, the readable title the UBC API returns
// when it has one), so the fallback chain lives here rather than in each view.

// "2025W1" -> "2025 Winter1". Returns "" for anything that is not a period code,
// so callers can decide what an unknown period should read as.
export function formatPeriodCode(code) {
  const raw = code || "";
  if (raw.length < 5) return "";
  const year = raw.substring(0, 4);
  const term = raw.substring(4);
  if (term.startsWith("W")) return `${year} Winter${term.substring(1)}`;
  if (term.startsWith("S")) return `${year} Summer${term.substring(1)}`;
  return "";
}

// Readable period, or "" when nothing is known. Prefer this where the label is
// decoration that can simply be omitted — e.g. the course switcher.
export function periodLabel(source) {
  if (!source) return "";
  if (source.academicPeriodName) return source.academicPeriodName;
  return formatPeriodCode(source.academicPeriod) || source.academicPeriod || "";
}

// Readable period, falling back to a literal "Unknown". Prefer this in a table
// where a blank cell would look like a rendering bug.
export function prettyPeriod(source) {
  return periodLabel(source) || "Unknown";
}

// One-line label for a course in the switcher, e.g.
//   "Introduction to Statistics (Section 2 shell) — 2025 Winter1"
// The real course name always leads: a nickname is there to disambiguate two
// shells of the same course, not to replace the name students know it by. Both
// the nickname and the period are dropped when absent, so a course with neither
// reads exactly as it did before.
export function courseLabel(course) {
  if (!course) return "";
  const name = course.name || course.courseName || "Unknown Course";
  const nickname = (course.nickname || "").trim();
  const period = periodLabel(course);

  const named = nickname ? `${name} (${nickname})` : name;
  return period ? `${named} — ${period}` : named;
}
