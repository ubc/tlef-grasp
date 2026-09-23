const { hasStaffAccessInCourse } = require('../utils/course-access');
const { isAppAdministrator } = require('../utils/auth');
const {
  getCourseSections,
  getSectionsOwnedByUser,
} = require('../services/course-section');

/**
 * Gate a section-scoped write to the section's owner (a legacy section with no
 * owner counts as the course owner's) or an app administrator. Used by the LMS
 * link routes and by per-section student sync. Sets req.localCourseSection.
 */
async function requireOwnedSection(req, res, next) {
  try {
    const { courseId, sectionId } = req.params;
    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({
        success: false,
        error: 'Staff access is not granted in this course',
      });
    }

    const userId = req.user?._id || req.user?.id;
    const sections = await getSectionsOwnedByUser(courseId, userId);
    let section = sections.find(
      (candidate) => String(candidate.sectionId) === String(sectionId)
    );

    if (!section && (await isAppAdministrator(req.user))) {
      const allSections = await getCourseSections(courseId);
      section = allSections.find(
        (candidate) => String(candidate.sectionId) === String(sectionId)
      );
    }

    if (!section) {
      return res.status(403).json({
        success: false,
        error: 'You can only manage sections that you own',
      });
    }

    req.localCourseSection = section;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requireOwnedSection };
