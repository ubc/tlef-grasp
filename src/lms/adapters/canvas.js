const { LmsRosterError, ROSTER_ERROR_CODES } = require('../roster-errors');

// The roster of one linked section is the Canvas students enrolled in that
// section, currently or by pending invitation. Test Student ("student view")
// enrollments carry their own type, so the type check excludes them along with
// TAs, teachers, designers, and observers.
const STUDENT_ENROLLMENT_TYPE = 'StudentEnrollment';
const ROSTER_ENROLLMENT_STATES = ['active', 'invited'];
const ROSTER_ENROLLMENT_STATE_SET = new Set(ROSTER_ENROLLMENT_STATES);

function optionalText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
}

function isSectionStudentEnrollment(enrollment, externalSectionId) {
  return (
    String(enrollment.course_section_id) === String(externalSectionId) &&
    enrollment.type === STUDENT_ENROLLMENT_TYPE &&
    ROSTER_ENROLLMENT_STATE_SET.has(enrollment.enrollment_state)
  );
}

function hasSection(enrollment) {
  return (
    !!enrollment &&
    enrollment.course_section_id !== undefined &&
    enrollment.course_section_id !== null &&
    String(enrollment.course_section_id).trim() !== ''
  );
}

function canvasUserId(enrollment) {
  const id = enrollment.user_id ?? enrollment.user?.id;
  return id === undefined || id === null ? '' : String(id);
}

/**
 * Read the students of the Canvas section a GRASP section is linked to.
 *
 * Reads the course's student enrollments (GET /courses/:id/enrollments, the one
 * roster endpoint in GRASP's Canvas scopes — see lms/canvas-scopes.js) and keeps
 * the ones in the linked section. Canvas always embeds each enrollment's `user`
 * there, with `sis_user_id` / `integration_id` / `login_id` when the token may
 * read SIS data, so no `include[]` parameter is needed (a scoped developer key
 * strips them).
 *
 * @param {Object} params
 * @param {Object} params.client - An authenticated Canvas API client (`req.canvasApi`)
 * @param {{ externalCourseId: string, externalSectionId: string }} params.link
 * @returns {Promise<{ roster: Array, coverage: { total: number, integrationId: number } }>}
 */
async function getSectionRoster({ client, link }) {
  const enrollments = await client.getAll(
    `/courses/${encodeURIComponent(String(link.externalCourseId))}/enrollments`,
    { type: [STUDENT_ENROLLMENT_TYPE], state: ROSTER_ENROLLMENT_STATES }
  );

  // Without each enrollment's section every student would fall through the
  // section filter and the section would look empty, which a sync would read
  // as "everyone dropped". Refuse instead.
  if (enrollments.length > 0 && !enrollments.every(hasSection)) {
    throw new LmsRosterError(
      ROSTER_ERROR_CODES.SECTION_SCOPE_UNAVAILABLE,
      'Canvas returned enrollments without their section, so the students of this section could not be identified.'
    );
  }

  // One student can hold more than one enrollment in a section (e.g. an
  // active one and a pending invitation); they are one roster row.
  const byUser = new Map();
  for (const enrollment of enrollments) {
    if (!isSectionStudentEnrollment(enrollment, link.externalSectionId)) continue;
    const externalUserId = canvasUserId(enrollment);
    if (!externalUserId || byUser.has(externalUserId)) continue;
    const user = enrollment.user || {};
    byUser.set(externalUserId, {
      externalUserId,
      integrationId: optionalText(user.integration_id),
      sisUserId: optionalText(user.sis_user_id) ?? optionalText(enrollment.sis_user_id),
      loginId: optionalText(user.login_id),
      name: optionalText(user.name) || optionalText(user.sortable_name) || '',
      sortableName: optionalText(user.sortable_name),
    });
  }

  const roster = [...byUser.values()];
  return {
    roster,
    coverage: {
      total: roster.length,
      integrationId: roster.filter((row) => row.integrationId).length,
    },
  };
}

module.exports = {
  getSectionRoster,
};
