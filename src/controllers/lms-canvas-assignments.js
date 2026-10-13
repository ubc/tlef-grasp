// Canvas assignments for scheduled quizzes (issue #125, #113 item 4).
//
// A scheduled quiz on a Canvas-linked section gets one plain Canvas assignment
// (lms/canvas-assignments.js) so the gradebook has a column for its scores.
// GRASP keeps one row per quiz per section (services/quiz-lms-assignment.js):
// created, or declined so the instructor is not asked again. The browser asks
// before anything is created; due dates are kept in step afterwards.
const quizService = require('../services/quiz');
const quizScheduleService = require('../services/quiz-schedule');
const quizLmsAssignmentService = require('../services/quiz-lms-assignment');
const { getSectionsOwnedByUser } = require('../services/course-section');
const { hasStaffAccessInCourse } = require('../utils/course-access');
const { currentLmsInstance } = require('../lms/instance');
const { canvasApiErrorResponse } = require('../lms/canvas-errors');
const canvasAssignments = require('../lms/canvas-assignments');

const CANVAS_PROVIDER = 'canvas';
const MAX_SECTION_IDS = 200;

const NOT_TEACHER_ERROR = 'Your connected Canvas account does not teach that course';

const { STATUS, publicAssignment } = quizLmsAssignmentService;

// Why a section was left alone, per section, in an ensure response.
const RESULT = Object.freeze({
  CREATED: 'created',
  UPDATED: 'updated',
  UNCHANGED: 'unchanged',
  NOT_LINKED: 'not-linked',
  NOT_SCHEDULED: 'not-scheduled',
  IN_PROGRESS: 'in-progress',
  FAILED: 'failed',
});

function parseSectionIds(body) {
  const ids = body?.courseSectionIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_SECTION_IDS ||
    !ids.every((id) => typeof id === 'string' && id.trim().length > 0)
  ) {
    return null;
  }
  return [...new Set(ids.map((id) => id.trim()))];
}

// A section is usable only when its link points at this deployment's Canvas.
function canvasLinkOf(section, instance) {
  const link = section?.lmsLink;
  if (link?.provider !== CANVAS_PROVIDER) return null;
  if (link.instance && link.instance !== instance) return null;
  return link;
}

