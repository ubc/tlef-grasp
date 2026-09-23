const lmsSectionLinkService = require('../services/lms-section-link');
const lmsRosterSyncService = require('../services/lms-roster-sync');
const { getLmsAdapter } = require('../lms/adapters');
const { currentLmsInstance } = require('../lms/instance');
const { LmsRosterError, ROSTER_ERROR_CODES } = require('../lms/roster-errors');

const CANVAS_PROVIDER = 'canvas';
// A confirmed drop list is a list of GRASP user ids; bound it so a request
// body cannot grow without limit.
const MAX_CONFIRM_DROP_IDS = 5000;

const NOT_TEACHER_ERROR = 'Your connected Canvas account does not teach that course';

/**
 * Validate the sync request body.
 * @returns {{ error: string } | { confirmDropUserIds?: string[], skipDrops: boolean }}
 */
function parseSyncBody(body) {
  const { confirmDropUserIds, skipDrops } = body || {};
  if (skipDrops !== undefined && typeof skipDrops !== 'boolean') {
    return { error: 'skipDrops must be a boolean' };
  }
  if (confirmDropUserIds !== undefined) {
    if (
      !Array.isArray(confirmDropUserIds) ||
      confirmDropUserIds.length > MAX_CONFIRM_DROP_IDS ||
      !confirmDropUserIds.every((id) => typeof id === 'string' && id.trim().length > 0)
    ) {
      return { error: 'confirmDropUserIds must be an array of user ids' };
    }
    if (skipDrops === true) {
      return { error: 'Send either confirmDropUserIds or skipDrops, not both' };
    }
  }
  return {
    confirmDropUserIds: confirmDropUserIds?.map((id) => id.trim()),
    skipDrops: skipDrops === true,
  };
}

// Typed roster failures: in every case nothing was applied.
function sendRosterError(error, res) {
  if (error.code === ROSTER_ERROR_CODES.NO_INTEGRATION_IDS) {
    return res.status(422).json({
      success: false,
      code: error.code,
      error:
        'Canvas returned this section\'s students without their SIS integration IDs, so none of them ' +
        'could be matched to GRASP accounts. Your Canvas role needs permission to view SIS data ' +
        '(integration IDs). Nothing was changed.',
    });
  }
  if (error.code === ROSTER_ERROR_CODES.SECTION_SCOPE_UNAVAILABLE) {
    return res.status(502).json({
      success: false,
      code: error.code,
      error:
        'Canvas did not return the section of each enrollment, so GRASP could not tell which ' +
        'students are in this section. Nothing was changed.',
    });
  }
  return res.status(409).json({
    success: false,
    code: error.code,
    error: 'Students cannot be synced from this LMS. Nothing was changed.',
  });
}

function createCanvasController(canvas, { capabilities } = {}) {
  function getStatus(_req, res) {
    res.json({
      success: true,
      configured: true,
      connected: true,
      canvasDomain: process.env.CANVAS_DOMAIN,
      // Which Canvas features this deployment's CANVAS_SCOPES enable; the
      // client hides the others.
      capabilities: {
        link: capabilities?.link !== false,
        rosterSync: capabilities?.rosterSync !== false,
        assignments: capabilities?.assignments !== false,
      },
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
          error: NOT_TEACHER_ERROR,
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
          error: NOT_TEACHER_ERROR,
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

  /**
   * POST /courses/:courseId/sections/:sectionId/sync-students
   * Sync the linked Canvas section's students into this GRASP section, using
   * the clicking instructor's own Canvas token. Body:
   * { confirmDropUserIds?: string[], skipDrops?: boolean }.
   */
  async function syncSectionStudents(req, res, next) {
    try {
      const section = req.localCourseSection;
      const link = section?.lmsLink;
      if (link?.provider !== CANVAS_PROVIDER) {
        return res.status(409).json({
          success: false,
          error: 'This section is not linked to Canvas.',
        });
      }

      const instance = currentLmsInstance(CANVAS_PROVIDER);
      // Legacy links carry no instance and are taken to be this deployment's
      // Canvas; the sync backfills it.
      if (link.instance && link.instance !== instance) {
        return res.status(409).json({
          success: false,
          error: 'This section is linked to a different Canvas instance. Re-link it.',
        });
      }

      const body = parseSyncBody(req.body);
      if (body.error) {
        return res.status(400).json({ success: false, error: body.error });
      }

      // Linking checked this once; the token may belong to someone else now
      // (a co-owner, an administrator) or the enrollment may have ended.
      const courses = await getTeacherCourses(req.canvasApi);
      if (!courses.some((course) => String(course.id) === String(link.externalCourseId))) {
        return res.status(403).json({ success: false, error: NOT_TEACHER_ERROR });
      }

      const { roster, coverage } = await getLmsAdapter(CANVAS_PROVIDER).getSectionRoster({
        client: req.canvasApi,
        link,
      });

      const result = await lmsRosterSyncService.syncSectionRoster({
        courseId: req.params.courseId,
        section,
        provider: CANVAS_PROVIDER,
        instance,
        roster,
        coverage,
        actorUserId: req.user?._id || req.user?.id,
        confirmDropUserIds: body.confirmDropUserIds,
        skipDrops: body.skipDrops,
      });

      res.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof LmsRosterError) return sendRosterError(error, res);
      sendCanvasApiError(error, res, next);
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

    // Canvas answers both an expired/revoked token and a call outside the
    // token's scopes ("Insufficient scopes on access token.") with 401, and
    // CanvasApiError keeps only the status, so the message covers both.
    if (error.statusCode === 401) {
      return res.status(401).json({
        success: false,
        connected: false,
        error:
          'Canvas rejected the request. Reconnect Canvas; if this keeps happening, ' +
          'the GRASP Canvas developer key may be missing a permission.',
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
    syncSectionStudents,
  };
}

module.exports = { createCanvasController };
