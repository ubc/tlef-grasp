const { hasStaffAccessInCourse } = require('../utils/course-access');
const {
  assertCoInstructorPermission,
  PERMISSION_KEYS,
} = require('../utils/co-instructor-permissions');
const { assertTaPermission, TA_PERMISSION_KEYS } = require('../utils/ta-permissions');

/**
 * Gate a `/courses/:courseId/...` route to the people who may add materials to
 * that course: staff access in the course, plus the course-materials permission
 * for co-instructors and TAs. The same three checks file upload makes
 * (controllers/material.js uploadFileHandler).
 */
async function requireCourseMaterialsAccess(req, res, next) {
  try {
    const { courseId } = req.params;
    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({
        success: false,
        error: 'Staff access is not granted in this course',
      });
    }
    if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.COURSE_MATERIALS))) return;
    if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.COURSE_MATERIALS))) return;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requireCourseMaterialsAccess };