function createCanvasAssignmentController(canvas) {
  /**
   * The quiz, the caller's own sections in its course, its schedule and its
   * assignment rows. Answers 403/404 itself and returns null when it did.
   */
  async function loadQuizContext(req, res) {
    const { courseId, quizId } = req.params;
    const userId = req.user?._id || req.user?.id;
    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      res.status(403).json({ success: false, error: 'Staff access is not granted in this course' });
      return null;
    }
    const quiz = await quizService.getQuizById(quizId);
    if (!quiz || String(quiz.courseId) !== String(courseId)) {
      res.status(404).json({ success: false, error: 'Quiz not found' });
      return null;
    }
    const [sections, schedules, rows] = await Promise.all([
      getSectionsOwnedByUser(courseId, userId),
      quizScheduleService.getSchedulesForQuiz(quizId),
      quizLmsAssignmentService.getRowsForQuiz(quizId),
    ]);
    const scheduleBySection = new Map(schedules.map((row) => [String(row.courseSectionId), row]));
    return {
      quiz,
      userId,
      instance: currentLmsInstance(CANVAS_PROVIDER),
      sections,
      sectionById: new Map(sections.map((section) => [String(section._id), section])),
      scheduleBySection,
      rows,
    };
  }

  function describeSection(section, context) {
    const id = String(section._id);
    const schedule = context.scheduleBySection.get(id);
    return {
      courseSectionId: id,
      sectionId: String(section.sectionId),
      sectionNumber: String(section.sectionNumber || section.sectionId || ''),
      linked: !!canvasLinkOf(section, context.instance),
      scheduled: !!schedule,
      expireDate: schedule ? schedule.expireDate : null,
      assignment: publicAssignment(context.rows.get(id)),
    };
  }

  /**
   * GET /courses/:courseId/quizzes/:quizId/assignments
   * Each of the caller's sections: linked, scheduled, and what Canvas holds.
   */
  async function listQuizAssignments(req, res, next) {
    try {
      const context = await loadQuizContext(req, res);
      if (!context) return;
      res.json({
        success: true,
        sections: context.sections.map((section) => describeSection(section, context)),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /courses/:courseId/quizzes/:quizId/assignments  { courseSectionIds }
   * Make Canvas match GRASP for these sections: create the assignment where
   * there is none (the browser has asked the instructor first), and move its
   * due date where the schedule changed. One section failing does not stop the
   * others; a rejected token stops everything with a 401.
   */
  async function ensureQuizAssignments(req, res, next) {
    try {
      const courseSectionIds = parseSectionIds(req.body);
      if (!courseSectionIds) {
        return res.status(400).json({ success: false, error: 'courseSectionIds must be a non-empty array of section ids' });
      }
      const context = await loadQuizContext(req, res);
      if (!context) return;
      if (!courseSectionIds.every((id) => context.sectionById.has(id))) {
        return res.status(403).json({ success: false, error: 'You can only manage sections you own.' });
      }

      // Which Canvas courses the token may write to, checked once per request.
      let teaching = null;
      const teaches = async (canvasCourseId) => {
        if (!teaching) {
          const courses = await canvas.getCourses(req.canvasApi, { enrollment_type: 'teacher' });
          teaching = new Set(courses.map((course) => String(course.id)));
        }
        return teaching.has(String(canvasCourseId));
      };

      const results = [];
      for (const courseSectionId of courseSectionIds) {
        const section = context.sectionById.get(courseSectionId);
        const link = canvasLinkOf(section, context.instance);
        const schedule = context.scheduleBySection.get(courseSectionId);
        if (!link) {
          results.push({ courseSectionId, status: RESULT.NOT_LINKED });
          continue;
        }
        if (!schedule) {
          results.push({ courseSectionId, status: RESULT.NOT_SCHEDULED });
          continue;
        }
        try {
          if (!(await teaches(link.externalCourseId))) {
            results.push({ courseSectionId, status: RESULT.FAILED, error: NOT_TEACHER_ERROR });
            continue;
          }
          const existing = context.rows.get(courseSectionId);
          const result =
            existing?.status === STATUS.CREATED
              ? await syncDueDate(req, context, section, link, schedule, existing)
              : await createForSection(req, context, section, link, schedule);
          results.push({ courseSectionId, ...result });
        } catch (error) {
          const canvasError = canvasApiErrorResponse(canvas, error);
          // Nothing else will succeed with this token; the browser needs the
          // reconnect signal more than a per-section list.
          if (canvasError?.status === 401) return res.status(401).json(canvasError.body);
          console.error(`Canvas assignment for quiz ${context.quiz._id} section ${courseSectionId} failed:`, error);
          results.push({
            courseSectionId,
            status: RESULT.FAILED,
            error: canvasError ? canvasError.body.error : 'GRASP could not update Canvas. Please try again.',
          });
        }
      }

      // Rows changed above; answer with the current state alongside the outcomes.
      context.rows = await quizLmsAssignmentService.getRowsForQuiz(context.quiz._id);
      res.json({
        success: true,
        results,
        sections: context.sections.map((section) => describeSection(section, context)),
      });
    } catch (error) {
      next(error);
    }
  }

  async function createForSection(req, context, section, link, schedule) {
    const claim = await quizLmsAssignmentService.claimRow({
      quizId: context.quiz._id,
      courseSectionId: section._id,
      courseId: context.quiz.courseId,
      provider: CANVAS_PROVIDER,
      instance: context.instance,
      externalCourseId: link.externalCourseId,
      externalSectionId: link.externalSectionId,
      userId: context.userId,
    });
    if (!claim) {
      // Another request got there first: either it is still creating, or it
      // has finished and the assignment exists now.
      const rows = await quizLmsAssignmentService.getRowsForQuiz(context.quiz._id);
      const row = rows.get(String(section._id));
      if (row?.status === STATUS.CREATED) {
        return syncDueDate(req, context, section, link, schedule, row);
      }
      return { status: RESULT.IN_PROGRESS };
    }

    const name = canvasAssignments.assignmentName(context.quiz, section);
    const dueAt = schedule.expireDate;
    try {
      // A create whose answer was lost must not be repeated: reuse an
      // assignment that already carries this exact name.
      let assignment = await canvasAssignments.findAssignmentByName(req.canvasApi, link.externalCourseId, name);
      let override = null;
      if (assignment) {
        override = await canvasAssignments.findSectionOverride(req.canvasApi, link.externalCourseId, assignment.id, link.externalSectionId);
        if (!override) {
          override = await canvasAssignments.createSectionOverride(req.canvasApi, link.externalCourseId, assignment.id, {
            canvasSectionId: link.externalSectionId,
            dueAt,
          });
        } else if (!canvasAssignments.sameInstant(override.due_at, dueAt)) {
          override = await canvasAssignments.updateOverrideDueAt(req.canvasApi, link.externalCourseId, assignment.id, override.id, dueAt);
        }
      } else {
        assignment = await canvasAssignments.createAssignment(req.canvasApi, link.externalCourseId, {
          name,
          description: canvasAssignments.assignmentDescription(canvasAssignments.quizUrlFromEnv()),
          canvasSectionId: link.externalSectionId,
          dueAt,
        });
        override = await canvasAssignments.findSectionOverride(req.canvasApi, link.externalCourseId, assignment.id, link.externalSectionId);
      }

      await quizLmsAssignmentService.markCreated(claim.row._id, {
        externalAssignmentId: assignment.id,
        externalOverrideId: override ? override.id : null,
        name,
        htmlUrl: assignment.html_url || null,
        dueAt,
      });
      return { status: RESULT.CREATED };
    } catch (error) {
      try {
        await quizLmsAssignmentService.releaseClaim(claim.row, claim.previousStatus, error);
      } catch (releaseError) {
        console.error('Could not release a Canvas assignment claim:', releaseError);
      }
      throw error;
    }
  }

  async function syncDueDate(req, context, section, link, schedule, row) {
    const dueAt = schedule.expireDate;
    if (canvasAssignments.sameInstant(row.dueAt, dueAt) && !row.lastError) {
      return { status: RESULT.UNCHANGED };
    }
    try {
      let overrideId = row.externalOverrideId;
      if (overrideId) {
        await canvasAssignments.updateOverrideDueAt(req.canvasApi, link.externalCourseId, row.externalAssignmentId, overrideId, dueAt);
      } else {
        // The override was never recorded (or was removed in Canvas): find it
        // again, or put it back.
        const found = await canvasAssignments.findSectionOverride(req.canvasApi, link.externalCourseId, row.externalAssignmentId, link.externalSectionId);
        if (found) {
          overrideId = found.id;
          if (!canvasAssignments.sameInstant(found.due_at, dueAt)) {
            await canvasAssignments.updateOverrideDueAt(req.canvasApi, link.externalCourseId, row.externalAssignmentId, overrideId, dueAt);
          }
        } else {
          const created = await canvasAssignments.createSectionOverride(req.canvasApi, link.externalCourseId, row.externalAssignmentId, {
            canvasSectionId: link.externalSectionId,
            dueAt,
          });
          overrideId = created.id;
        }
      }
      await quizLmsAssignmentService.markSynced(row._id, { dueAt, externalOverrideId: overrideId });
      return { status: RESULT.UPDATED };
    } catch (error) {
      try {
        await quizLmsAssignmentService.markSyncFailed(row._id, error);
      } catch (markError) {
        console.error('Could not record a Canvas due-date sync failure:', markError);
      }
      throw error;
    }
  }

  /**
   * PUT /courses/:courseId/quizzes/:quizId/assignments/declined  { courseSectionIds }
   * The instructor said no: remember it so these sections are not asked again.
   * Each section's schedule chip still offers "Create in Canvas".
   */
  async function declineQuizAssignments(req, res, next) {
    try {
      const courseSectionIds = parseSectionIds(req.body);
      if (!courseSectionIds) {
        return res.status(400).json({ success: false, error: 'courseSectionIds must be a non-empty array of section ids' });
      }
      const context = await loadQuizContext(req, res);
      if (!context) return;
      if (!courseSectionIds.every((id) => context.sectionById.has(id))) {
        return res.status(403).json({ success: false, error: 'You can only manage sections you own.' });
      }
      const declined = await quizLmsAssignmentService.markDeclined({
        quizId: context.quiz._id,
        courseSectionIds,
        courseId: context.quiz.courseId,
        provider: CANVAS_PROVIDER,
        instance: context.instance,
        userId: context.userId,
      });
      context.rows = await quizLmsAssignmentService.getRowsForQuiz(context.quiz._id);
      res.json({
        success: true,
        declined,
        sections: context.sections.map((section) => describeSection(section, context)),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /courses/:courseId/sections/:sectionId/quiz-assignments
   * The quizzes scheduled on one section (just linked, typically) and whether
   * each has a Canvas assignment. requireOwnedSection has set
   * req.localCourseSection.
   */
  async function listSectionQuizAssignments(req, res, next) {
    try {
      const section = req.localCourseSection;
      const instance = currentLmsInstance(CANVAS_PROVIDER);
      const [schedules, rows, quizzes] = await Promise.all([
        quizScheduleService.getSchedulesForSection(section._id),
        quizLmsAssignmentService.getRowsForSection(section._id),
        quizService.getQuizzesByCourse(req.params.courseId),
      ]);
      const quizById = new Map(quizzes.map((quiz) => [String(quiz._id), quiz]));
      const scheduled = schedules
        .map((schedule) => ({ schedule, quiz: quizById.get(String(schedule.quizId)) }))
        .filter(({ quiz }) => quiz)
        .sort((a, b) => new Date(a.schedule.expireDate) - new Date(b.schedule.expireDate));

      res.json({
        success: true,
        section: {
          courseSectionId: String(section._id),
          sectionId: String(section.sectionId),
          sectionNumber: String(section.sectionNumber || section.sectionId || ''),
          linked: !!canvasLinkOf(section, instance),
        },
        quizzes: scheduled.map(({ schedule, quiz }) => ({
          quizId: String(quiz._id),
          name: String(quiz.name || ''),
          expireDate: schedule.expireDate,
          assignment: publicAssignment(rows.get(String(quiz._id))),
        })),
      });
    } catch (error) {
      next(error);
    }
  }

  return {
    listQuizAssignments,
    ensureQuizAssignments,
    declineQuizAssignments,
    listSectionQuizAssignments,
  };
}

module.exports = { createCanvasAssignmentController, RESULT };
