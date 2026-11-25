/**
 * TA permission enforcement (backend).
 *
 * A promoted TA holds staff-tier access only inside their TA course (see
 * utils/course-access.js). This module adds a second, finer layer: the
 * instructor can grant or withhold individual capabilities per TA, stored on
 * the membership document as `taPermissions` (a key -> boolean map).
 *
 * An absent map or key means "allowed", so existing TAs keep the full access
 * they had before this feature shipped, and instructors dial back from there.
 * The one exception is `settings`: TAs may never open or edit course settings
 * (that is where their own permissions are managed), so that key is denied for
 * TAs regardless of the stored map.
 *
 * On top of the map, TAs only ever get the pages in TA_GRANTABLE_PERMISSION_KEYS.
 * Every other key is denied for a TA whatever the stored map says, and the
 * instructor is not offered it. To let TAs use another page, add its key there
 * (and to TA_GRANTABLE_PERMISSION_KEYS in client/src/lib/permissions.js).
 *
 * Faculty and genuine SAML staff are never restricted by this module — only
 * memberships with courseRole 'ta' are. Keep the keys in sync with
 * client/src/lib/permissions.js (TA_PERMISSIONS).
 */

const { isFaculty, isAppAdministrator } = require('./auth');
const { getUserCourseMembership } = require('../services/user-course');
const { TA_COURSE_ROLE } = require('./course-access');

const TA_PERMISSION_KEYS = {
  DASHBOARD: 'dashboard',
  COURSE_MATERIALS: 'courseMaterials',
  QUESTION_GENERATION: 'questionGeneration',
  QUESTION_BANK: 'questionBank',
  QUIZZES: 'quizzes',
  QUIZ_SCORES: 'quizScores',
  QUESTION_FLAGS: 'questionFlags',
  USERS: 'users',
  MY_SECTIONS: 'mySections',
};

// The pages a TA can be granted at all. An instructor may switch any of these
// off for a TA; nothing outside this list can be switched on. Grant TAs a new
// page by adding its key here and in the client's list.
const TA_GRANTABLE_PERMISSION_KEYS = [
  TA_PERMISSION_KEYS.DASHBOARD,
  TA_PERMISSION_KEYS.COURSE_MATERIALS,
  TA_PERMISSION_KEYS.QUESTION_GENERATION,
  TA_PERMISSION_KEYS.QUESTION_BANK,
];

const isTaGrantable = (key) => TA_GRANTABLE_PERMISSION_KEYS.includes(key);

// Course settings are never TA-accessible; not part of the configurable set.
const TA_SETTINGS_KEY = 'settings';

const ALL_TA_PERMISSION_KEYS = Object.values(TA_PERMISSION_KEYS);

/**
 * Expand a stored (possibly partial or missing) permission map into the full
 * effective map for a TA. Keys outside TA_GRANTABLE_PERMISSION_KEYS are always
 * false; a grantable key missing from the map defaults to true.
 * @param {Object|null|undefined} stored - membership.taPermissions
 * @returns {Object} key -> boolean for every configurable key
 */
function getEffectiveTaPermissions(stored) {
  const effective = {};
  for (const key of ALL_TA_PERMISSION_KEYS) {
    effective[key] = isTaGrantable(key) && stored?.[key] !== false;
  }
  return effective;
}

/**
 * Validate an incoming permission map: only known keys, boolean values.
 * @param {*} permissions - Request payload
 * @returns {Object|null} A sanitized map, or null when invalid
 */
function sanitizeTaPermissions(permissions) {
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
    return null;
  }
  const sanitized = {};
  for (const [key, value] of Object.entries(permissions)) {
    if (!ALL_TA_PERMISSION_KEYS.includes(key) || typeof value !== 'boolean') {
      return null;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

/**
 * Resolve whether a user may use a TA-gated feature in a course. App
 * administrators always may. Anyone else must be a member of the course: a
 * non-member is refused here rather than waved through, so this check is safe
 * even where a handler forgets hasStaffAccessInCourse. Faculty members may;
 * so does any member whose membership is not a TA membership. Only TAs are
 * checked against their map.
 * @param {Object} user - The authenticated user (req.user)
 * @param {string} courseId - The course the action targets
 * @param {string} key - One of TA_PERMISSION_KEYS (or 'settings')
 * @returns {Promise<boolean>}
 */
async function hasTaPermission(user, courseId, key) {
  if (!user || !courseId) return false;

  if (await isAppAdministrator(user)) return true;

  const membership = await getUserCourseMembership(user._id || user.id, courseId);
  if (!membership) return false;
  if (await isFaculty(user)) return true;
  if (membership.courseRole !== TA_COURSE_ROLE) return true;

  // Settings and every page outside the grantable list stay closed to TAs.
  if (key === TA_SETTINGS_KEY || !isTaGrantable(key)) return false;
  return membership.taPermissions?.[key] !== false;
}

/**
 * Express guard: verifies the TA permission and, when denied, sends a 403 and
 * returns false so the caller can bail out:
 *   if (!(await assertTaPermission(req, res, courseId, KEY))) return;
 */
async function assertTaPermission(req, res, courseId, key) {
  const allowed = await hasTaPermission(req.user, courseId, key);
  if (!allowed) {
    res.status(403).json({
      success: false,
      error: "Your TA role does not include access to this feature in this course.",
    });
    return false;
  }
  return true;
}

module.exports = {
  TA_PERMISSION_KEYS,
  TA_SETTINGS_KEY,
  ALL_TA_PERMISSION_KEYS,
  TA_GRANTABLE_PERMISSION_KEYS,
  getEffectiveTaPermissions,
  sanitizeTaPermissions,
  hasTaPermission,
  assertTaPermission,
};
