// Canvas assignments for scheduled quizzes (issue #125):
//   GET  /courses/:courseId/quizzes/:quizId/assignments
//   POST /courses/:courseId/quizzes/:quizId/assignments            { courseSectionIds }
//   PUT  /courses/:courseId/quizzes/:quizId/assignments/declined   { courseSectionIds }
//   GET  /courses/:courseId/sections/:sectionId/quiz-assignments
// Which Canvas endpoints these call is lms-canvas-scopes.test.js; this file is
// about who may do what, and what GRASP records.
const express = require('express');
const request = require('supertest');

jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn(),
}));
jest.mock('../../src/utils/auth', () => ({
  isAppAdministrator: jest.fn(),
}));
jest.mock('../../src/services/course', () => ({
  getCourseById: jest.fn(),
}));
jest.mock('../../src/services/course-section', () => ({
  getCourseSections: jest.fn(),
  getSectionsOwnedByUser: jest.fn(),
}));
jest.mock('../../src/services/lms-section-link', () => ({
  setCanvasSectionLink: jest.fn(),
}));
jest.mock('../../src/services/quiz', () => ({
  getQuizById: jest.fn(),
  getQuizzesByCourse: jest.fn(),
}));
jest.mock('../../src/services/quiz-schedule', () => ({
  getSchedulesForQuiz: jest.fn(),
  getSchedulesForSection: jest.fn(),
}));
jest.mock('../../src/services/quiz-lms-assignment', () => ({
  ...jest.requireActual('../../src/services/quiz-lms-assignment'),
  getRowsForQuiz: jest.fn(),
  getRowsForSection: jest.fn(),
  claimRow: jest.fn(),
  releaseClaim: jest.fn(),
  markCreated: jest.fn(),
  markSynced: jest.fn(),
  markSyncFailed: jest.fn(),
  markDeclined: jest.fn(),
}));

const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const { isAppAdministrator } = require('../../src/utils/auth');
const { getCourseById } = require('../../src/services/course');
const { getCourseSections, getSectionsOwnedByUser } = require('../../src/services/course-section');
const quizService = require('../../src/services/quiz');
const quizScheduleService = require('../../src/services/quiz-schedule');
const rowsService = require('../../src/services/quiz-lms-assignment');
const { createCanvasRouter } = require('../../src/routes/lms-canvas');

const CANVAS_DOMAIN = 'https://canvas.example.test';
const USER_ID = '507f1f77bcf86cd799439011';
const COURSE_ID = 'course-1';
const QUIZ_ID = 'quiz-1';
const QUIZ_BASE = `/api/lms/canvas/courses/${COURSE_ID}/quizzes/${QUIZ_ID}/assignments`;
const RELEASE = new Date('2026-10-01T07:00:00Z');
const DUE = new Date('2026-11-01T06:59:00Z');

class FakeCanvasApiError extends Error {
  constructor(statusCode) {
    super(`Canvas returned ${statusCode}`);
    this.statusCode = statusCode;
  }
}
class FakeCanvasOAuthError extends Error {}

const linkedSection = (overrides = {}) => ({
  _id: 'sec-linked',
  sectionId: 'SEC-101',
  sectionNumber: '101',
  lmsLink: {
    provider: 'canvas',
    instance: CANVAS_DOMAIN,
    externalCourseId: '42',
    externalSectionId: '501',
  },
  ...overrides,
});
const unlinkedSection = { _id: 'sec-unlinked', sectionId: 'SEC-102', sectionNumber: '102' };

const createdRow = (overrides = {}) => ({
  _id: 'row-1',
  status: 'created',
  externalAssignmentId: '9001',
  externalOverrideId: '77',
  name: 'Quiz 1 — 101 (GRASP)',
  htmlUrl: `${CANVAS_DOMAIN}/courses/42/assignments/9001`,
  dueAt: DUE,
  syncedAt: new Date('2026-10-02T00:00:00Z'),
  ...overrides,
});

function createIntegration({ capabilities, connected = true } = {}) {
  const canvasApi = {
    get: jest.fn(),
    getAll: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
  };
  const canvas = {
    CanvasApiError: FakeCanvasApiError,
    CanvasOAuthError: FakeCanvasOAuthError,
    createAuthRouter: jest.fn(() => express.Router()),
    requireAuth: jest.fn(() => (req, res, next) => {
      if (!connected) {
        return res.status(401).json({ success: false, connected: false });
      }
      req.canvasApi = canvasApi;
      next();
    }),
    getCourses: jest.fn(),
    getCourseSections: jest.fn(),
  };
  return { configured: true, canvas, canvasApi, config: {}, capabilities };
}

