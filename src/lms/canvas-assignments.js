// The Canvas side of a GRASP quiz's assignment (issue #125): a plain, published
// assignment with no submission type, visible only to the linked Canvas
// section through a section override that carries the due date. Students sit
// the quiz in GRASP; the assignment exists so the gradebook has a column for
// the scores to land in.
//
// Every call here is a raw client call so lms/canvas-scopes.js can name the
// exact endpoints; tests/unit/lms-canvas-scopes.test.js checks they stay within
// the `assignments` capability.

const POINTS_POSSIBLE = 100;

/** The Canvas assignment name for a quiz on one GRASP section. */
function assignmentName(quiz, section) {
  const sectionLabel = String(section?.sectionNumber || section?.sectionId || '').trim();
  return `${String(quiz?.name || 'Quiz').trim()} — ${sectionLabel} (GRASP)`;
}

/** HTML description shown to students in Canvas. */
function assignmentDescription(quizUrl) {
  const link = quizUrl
    ? ` <a href="${escapeHtml(quizUrl)}">Open GRASP</a>`
    : '';
  return (
    '<p>This quiz is taken in GRASP, not in Canvas.' +
    link +
    ' Your score will appear here once your instructor imports it.</p>'
  );
}

// Where "Open GRASP" points: the origin the Canvas developer key redirects to,
// which is this deployment's public address, plus the student quiz page.
function quizUrlFromEnv(env = process.env) {
  try {
    return `${new URL(env.CANVAS_REDIRECT_URI).origin}/quiz`;
  } catch {
    return null;
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Canvas keeps due dates to the second; compare at that precision. */
function sameInstant(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Math.floor(new Date(a).getTime() / 1000) === Math.floor(new Date(b).getTime() / 1000);
}

const toIso = (date) => (date ? new Date(date).toISOString() : null);

/**
 * Whether an assignment looks like one GRASP made: no submission type, so
 * adopting it cannot move the due date of something students hand work in to.
 */
function isGraspShaped(assignment) {
  const types = assignment?.submission_types;
  return Array.isArray(types) && types.length === 1 && types[0] === 'none';
}

/**
 * An assignment already in the course with exactly this name AND no submission
 * type (deleted ones are not listed by Canvas), or null. Used before every
 * create, so a create whose answer was lost is not repeated. The shape check
 * keeps GRASP from attaching to an instructor's own assignment that merely
 * shares the name.
 */
async function findAssignmentByName(client, canvasCourseId, name) {
  const matches = await client.getAll(
    `/courses/${encodeURIComponent(String(canvasCourseId))}/assignments`,
    { search_term: name }
  );
  return matches.find((assignment) => String(assignment.name) === name && isGraspShaped(assignment)) || null;
}

/**
 * Create the assignment with its section override in one request. Canvas's
 * answer does not include the override, so it is read back separately.
 */
async function createAssignment(client, canvasCourseId, { name, description, canvasSectionId, dueAt }) {
  return client.post(`/courses/${encodeURIComponent(String(canvasCourseId))}/assignments`, {
    assignment: {
      name,
      description,
      submission_types: ['none'],
      points_possible: POINTS_POSSIBLE,
      published: true,
      only_visible_to_overrides: true,
      assignment_overrides: [
        { course_section_id: Number(canvasSectionId), due_at: toIso(dueAt) },
      ],
    },
  });
}

/** The override that targets one Canvas section, or null. */
async function findSectionOverride(client, canvasCourseId, assignmentId, canvasSectionId) {
  const overrides = await client.get(
    `/courses/${encodeURIComponent(String(canvasCourseId))}/assignments/${encodeURIComponent(String(assignmentId))}/overrides`
  );
  return (Array.isArray(overrides) ? overrides : []).find(
    (override) => String(override.course_section_id) === String(canvasSectionId)
  ) || null;
}

/** Add a section override to an assignment that lost (or never had) one. */
async function createSectionOverride(client, canvasCourseId, assignmentId, { canvasSectionId, dueAt }) {
  return client.post(
    `/courses/${encodeURIComponent(String(canvasCourseId))}/assignments/${encodeURIComponent(String(assignmentId))}/overrides`,
    { assignment_override: { course_section_id: Number(canvasSectionId), due_at: toIso(dueAt) } }
  );
}

/** Move the override's due date (rescheduling). */
async function updateOverrideDueAt(client, canvasCourseId, assignmentId, overrideId, dueAt) {
  return client.put(
    `/courses/${encodeURIComponent(String(canvasCourseId))}/assignments/${encodeURIComponent(String(assignmentId))}/overrides/${encodeURIComponent(String(overrideId))}`,
    { assignment_override: { due_at: toIso(dueAt) } }
  );
}

module.exports = {
  POINTS_POSSIBLE,
  assignmentName,
  assignmentDescription,
  quizUrlFromEnv,
  sameInstant,
  isGraspShaped,
  findAssignmentByName,
  createAssignment,
  findSectionOverride,
  createSectionOverride,
  updateOverrideDueAt,
};
