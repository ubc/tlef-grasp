/**
 * Course-scoped staff/TA access resolution.
 *
 * GRASP's global roles come from the affiliation array (faculty > staff >
 * student). A TA is a student who was promoted by an instructor: they keep
 * the 'student' affiliation, gain 'staff' (so the staff-tier route mounts in
 * server.js admit them), and their course membership document records
 * courseRole: 'ta'. The staffViaTaPromotion flag on the user document marks
 * that the staff affiliation was granted by a promotion rather than by SAML.
 *
 * Staff-level access is course-scoped: a promoted TA only acts as staff in
 * courses where their membership says 'ta'. In every other course they are a
 * regular student. Genuine SAML staff keep staff access in any course they
 * belong to, as before. Role changes are written to the database immediately
 * but sessions snapshot the affiliation at login, so a promotion or demotion
 * takes effect on the affected user's next login.
 */

const { isFaculty, isStaff, parseAffiliations } = require('./auth');
const { getUserCourseMembership } = require('../services/user-course');
const { getUserById } = require('../services/user');

const TA_COURSE_ROLE = 'ta';

/**
 * Whether the user may exercise staff-level powers (upload materials,
 * generate objectives/questions, edit drafts) inside a specific course.
 * Faculty and app administrators always may; staff-affiliated users must be
 * members of the course, and promoted TAs additionally need the 'ta' course
 * role on that membership.
 * @param {Object} user - Authenticated user (req.user)
 * @param {string|ObjectId} courseId - Course the action targets
 * @returns {Promise<boolean>}
 */
async function hasStaffAccessInCourse(user, courseId) {
  if (!user || !courseId) return false;

  if (await isFaculty(user)) return true;
  if (!(await isStaff(user))) return false;

  const userId = user._id || user.id;
  const membership = await getUserCourseMembership(userId, courseId);
  if (!membership) return false;
  if (membership.courseRole === TA_COURSE_ROLE) return true;

  // Staff member without a TA designation here: SAML staff keep course-wide
  // staff access, promoted TAs are ordinary students outside their TA course.
  const dbUser = await getUserById(userId);
  return !dbUser?.staffViaTaPromotion;
}

/**
 * Resolve the role a user effectively holds within one course, for display
 * and for scoping decisions on the Users page.
 * @param {Object} user - User document (needs affiliation, staffViaTaPromotion)
 * @param {Object|null} membership - The user's membership doc for the course
 * @param {boolean} userIsFaculty - Pre-computed isFaculty(user) result
 * @returns {'faculty'|'ta'|'staff'|'student'}
 */
function resolveCourseRole(user, membership, userIsFaculty) {
  if (userIsFaculty) return 'faculty';
  if (membership?.courseRole === TA_COURSE_ROLE) return 'ta';

  const affiliations = parseAffiliations(user);
  if (affiliations.includes('staff')) {
    // A promoted TA outside their TA course is just a student there.
    return user?.staffViaTaPromotion ? 'student' : 'staff';
  }
  return 'student';
}

module.exports = {
  TA_COURSE_ROLE,
  hasStaffAccessInCourse,
  resolveCourseRole,
};
