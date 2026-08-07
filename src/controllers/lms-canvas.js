const { hasStaffAccessInCourse } = require('../utils/course-access');
const { isAppAdministrator } = require('../utils/auth');
const {
  getCourseSections,
  getSectionsOwnedByUser,
} = require('../services/course-section');
const lmsSectionLinkService = require('../services/lms-section-link');

function createCanvasController(canvas) {
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
          error: 'You can only manage LMS links for sections that you own',
        });
      }

      req.localCourseSection = section;
      next();
    } catch (error) {
      next(error);
    }
  }

  function getStatus(_req, res) {
    res.json({
      success: true,
      configured: true,
      connected: true,
      canvasDomain: process.env.CANVAS_DOMAIN,
    });
  }

  async function listAvailableCourses(req, res, next) {
    try {
      const courses = await getTeacherCourses(req.canvasApi);
      res.json({ success: true, courses: courses.map(publicCourse) });
    } catch (error) {
      sendCanvasApiError(error, res, next);
    }
  }

  async function listCanvasSections(req, res, next) {
    try {
      const canvasCourseId = String(req.params.canvasCourseId);
      const courses = await getTeacherCourses(req.canvasApi);
      if (!courses.some((course) => String(course.id) === canvasCourseId)) {
        return res.status(403).json({
          success: false,
          error: 'Your connected Canvas account does not teach that course',
        });
      }

      const sections = await canvas.getCourseSections(
        req.canvasApi,
        canvasCourseId
      );
      res.json({
        success: true,
        sections: sections.map(({ id, name, courseId }) => ({
          id: String(id),
          name: String(name || ''),
          courseId: String(courseId),
        })),
      });
    } catch (error) {
      sendCanvasApiError(error, res, next);
    }
  }

  async function setSectionLink(req, res, next) {
    try {
      const canvasCourseId = String(req.body?.canvasCourseId || '').trim();
      const requestedSectionId = String(req.body?.canvasSectionId || '').trim();
      if (!canvasCourseId) {
        return res.status(400).json({
          success: false,
          error: 'Canvas course ID is required',
        });
      }

      const courses = await getTeacherCourses(req.canvasApi);
      const selectedCourse = courses.find(
        (course) => String(course.id) === canvasCourseId
      );
      if (!selectedCourse) {
        return res.status(403).json({
          success: false,
          error: 'Your connected Canvas account does not teach that course',
        });
      }

      const sections = await canvas.getCourseSections(req.canvasApi, canvasCourseId);
      if (sections.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'That Canvas course has no sections available to link',
        });
      }
      if (sections.length > 1 && !requestedSectionId) {
        return res.status(400).json({
          success: false,
          error: 'Select a Canvas section',
        });
      }

      const selectedSection = sections.length === 1 && !requestedSectionId
        ? sections[0]
        : sections.find((section) => String(section.id) === requestedSectionId);
      if (!selectedSection) {
        return res.status(400).json({
          success: false,
          error: 'The selected Canvas section is not part of that course',
        });
      }

      const userId = req.user?._id || req.user?.id;
      const link = await lmsSectionLinkService.setCanvasSectionLink(
        req.params.courseId,
        req.params.sectionId,
        selectedCourse,
        selectedSection,
        userId
      );
      if (!link) {
        return res.status(404).json({
          success: false,
          error: 'GRASP section not found',
        });
      }

      res.json({ success: true, link });
    } catch (error) {
      sendCanvasApiError(error, res, next);
    }
  }

  async function removeSectionLink(req, res, next) {
    try {
      const removed = await lmsSectionLinkService.removeSectionLmsLink(
        req.params.courseId,
        req.params.sectionId
      );
      if (!removed) {
        return res.status(404).json({
          success: false,
          error: 'GRASP section not found',
        });
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }

  function getTeacherCourses(canvasApi) {
    return canvas.getCourses(canvasApi, { enrollment_type: 'teacher' });
  }

  function publicCourse({ id, name, code }) {
    return {
      id: String(id),
      name: String(name || ''),
      code: String(code || ''),
    };
  }

  function sendCanvasApiError(error, res, next) {
    if (!(error instanceof canvas.CanvasApiError)) return next(error);

    if (error.statusCode === 401) {
      return res.status(401).json({
        success: false,
        connected: false,
        error: 'Your Canvas connection has expired. Reconnect Canvas and try again.',
      });
    }
    if (error.statusCode === 403) {
      return res.status(403).json({
        success: false,
        error: 'Your connected Canvas account does not have permission for this course.',
      });
    }
    if (error.statusCode === 404) {
      return res.status(404).json({
        success: false,
        error: 'The requested Canvas resource could not be found.',
      });
    }
    return res.status(502).json({
      success: false,
      error: 'Canvas could not complete the request. Please try again.',
    });
  }

  return {
    getStatus,
    listAvailableCourses,
    listCanvasSections,
    setSectionLink,
    removeSectionLink,
    requireOwnedSection,
  };
}

module.exports = { createCanvasController };
