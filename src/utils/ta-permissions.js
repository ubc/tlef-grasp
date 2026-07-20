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
 * Faculty and genuine SAML staff are never restricted by this module — only
 * memberships with courseRole 'ta' are. Keep the keys in sync with
 * client/src/lib/permissions.js (TA_PERMISSIONS).
 */

const { isFaculty } = require('./auth');
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
};

// Course settings are never TA-accessible; not part of the configurable set.
const TA_SETTINGS_KEY = 'settings';

const ALL_TA_PERMISSION_KEYS = Object.values(TA_PERMISSION_KEYS);

/**
 * Expand a stored (possibly partial or missing) permission map into the full
 * effective map for a TA. Missing keys default to true (grandfathered access).
 * @param {Object|null|undefined} stored - membership.taPermissions
 * @returns {Object} key -> boolean for every configurable key
 */
function getEffectiveTaPermissions(stored) {
  const effective = {};
  for (const key of ALL_TA_PERMISSION_KEYS) {
    effective[key] = stored?.[key] !== false;
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
 * Resolve whether a user may use a TA-gated feature in a course. Faculty (and
 * app administrators, via isFaculty) always may; so does anyone whose
 * membership is not a TA membership — genuine staff scoping is handled by
 * hasStaffAccessInCourse, not here. Only TAs are checked against their map.
 * @param {Object} user - The authenticated user (req.user)
 * @param {string} courseId - The course the action targets
 * @param {string} key - One of TA_PERMISSION_KEYS (or 'settings')
 * @returns {Promise<boolean>}
 */
async function hasTaPermission(user, courseId, key) {
  if (!user || !courseId) return false;

  if (await isFaculty(user)) return true;

  const membership = await getUserCourseMembership(user._id || user.id, courseId);
  if (membership?.courseRole !== TA_COURSE_ROLE) return true;

  if (key === TA_SETTINGS_KEY) return false;
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
  getEffectiveTaPermissions,
  sanitizeTaPermissions,
  hasTaPermission,
  assertTaPermission,
};
