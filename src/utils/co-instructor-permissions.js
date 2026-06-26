/**
 * Co-instructor permission enforcement (backend, Tier 1: writes/actions).
 *
 * Mirrors the client's useCoInstructorAccess: the course owner and app
 * administrators always have full access. Any other instructor in the course is
 * allowed unless the owner has explicitly turned the permission off (stored in
 * course settings under coInstructorPermissions). An absent map or key means
 * "allowed", so the default is full access and existing co-instructors are
 * unaffected until an owner restricts something.
 *
 * Keep the keys here in sync with client/src/lib/permissions.js.
 */

const { isAppAdministrator } = require('./auth');
const { getCourseById } = require('../services/course');
const settingsService = require('../services/settings');

const PERMISSION_KEYS = {
  COURSE_MATERIALS: 'courseMaterials',
  QUESTION_GENERATION: 'questionGeneration',
  QUESTION_BANK: 'questionBank',
  CREATE_QUIZ: 'createQuiz',
  SETTINGS: 'settings',
};

/**
 * Resolve whether a user may use a gated feature in a course.
 * @param {Object} user - The authenticated user (req.user).
 * @param {string} courseId - The course the action targets.
 * @param {string} key - One of PERMISSION_KEYS.
 * @returns {Promise<boolean>}
 */
async function hasCoInstructorPermission(user, courseId, key) {
  if (!user || !courseId) return false;

  // App administrators always have full access.
  if (await isAppAdministrator(user)) return true;

  const course = await getCourseById(courseId);
  if (!course) return false;

  // The course owner always has full access.
  const userId = String(user._id || user.id || '');
  if (course.owner && String(course.owner) === userId) return true;

  // Otherwise this is a co-instructor: allowed unless explicitly turned off.
  const settings = await settingsService.getSettings(courseId);
  const permissions = settings?.coInstructorPermissions || {};
  return permissions[key] !== false;
}

/**
 * True only for the people who manage a course: the owner and app
 * administrators. Used to protect owner-only settings (e.g. who may change the
 * co-instructor permission map itself).
 * @returns {Promise<boolean>}
 */
async function isCourseManager(user, courseId) {
  if (!user || !courseId) return false;
  if (await isAppAdministrator(user)) return true;
  const course = await getCourseById(courseId);
  if (!course) return false;
  const userId = String(user._id || user.id || '');
  return !!(course.owner && String(course.owner) === userId);
}

/**
 * Express guard: verifies the permission and, when denied, sends a 403 and
 * returns false so the caller can bail out:
 *   if (!(await assertCoInstructorPermission(req, res, courseId, KEY))) return;
 */
async function assertCoInstructorPermission(req, res, courseId, key) {
  const allowed = await hasCoInstructorPermission(req.user, courseId, key);
  if (!allowed) {
    res.status(403).json({
      error: "You don't have permission to perform this action in this course.",
    });
    return false;
  }
  return true;
}

module.exports = {
  PERMISSION_KEYS,
  hasCoInstructorPermission,
  isCourseManager,
  assertCoInstructorPermission,
};
