const lmsSectionLinkService = require('../services/lms-section-link');

function createMoodleController(moodle) {
  function getStatus(_req, res) {
    res.json({
      success: true,
      configured: true,
      connected: true,
      moodleDomain: process.env.MOODLE_DOMAIN,
    });
  }

  async function listAvailableCourses(req, res, next) {
    try {
      const courses = await moodle.getCourses(req.moodleApi);
      res.json({ success: true, courses: courses.map(publicCourse) });
    } catch (error) {
      sendMoodleApiError(error, res, next);
    }
  }

  async function listMoodleGroups(req, res, next) {
    try {
      const moodleCourseId = String(req.params.moodleCourseId);
      const courses = await moodle.getCourses(req.moodleApi);
      if (!courses.some((course) => String(course.id) === moodleCourseId)) {
        return res.status(403).json({
          success: false,
          error: 'Your connected Moodle account cannot access that course',
        });
      }

      const groups = await moodle.getCourseSections(
        req.moodleApi,
        moodleCourseId
      );
      res.json({
        success: true,
        groups: groups.map(({ id, name, courseId }) => ({
          id: String(id),
          name: String(name || ''),
          courseId: String(courseId),
        })),
      });
    } catch (error) {
      sendMoodleApiError(error, res, next);
    }
  }

  async function setSectionLink(req, res, next) {
    try {
      const moodleCourseId = String(req.body?.moodleCourseId || '').trim();
      const requestedGroupId = String(req.body?.moodleGroupId || '').trim();
      if (!moodleCourseId) {
        return res.status(400).json({
          success: false,
          error: 'Moodle course ID is required',
        });
      }

      const courses = await moodle.getCourses(req.moodleApi);
      const selectedCourse = courses.find(
        (course) => String(course.id) === moodleCourseId
      );
      if (!selectedCourse) {
        return res.status(403).json({
          success: false,
          error: 'Your connected Moodle account cannot access that course',
        });
      }

      const groups = await moodle.getCourseSections(req.moodleApi, moodleCourseId);
      if (groups.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'That Moodle course has no groups available to link',
        });
      }
      if (groups.length > 1 && !requestedGroupId) {
        return res.status(400).json({
          success: false,
          error: 'Select a Moodle group',
        });
      }

      const selectedGroup = groups.length === 1 && !requestedGroupId
        ? groups[0]
        : groups.find((group) => String(group.id) === requestedGroupId);
      if (!selectedGroup) {
        return res.status(400).json({
          success: false,
          error: 'The selected Moodle group is not part of that course',
        });
      }

      const userId = req.user?._id || req.user?.id;
      const link = await lmsSectionLinkService.setMoodleSectionLink(
        req.params.courseId,
        req.params.sectionId,
        selectedCourse,
        selectedGroup,
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
      sendMoodleApiError(error, res, next);
    }
  }

  function publicCourse({ id, name, code }) {
    return {
      id: String(id),
      name: String(name || ''),
      code: String(code || ''),
    };
  }

  function sendMoodleApiError(error, res, next) {
    if (!(error instanceof moodle.MoodleApiError)) return next(error);

    if (error.errorcode === 'invalidtoken') {
      return res.status(401).json({
        success: false,
        connected: false,
        error: 'Your Moodle token is no longer valid. Reconnect Moodle and try again.',
      });
    }
    if (error.errorcode === 'nopermissions' || error.errorcode === 'accessdenied') {
      return res.status(403).json({
        success: false,
        error: 'Your connected Moodle account does not have permission for this course.',
      });
    }
    return res.status(502).json({
      success: false,
      error: 'Moodle could not complete the request. Please try again.',
    });
  }

  return {
    getStatus,
    listAvailableCourses,
    listMoodleGroups,
    setSectionLink,
  };
}

module.exports = { createMoodleController };
