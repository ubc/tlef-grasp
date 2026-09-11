// Query-string filters that name a row of one specific course.
//
// A course switch re-keys the router outlet, so a page's own state goes with
// the course that produced it. The URL does not: it is not state, and a
// remount leaves it exactly as it was. A filter holding an id from the course
// being left then matches nothing in the new one, and the page renders an
// empty list rather than the switch the user asked for.
//
// Only id-bearing params belong here. Bloom level, status, flagged and the
// search box are plain values that mean the same thing in any course, and the
// tab keeps the user on the view they were already reading.
const COURSE_SCOPED_PARAMS = ["quiz", "objective", "material"];

// The search string to navigate to, or null if nothing needed stripping — the
// caller uses null to skip the navigate rather than repeat the current URL.
export function stripCourseScopedParams(search) {
  const params = new URLSearchParams(search);
  const stripped = COURSE_SCOPED_PARAMS.filter((name) => params.has(name));
  if (stripped.length === 0) return null;

  stripped.forEach((name) => params.delete(name));
  const next = params.toString();
  return next ? `?${next}` : "";
}
