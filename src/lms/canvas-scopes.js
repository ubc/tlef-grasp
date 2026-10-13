// Canvas developer-key scopes, and the GRASP features ("capabilities") each set
// of scopes enables. This is the ONE place that knows which Canvas API endpoints
// GRASP calls; tests/unit/lms-canvas-scopes.test.js drives every Canvas route
// through a recording client and fails if GRASP calls an endpoint that no scope
// below covers, so code and scope list cannot drift apart.
//
// Why scopes matter: a developer key with "Enforce Scopes" on refuses an OAuth
// request that names no scopes, or names one the key lacks (`invalid_scope`), and
// answers any API call outside the token's scopes with 401 "Insufficient scopes
// on access token.". Such a key also strips `include[]` parameters (other than
// `uuid`) unless "Allow Include Parameters" is on, so GRASP never relies on them.
//
// CANVAS_SCOPES (optional env, whitespace- or comma-separated) is the list GRASP
// requests. Unset/empty = request no scopes, which only works on a key WITHOUT
// Enforce Scopes (e.g. local dev), and every capability is on. Set = request
// exactly that list (it must be a subset of the key's scopes); a capability is on
// only when all of its scopes are in the list. Changing CANVAS_SCOPES needs
// instructors to reconnect Canvas: an existing token keeps the scopes it was
// granted.

const CANVAS_CAPABILITY_SCOPES = Object.freeze({
  // Linking a GRASP section to a Canvas section (My Sections → Link Canvas).
  link: Object.freeze([
    // canvas.getCourses(client, { enrollment_type: 'teacher' }) — the courses the
    // instructor teaches, listed for linking and re-checked before saving a link
    // (controllers/lms-canvas.js getTeacherCourses).
    'url:GET|/api/v1/courses',
    // canvas.getCourseSections(client, canvasCourseId) — the sections offered for
    // linking, and re-read to validate the one chosen (controllers/lms-canvas.js
    // listCanvasSections, setSectionLink).
    'url:GET|/api/v1/courses/:course_id/sections',
  ]),

  // Sync from Canvas on a linked section (issue #113).
  rosterSync: Object.freeze([
    // canvas.getCourses(client, { enrollment_type: 'teacher' }) — re-checks that
    // the instructor still teaches the linked Canvas course before reading its
    // roster (controllers/lms-canvas.js syncSectionStudents).
    'url:GET|/api/v1/courses',
    // client.getAll('/courses/:course_id/enrollments', { type: ['StudentEnrollment'],
    // state: ['active', 'invited'] }) — the course's student enrollments, each with
    // its section and embedded user (lms/adapters/canvas.js getSectionRoster).
    'url:GET|/api/v1/courses/:course_id/enrollments',
  ]),

  // Importing course files into Course Materials (issue #141).
  files: Object.freeze([
    // canvas.getCourses(client, { enrollment_type: 'teacher' }) — re-checks that
    // the instructor still teaches the Canvas course before listing or importing
    // its files (controllers/lms-canvas.js listMaterialImportFiles,
    // importMaterialFile).
    'url:GET|/api/v1/courses',
    // canvas.getCourseFiles(client, canvasCourseId, { contentTypes, sort, order })
    // — the course's files offered for import (listMaterialImportFiles).
    'url:GET|/api/v1/courses/:course_id/files',
    // client.get('/courses/:course_id/files/:id') — one file's name, type and size,
    // read before anything is downloaded (importMaterialFile), and again by
    // canvas.downloadFile, which only downloads a file Canvas confirms is in the
    // course.
    'url:GET|/api/v1/courses/:course_id/files/:id',
    // canvas.downloadFile(client, canvasCourseId, fileId, { via: 'public-url' }) —
    // a signed, time-limited download link. The file's own URL
    // (/files/:id/download) is not an /api/v1 path, so no scope can cover it and
    // an Enforce Scopes key is refused there.
    'url:GET|/api/v1/files/:id/public_url',
  ]),

  // A Canvas assignment for each scheduled quiz on a linked section (issue
  // #125, #113 item 4). All calls are in lms/canvas-assignments.js.
  assignments: Object.freeze([
    // canvas.getCourses(client, { enrollment_type: 'teacher' }) — re-checks that
    // the instructor still teaches the linked Canvas course before writing to
    // it (controllers/lms-canvas-assignments.js ensureQuizAssignments).
    'url:GET|/api/v1/courses',
    // findAssignmentByName — an assignment with this name already in the course
    // (`search_term`, no includes), reused instead of created twice.
    'url:GET|/api/v1/courses/:course_id/assignments',
    // createAssignment — the assignment, with its section override inline.
    'url:POST|/api/v1/courses/:course_id/assignments',
    // findSectionOverride — the override's id (the create response does not
    // include it), and the override of a reused assignment.
    'url:GET|/api/v1/courses/:course_id/assignments/:assignment_id/overrides',
    // updateOverrideDueAt — a rescheduled quiz moves the due date.
    'url:PUT|/api/v1/courses/:course_id/assignments/:assignment_id/overrides/:id',
    // createSectionOverride — a reused assignment, or one whose override was
    // removed in Canvas, gets the section override back.
    'url:POST|/api/v1/courses/:course_id/assignments/:assignment_id/overrides',
  ]),
});

const CANVAS_CAPABILITIES = Object.freeze(Object.keys(CANVAS_CAPABILITY_SCOPES));

const SCOPE_FORMAT = /^url:(GET|POST|PUT|PATCH|DELETE)\|\/api\/v1\/\S+$/;

/**
 * Parse CANVAS_SCOPES: whitespace- and/or comma-separated, duplicates dropped,
 * order kept. Entries that do not look like Canvas URL scopes are still sent
 * (Canvas decides), with a warning so a typo is visible in the server log.
 *
 * @param {string|undefined} value
 * @returns {string[]} [] when unset or empty
 */
function parseCanvasScopes(value) {
  const text = typeof value === 'string' ? value : '';
  const scopes = [...new Set(text.split(/[\s,]+/).filter(Boolean))];
  const malformed = scopes.filter((scope) => !SCOPE_FORMAT.test(scope));
  if (malformed.length > 0) {
    console.warn(
      `[canvas] CANVAS_SCOPES has entries that are not Canvas URL scopes (url:METHOD|/api/v1/...): ${malformed.join(', ')}`
    );
  }
  return scopes;
}

/**
 * Which capabilities a requested scope list enables.
 *
 * @param {string[]} scopes - Parsed CANVAS_SCOPES; [] = no scopes requested
 * @returns {{ link: boolean, rosterSync: boolean, files: boolean, assignments: boolean }}
 */
function resolveCanvasCapabilities(scopes) {
  const requested = new Set(scopes || []);
  const unscoped = requested.size === 0;
  return Object.fromEntries(
    CANVAS_CAPABILITIES.map((capability) => [
      capability,
      unscoped || CANVAS_CAPABILITY_SCOPES[capability].every((scope) => requested.has(scope)),
    ])
  );
}

module.exports = {
  CANVAS_CAPABILITIES,
  CANVAS_CAPABILITY_SCOPES,
  parseCanvasScopes,
  resolveCanvasCapabilities,
};