function buildApp(integration) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { _id: USER_ID };
    next();
  });
  app.use('/api/lms/canvas', createCanvasRouter(integration));
  return app;
}

describe('Canvas quiz assignment routes', () => {
  const originalDomain = process.env.CANVAS_DOMAIN;
  const originalRedirect = process.env.CANVAS_REDIRECT_URI;
  let integration;
  let app;

  beforeAll(() => {
    process.env.CANVAS_DOMAIN = CANVAS_DOMAIN;
    process.env.CANVAS_REDIRECT_URI = 'https://grasp.example.test/api/lms/canvas/auth/callback';
  });

  afterAll(() => {
    for (const [name, value] of [['CANVAS_DOMAIN', originalDomain], ['CANVAS_REDIRECT_URI', originalRedirect]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    hasStaffAccessInCourse.mockResolvedValue(true);
    isAppAdministrator.mockResolvedValue(false);
    getCourseById.mockResolvedValue({ _id: COURSE_ID, archived: false });
    getSectionsOwnedByUser.mockResolvedValue([linkedSection(), unlinkedSection]);
    getCourseSections.mockResolvedValue([]);
    quizService.getQuizById.mockResolvedValue({ _id: QUIZ_ID, courseId: COURSE_ID, name: 'Quiz 1' });
    quizService.getQuizzesByCourse.mockResolvedValue([{ _id: QUIZ_ID, courseId: COURSE_ID, name: 'Quiz 1' }]);
    quizScheduleService.getSchedulesForQuiz.mockResolvedValue([
      { courseSectionId: 'sec-linked', releaseDate: RELEASE, expireDate: DUE },
      { courseSectionId: 'sec-unlinked', releaseDate: RELEASE, expireDate: DUE },
    ]);
    quizScheduleService.getSchedulesForSection.mockResolvedValue([]);
    rowsService.getRowsForQuiz.mockResolvedValue(new Map());
    rowsService.getRowsForSection.mockResolvedValue(new Map());
    rowsService.claimRow.mockResolvedValue({ row: { _id: 'row-new' }, previousStatus: null });
    rowsService.markDeclined.mockImplementation(async ({ courseSectionIds }) => courseSectionIds);

    integration = createIntegration();
    integration.canvas.getCourses.mockResolvedValue([{ id: 42, name: 'Biology 302' }]);
    integration.canvasApi.getAll.mockResolvedValue([]);
    integration.canvasApi.post.mockImplementation(async (path) =>
      /\/overrides$/.test(path)
        ? { id: 78, course_section_id: 501 }
        : { id: 9001, name: 'Quiz 1 — 101 (GRASP)', html_url: `${CANVAS_DOMAIN}/courses/42/assignments/9001` }
    );
    integration.canvasApi.get.mockResolvedValue([{ id: 77, course_section_id: 501, due_at: DUE.toISOString() }]);
    integration.canvasApi.put.mockResolvedValue({ id: 77, due_at: DUE.toISOString() });
    app = buildApp(integration);
  });

  describe('access', () => {
    const routes = [
      ['GET', QUIZ_BASE, undefined],
      ['POST', QUIZ_BASE, { courseSectionIds: ['sec-linked'] }],
      ['PUT', `${QUIZ_BASE}/declined`, { courseSectionIds: ['sec-linked'] }],
    ];
    const send = (target, method, path, body) => {
      const req = request(target)[method.toLowerCase()](path);
      return body ? req.send(body) : req;
    };

    it.each(routes)('%s %s needs staff access in the course', async (method, path, body) => {
      hasStaffAccessInCourse.mockResolvedValue(false);
      const response = await send(app, method, path, body);
      expect(response.status).toBe(403);
      expect(integration.canvasApi.post).not.toHaveBeenCalled();
    });

    it.each(routes)('%s %s is refused when the scopes do not include assignments', async (method, path, body) => {
      const scoped = createIntegration({ capabilities: { link: true, rosterSync: true, files: true, assignments: false } });
      const response = await send(buildApp(scoped), method, path, body);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('capability-disabled');
    });

    it.each(routes)('%s %s answers 404 for a quiz of another course', async (method, path, body) => {
      quizService.getQuizById.mockResolvedValue({ _id: QUIZ_ID, courseId: 'other-course', name: 'Quiz 1' });
      const response = await send(app, method, path, body);
      expect(response.status).toBe(404);
    });

    it('does not create assignments for an archived course', async () => {
      getCourseById.mockResolvedValue({ _id: COURSE_ID, archived: true });
      const response = await request(app).post(QUIZ_BASE).send({ courseSectionIds: ['sec-linked'] });
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('course_archived');
    });

    it.each([
      ['POST', QUIZ_BASE],
      ['PUT', `${QUIZ_BASE}/declined`],
    ])('%s %s only accepts sections the caller owns', async (method, path) => {
      const response = await request(app)[method.toLowerCase()](path).send({ courseSectionIds: ['sec-linked', 'sec-someone-elses'] });
      expect(response.status).toBe(403);
      expect(response.body.error).toMatch(/sections you own/);
      expect(integration.canvasApi.post).not.toHaveBeenCalled();
      expect(rowsService.markDeclined).not.toHaveBeenCalled();
    });

    it.each([
      ['POST', QUIZ_BASE],
      ['PUT', `${QUIZ_BASE}/declined`],
    ])('%s %s rejects a malformed section list', async (method, path) => {
      for (const body of [{}, { courseSectionIds: [] }, { courseSectionIds: 'sec-linked' }, { courseSectionIds: [1] }]) {
        const response = await request(app)[method.toLowerCase()](path).send(body);
        expect(response.status).toBe(400);
      }
    });
  });

  describe('GET assignments', () => {
    it('describes each owned section: linked, scheduled, and what Canvas holds', async () => {
      rowsService.getRowsForQuiz.mockResolvedValue(new Map([['sec-linked', createdRow()]]));

      const response = await request(app).get(QUIZ_BASE);

      expect(response.status).toBe(200);
      expect(response.body.sections).toEqual([
        {
          courseSectionId: 'sec-linked',
          sectionId: 'SEC-101',
          sectionNumber: '101',
          linked: true,
          scheduled: true,
          expireDate: DUE.toISOString(),
          assignment: {
            status: 'created',
            externalAssignmentId: '9001',
            name: 'Quiz 1 — 101 (GRASP)',
            htmlUrl: `${CANVAS_DOMAIN}/courses/42/assignments/9001`,
            dueAt: DUE.toISOString(),
            syncedAt: '2026-10-02T00:00:00.000Z',
            lastError: null,
          },
        },
        {
          courseSectionId: 'sec-unlinked',
          sectionId: 'SEC-102',
          sectionNumber: '102',
          linked: false,
          scheduled: true,
          expireDate: DUE.toISOString(),
          assignment: null,
        },
      ]);
      expect(integration.canvas.getCourses).not.toHaveBeenCalled();
    });

    it('reports a decline, and treats a link to another Canvas as unlinked', async () => {
      getSectionsOwnedByUser.mockResolvedValue([
        linkedSection({ _id: 'sec-elsewhere', lmsLink: { provider: 'canvas', instance: 'https://other.canvas.test', externalCourseId: '9', externalSectionId: '90' } }),
      ]);
      rowsService.getRowsForQuiz.mockResolvedValue(new Map([['sec-elsewhere', { status: 'declined' }]]));

      const response = await request(app).get(QUIZ_BASE);

      expect(response.body.sections[0]).toEqual(expect.objectContaining({
        linked: false,
        assignment: { status: 'declined', lastError: null },
      }));
    });

    it('hides a claim that is still in progress', async () => {
      rowsService.getRowsForQuiz.mockResolvedValue(new Map([['sec-linked', { status: 'pending' }]]));
      const response = await request(app).get(QUIZ_BASE);
      expect(response.body.sections[0].assignment).toBeNull();
    });
  });

  describe('POST assignments (create)', () => {
    const ensure = (ids = ['sec-linked']) => request(app).post(QUIZ_BASE).send({ courseSectionIds: ids });

    it('creates a published, section-only, 100-point assignment due at the section\'s close time', async () => {
      const response = await ensure();

      expect(response.status).toBe(200);
      expect(response.body.results).toEqual([{ courseSectionId: 'sec-linked', status: 'created' }]);
      expect(integration.canvasApi.post).toHaveBeenCalledWith('/courses/42/assignments', {
        assignment: {
          name: 'Quiz 1 — 101 (GRASP)',
          description: expect.stringContaining('https://grasp.example.test/quiz'),
          submission_types: ['none'],
          points_possible: 100,
          published: true,
          only_visible_to_overrides: true,
          assignment_overrides: [{ course_section_id: 501, due_at: DUE.toISOString() }],
        },
      });
      expect(rowsService.markCreated).toHaveBeenCalledWith('row-new', {
        externalAssignmentId: 9001,
        externalOverrideId: 77,
        name: 'Quiz 1 — 101 (GRASP)',
        htmlUrl: `${CANVAS_DOMAIN}/courses/42/assignments/9001`,
        dueAt: DUE,
      });
    });

    it('claims the row before touching Canvas, with where the assignment will live', async () => {
      await ensure();

      expect(rowsService.claimRow).toHaveBeenCalledWith({
        quizId: QUIZ_ID,
        courseSectionId: 'sec-linked',
        courseId: COURSE_ID,
        provider: 'canvas',
        instance: CANVAS_DOMAIN,
        externalCourseId: '42',
        externalSectionId: '501',
        userId: USER_ID,
      });
      expect(rowsService.claimRow.mock.invocationCallOrder[0])
        .toBeLessThan(integration.canvasApi.post.mock.invocationCallOrder[0]);
    });

    it('reuses an assignment that already carries the name instead of creating a second one', async () => {
      integration.canvasApi.getAll.mockResolvedValue([
        { id: 5000, name: 'Quiz 1 — 101 (GRASP) old', submission_types: ['none'] },
        { id: 9001, name: 'Quiz 1 — 101 (GRASP)', submission_types: ['none'], html_url: `${CANVAS_DOMAIN}/courses/42/assignments/9001` },
      ]);

      const response = await ensure();

      expect(response.body.results[0].status).toBe('created');
      expect(integration.canvasApi.post).not.toHaveBeenCalled();
      expect(integration.canvasApi.get).toHaveBeenCalledWith('/courses/42/assignments/9001/overrides');
      expect(rowsService.markCreated).toHaveBeenCalledWith('row-new', expect.objectContaining({
        externalAssignmentId: 9001,
        externalOverrideId: 77,
      }));
    });

    // A same-named assignment students submit work to is the instructor's own;
    // attaching to it would move a real due date. Create a new one instead.
    it('does not adopt a same-named assignment that takes submissions', async () => {
      integration.canvasApi.getAll.mockResolvedValue([
        { id: 5000, name: 'Quiz 1 — 101 (GRASP)', submission_types: ['online_upload'] },
        { id: 5001, name: 'Quiz 1 — 101 (GRASP)' },
      ]);

      const response = await ensure();

      expect(response.body.results[0].status).toBe('created');
      expect(integration.canvasApi.post).toHaveBeenCalledWith('/courses/42/assignments', expect.anything());
      expect(integration.canvasApi.get).not.toHaveBeenCalledWith('/courses/42/assignments/5000/overrides');
      expect(rowsService.markCreated).toHaveBeenCalledWith('row-new', expect.objectContaining({ externalAssignmentId: 9001 }));
    });

    it('gives a reused assignment its section override back when it has none', async () => {
      integration.canvasApi.getAll.mockResolvedValue([{ id: 9001, name: 'Quiz 1 — 101 (GRASP)', submission_types: ['none'] }]);
      integration.canvasApi.get.mockResolvedValue([]);

      await ensure();

      expect(integration.canvasApi.post).toHaveBeenCalledWith('/courses/42/assignments/9001/overrides', {
        assignment_override: { course_section_id: 501, due_at: DUE.toISOString() },
      });
      expect(rowsService.markCreated).toHaveBeenCalledWith('row-new', expect.objectContaining({ externalOverrideId: 78 }));
    });

    it('leaves an unlinked or unscheduled section alone, without calling Canvas', async () => {
      quizScheduleService.getSchedulesForQuiz.mockResolvedValue([
        { courseSectionId: 'sec-unlinked', releaseDate: RELEASE, expireDate: DUE },
      ]);

      const response = await ensure(['sec-linked', 'sec-unlinked']);

      expect(response.body.results).toEqual([
        { courseSectionId: 'sec-linked', status: 'not-scheduled' },
        { courseSectionId: 'sec-unlinked', status: 'not-linked' },
      ]);
      expect(integration.canvas.getCourses).not.toHaveBeenCalled();
      expect(rowsService.claimRow).not.toHaveBeenCalled();
    });

    it('does not write to a Canvas course the connected account no longer teaches', async () => {
      integration.canvas.getCourses.mockResolvedValue([]);

      const response = await ensure();

      expect(response.body.results).toEqual([
        { courseSectionId: 'sec-linked', status: 'failed', error: expect.stringMatching(/does not teach/) },
      ]);
      expect(rowsService.claimRow).not.toHaveBeenCalled();
    });

    it('releases the claim when Canvas refuses the create', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      integration.canvasApi.post.mockRejectedValue(new FakeCanvasApiError(502));

      const response = await ensure();
      consoleError.mockRestore();

      expect(response.status).toBe(200);
      expect(response.body.results[0]).toEqual({
        courseSectionId: 'sec-linked',
        status: 'failed',
        error: expect.stringMatching(/Canvas could not complete/),
      });
      expect(rowsService.releaseClaim).toHaveBeenCalledWith({ _id: 'row-new' }, null, expect.any(Error));
      expect(rowsService.markCreated).not.toHaveBeenCalled();
    });

    it('stops with the reconnect signal when Canvas rejects the token', async () => {
      integration.canvas.getCourses.mockRejectedValue(new FakeCanvasApiError(401));

      const response = await ensure();

      expect(response.status).toBe(401);
      expect(response.body.connected).toBe(false);
    });

    it('reports a claim another request already holds as in progress', async () => {
      rowsService.claimRow.mockResolvedValue(null);
      rowsService.getRowsForQuiz.mockResolvedValue(new Map([['sec-linked', { status: 'pending' }]]));

      const response = await ensure();

      expect(response.body.results).toEqual([{ courseSectionId: 'sec-linked', status: 'in-progress' }]);
      expect(integration.canvasApi.post).not.toHaveBeenCalled();
    });

    it('carries on with the other sections when one fails', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      getSectionsOwnedByUser.mockResolvedValue([
        linkedSection(),
        linkedSection({ _id: 'sec-linked-2', sectionId: 'SEC-103', sectionNumber: '103', lmsLink: { provider: 'canvas', instance: CANVAS_DOMAIN, externalCourseId: '42', externalSectionId: '502' } }),
      ]);
      quizScheduleService.getSchedulesForQuiz.mockResolvedValue([
        { courseSectionId: 'sec-linked', releaseDate: RELEASE, expireDate: DUE },
        { courseSectionId: 'sec-linked-2', releaseDate: RELEASE, expireDate: DUE },
      ]);
      integration.canvasApi.post
        .mockRejectedValueOnce(new FakeCanvasApiError(502))
        .mockResolvedValueOnce({ id: 9002, html_url: '' });

      const response = await ensure(['sec-linked', 'sec-linked-2']);
      consoleError.mockRestore();

      expect(response.body.results.map((r) => r.status)).toEqual(['failed', 'created']);
    });
  });

  describe('POST assignments (reschedule)', () => {
    const ensure = () => request(app).post(QUIZ_BASE).send({ courseSectionIds: ['sec-linked'] });

    it('moves the Canvas due date to the new close time', async () => {
      const newDue = new Date('2026-11-08T07:59:00Z');
      rowsService.getRowsForQuiz.mockResolvedValue(new Map([['sec-linked', createdRow()]]));
      quizScheduleService.getSchedulesForQuiz.mockResolvedValue([
        { courseSectionId: 'sec-linked', releaseDate: RELEASE, expireDate: newDue },
      ]);

      const response = await ensure();

      expect(response.body.results).toEqual([{ courseSectionId: 'sec-linked', status: 'updated' }]);
      expect(integration.canvasApi.put).toHaveBeenCalledWith('/courses/42/assignments/9001/overrides/77', {
        assignment_override: { due_at: newDue.toISOString() },
      });
      expect(rowsService.markSynced).toHaveBeenCalledWith('row-1', { dueAt: newDue, externalOverrideId: '77' });
      expect(rowsService.claimRow).not.toHaveBeenCalled();
    });

    it('does nothing when the due date already matches', async () => {
      rowsService.getRowsForQuiz.mockResolvedValue(new Map([['sec-linked', createdRow()]]));

      const response = await ensure();

      expect(response.body.results).toEqual([{ courseSectionId: 'sec-linked', status: 'unchanged' }]);
      expect(integration.canvasApi.put).not.toHaveBeenCalled();
      expect(integration.canvasApi.post).not.toHaveBeenCalled();
    });

    it('retries a sync whose last attempt failed even if the dates match', async () => {
      rowsService.getRowsForQuiz.mockResolvedValue(new Map([
        ['sec-linked', createdRow({ lastError: { message: 'Canvas was down', at: new Date() } })],
      ]));

      const response = await ensure();

      expect(response.body.results[0].status).toBe('updated');
      expect(integration.canvasApi.put).toHaveBeenCalled();
    });

    it('puts a removed section override back rather than failing', async () => {
      rowsService.getRowsForQuiz.mockResolvedValue(new Map([
        ['sec-linked', createdRow({ externalOverrideId: null, dueAt: new Date('2026-10-20T06:59:00Z') })],
      ]));
      integration.canvasApi.get.mockResolvedValue([]);

      const response = await ensure();

      expect(response.body.results[0].status).toBe('updated');
      expect(integration.canvasApi.post).toHaveBeenCalledWith('/courses/42/assignments/9001/overrides', {
        assignment_override: { course_section_id: 501, due_at: DUE.toISOString() },
      });
      expect(rowsService.markSynced).toHaveBeenCalledWith('row-1', { dueAt: DUE, externalOverrideId: 78 });
    });

    it('keeps the GRASP schedule and records the failure when Canvas cannot be updated', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      rowsService.getRowsForQuiz.mockResolvedValue(new Map([
        ['sec-linked', createdRow({ dueAt: new Date('2026-10-20T06:59:00Z') })],
      ]));
      integration.canvasApi.put.mockRejectedValue(new FakeCanvasApiError(502));

      const response = await ensure();
      consoleError.mockRestore();

      expect(response.status).toBe(200);
      expect(response.body.results[0].status).toBe('failed');
      expect(rowsService.markSyncFailed).toHaveBeenCalledWith('row-1', expect.any(Error));
    });
  });

  describe('PUT declined', () => {
    it('records the decline for the given sections and answers with the new state', async () => {
      rowsService.getRowsForQuiz
        .mockResolvedValueOnce(new Map())
        .mockResolvedValueOnce(new Map([['sec-linked', { status: 'declined' }]]));

      const response = await request(app).put(`${QUIZ_BASE}/declined`).send({ courseSectionIds: ['sec-linked'] });

      expect(response.status).toBe(200);
      expect(rowsService.markDeclined).toHaveBeenCalledWith({
        quizId: QUIZ_ID,
        courseSectionIds: ['sec-linked'],
        courseId: COURSE_ID,
        provider: 'canvas',
        instance: CANVAS_DOMAIN,
        userId: USER_ID,
      });
      expect(response.body.declined).toEqual(['sec-linked']);
      expect(response.body.sections[0].assignment).toEqual({ status: 'declined', lastError: null });
      expect(integration.canvas.getCourses).not.toHaveBeenCalled();
    });
  });

  describe('GET section quiz-assignments', () => {
    const SECTION_URL = `/api/lms/canvas/courses/${COURSE_ID}/sections/SEC-101/quiz-assignments`;

    it('lists the quizzes scheduled on the section, soonest due first, with their assignments', async () => {
      quizService.getQuizzesByCourse.mockResolvedValue([
        { _id: 'quiz-1', name: 'Quiz 1' },
        { _id: 'quiz-2', name: 'Quiz 2' },
        { _id: 'quiz-3', name: 'Not scheduled here' },
      ]);
      quizScheduleService.getSchedulesForSection.mockResolvedValue([
        { quizId: 'quiz-2', releaseDate: RELEASE, expireDate: new Date('2026-12-01T07:59:00Z') },
        { quizId: 'quiz-1', releaseDate: RELEASE, expireDate: DUE },
        { quizId: 'quiz-deleted', releaseDate: RELEASE, expireDate: DUE },
      ]);
      rowsService.getRowsForSection.mockResolvedValue(new Map([['quiz-2', { status: 'declined' }]]));

      const response = await request(app).get(SECTION_URL);

      expect(response.status).toBe(200);
      expect(response.body.section).toEqual({
        courseSectionId: 'sec-linked',
        sectionId: 'SEC-101',
        sectionNumber: '101',
        linked: true,
      });
      expect(response.body.quizzes).toEqual([
        { quizId: 'quiz-1', name: 'Quiz 1', expireDate: DUE.toISOString(), assignment: null },
        { quizId: 'quiz-2', name: 'Quiz 2', expireDate: '2026-12-01T07:59:00.000Z', assignment: { status: 'declined', lastError: null } },
      ]);
      expect(quizScheduleService.getSchedulesForSection).toHaveBeenCalledWith('sec-linked');
    });

    it('is only for sections the caller owns', async () => {
      getSectionsOwnedByUser.mockResolvedValue([]);
      const response = await request(app).get(SECTION_URL);
      expect(response.status).toBe(403);
    });
  });
});
