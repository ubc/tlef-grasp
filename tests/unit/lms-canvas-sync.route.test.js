// POST /api/lms/canvas/courses/:courseId/sections/:sectionId/sync-students
// (issue #113). The router is built with a fake Canvas namespace (the DI
// factory used by lms-canvas.route.test.js) and a fake paging API client; the
// real roster adapter runs on top of it, and the sync service itself is mocked
// (see lms-roster-sync.service.test.js).
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

jest.mock('../../src/services/lms-roster-sync', () => ({
  syncSectionRoster: jest.fn(),
}));

const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const { isAppAdministrator } = require('../../src/utils/auth');
const { getCourseById } = require('../../src/services/course');
const { getSectionsOwnedByUser } = require('../../src/services/course-section');
const { syncSectionRoster } = require('../../src/services/lms-roster-sync');
const { LmsRosterError } = require('../../src/lms/roster-errors');
const { createCanvasRouter } = require('../../src/routes/lms-canvas');

const USER_ID = '507f1f77bcf86cd799439011';
const CANVAS_DOMAIN = 'https://canvas.example.test';
const SYNC_URL = '/api/lms/canvas/courses/course-1/sections/101/sync-students';

class FakeCanvasApiError extends Error {
  constructor(statusCode) {
    super(`Canvas returned ${statusCode}`);
    this.statusCode = statusCode;
  }
}

function createIntegration({ connected = true, capabilities } = {}) {
  // req.canvasApi: the toolkit's paging client, answering the roster read.
  const canvasApi = { token: 'instructor-token', getAll: jest.fn().mockResolvedValue([]) };
  const canvas = {
    CanvasApiError: FakeCanvasApiError,
    CanvasOAuthError: class extends Error {},
    createAuthRouter: jest.fn(() => express.Router()),
    requireAuth: jest.fn(() => (req, res, next) => {
      if (!connected) {
        return res.status(401).json({
          success: false,
          connected: false,
          connectUrl: '/api/lms/canvas/auth/login',
        });
      }
      req.canvasApi = canvasApi;
      next();
    }),
    getCourses: jest.fn().mockResolvedValue([{ id: '42', name: 'Biology 302' }]),
    getCourseSections: jest.fn(),
  };
  return { configured: true, canvas, config: {}, canvasApi, capabilities };
}

function buildApp(integration) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { _id: USER_ID };
    next();
  });
  app.use('/api/lms/canvas', createCanvasRouter(integration));
  return app;
}

function canvasSection(linkExtra = {}) {
  return {
    sectionId: '101',
    academicPeriod: 'W2026',
    lmsLink: {
      provider: 'canvas',
      instance: CANVAS_DOMAIN,
      externalCourseId: '42',
      externalSectionId: '501',
      ...linkExtra,
    },
  };
}

// A Canvas enrollment, as GET /courses/:id/enrollments returns it (user embedded).
function canvasEnrollment(id, sectionId, integrationId = `PUID${id}`) {
  return {
    id: 9000 + id,
    user_id: id,
    course_id: 42,
    course_section_id: sectionId,
    type: 'StudentEnrollment',
    enrollment_state: 'active',
    user: { id, name: `Student ${id}`, sortable_name: `${id}, Student`, integration_id: integrationId },
  };
}

const APPLIED = {
  status: 'applied',
  summary: {
    added: 1, restored: 0, previouslyRemovedRestored: 0, dropped: 0, kept: 0,
    unmatched: [], dropsSkipped: null, coverage: 1, errors: [],
  },
};

describe('POST /api/lms/canvas/.../sync-students', () => {
  const originalDomain = process.env.CANVAS_DOMAIN;

  beforeAll(() => {
    process.env.CANVAS_DOMAIN = CANVAS_DOMAIN;
  });

  afterAll(() => {
    if (originalDomain === undefined) delete process.env.CANVAS_DOMAIN;
    else process.env.CANVAS_DOMAIN = originalDomain;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    hasStaffAccessInCourse.mockResolvedValue(true);
    isAppAdministrator.mockResolvedValue(false);
    getCourseById.mockResolvedValue({ _id: 'course-1', archived: false });
    getSectionsOwnedByUser.mockResolvedValue([canvasSection()]);
    syncSectionRoster.mockResolvedValue(APPLIED);
  });

  it('syncs the linked section with the instructor token and returns the summary', async () => {
    const integration = createIntegration();
    integration.canvasApi.getAll.mockResolvedValue([
      canvasEnrollment(1, 501),
      canvasEnrollment(2, 502),
    ]);

    const response = await request(buildApp(integration)).post(SYNC_URL).send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, ...APPLIED });
    expect(integration.canvas.getCourses).toHaveBeenCalledWith(
      integration.canvasApi,
      { enrollment_type: 'teacher' }
    );
    expect(integration.canvasApi.getAll).toHaveBeenCalledWith(
      '/courses/42/enrollments',
      { type: ['StudentEnrollment'], state: ['active', 'invited'] }
    );
    expect(syncSectionRoster).toHaveBeenCalledTimes(1);
    const args = syncSectionRoster.mock.calls[0][0];
    expect(args).toEqual(expect.objectContaining({
      courseId: 'course-1',
      section: canvasSection(),
      provider: 'canvas',
      instance: CANVAS_DOMAIN,
      coverage: { total: 1, integrationId: 1 },
      actorUserId: USER_ID,
      skipDrops: false,
    }));
    // Only the linked Canvas section's student reaches the sync.
    expect(args.roster.map((row) => row.externalUserId)).toEqual(['1']);
    expect(args.confirmDropUserIds).toBeUndefined();
  });

  it('passes a confirmed drop list through and returns a confirmation request unchanged', async () => {
    const plan = { add: 0, restore: 0, previouslyRemoved: 0, keep: 1, drop: [{ userId: 'u9', name: 'Nine' }], unmatched: [] };
    syncSectionRoster.mockResolvedValue({ status: 'confirmation-required', reason: 'roster-changed', plan });

    const response = await request(buildApp(createIntegration()))
      .post(SYNC_URL)
      .send({ confirmDropUserIds: ['u1', 'u2'] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, status: 'confirmation-required', reason: 'roster-changed', plan });
    expect(syncSectionRoster.mock.calls[0][0]).toEqual(expect.objectContaining({
      confirmDropUserIds: ['u1', 'u2'],
      skipDrops: false,
    }));
  });

  it('passes skipDrops through', async () => {
    await request(buildApp(createIntegration())).post(SYNC_URL).send({ skipDrops: true });

    expect(syncSectionRoster.mock.calls[0][0]).toEqual(expect.objectContaining({ skipDrops: true }));
  });

  it('treats a legacy link without an instance as this Canvas and hands the sync the current instance', async () => {
    getSectionsOwnedByUser.mockResolvedValue([canvasSection({ instance: undefined })]);

    const response = await request(buildApp(createIntegration())).post(SYNC_URL).send({});

    expect(response.status).toBe(200);
    expect(syncSectionRoster.mock.calls[0][0].instance).toBe(CANVAS_DOMAIN);
  });

  it('409s a section that is not linked to any LMS', async () => {
    getSectionsOwnedByUser.mockResolvedValue([{ sectionId: '101' }]);
    const integration = createIntegration();

    const response = await request(buildApp(integration)).post(SYNC_URL).send({});

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ success: false, error: 'This section is not linked to Canvas.' });
    expect(integration.canvasApi.getAll).not.toHaveBeenCalled();
    expect(syncSectionRoster).not.toHaveBeenCalled();
  });

  it('409s a Moodle-linked section', async () => {
    getSectionsOwnedByUser.mockResolvedValue([canvasSection({ provider: 'moodle' })]);

    const response = await request(buildApp(createIntegration())).post(SYNC_URL).send({});

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('This section is not linked to Canvas.');
    expect(syncSectionRoster).not.toHaveBeenCalled();
  });

  it('409s a section linked on a different Canvas instance, reading nothing', async () => {
    getSectionsOwnedByUser.mockResolvedValue([
      canvasSection({ instance: 'https://other-canvas.example.test' }),
    ]);
    const integration = createIntegration();

    const response = await request(buildApp(integration)).post(SYNC_URL).send({});

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      success: false,
      error: 'This section is linked to a different Canvas instance. Re-link it.',
    });
    expect(integration.canvas.getCourses).not.toHaveBeenCalled();
    expect(integration.canvasApi.getAll).not.toHaveBeenCalled();
    expect(syncSectionRoster).not.toHaveBeenCalled();
  });

  it('403s when the connected Canvas account no longer teaches the linked course', async () => {
    const integration = createIntegration();
    integration.canvas.getCourses.mockResolvedValue([{ id: '43', name: 'Another course' }]);

    const response = await request(buildApp(integration)).post(SYNC_URL).send({});

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      success: false,
      error: 'Your connected Canvas account does not teach that course',
    });
    expect(integration.canvasApi.getAll).not.toHaveBeenCalled();
    expect(syncSectionRoster).not.toHaveBeenCalled();
  });

  it('403s an instructor who does not own the section', async () => {
    getSectionsOwnedByUser.mockResolvedValue([]);
    const integration = createIntegration();

    const response = await request(buildApp(integration)).post(SYNC_URL).send({});

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('You can only manage sections that you own');
    expect(integration.canvas.getCourses).not.toHaveBeenCalled();
    expect(syncSectionRoster).not.toHaveBeenCalled();
  });

  it('returns the connect prompt when the instructor has not connected Canvas', async () => {
    const response = await request(buildApp(createIntegration({ connected: false })))
      .post(SYNC_URL)
      .send({});

    expect(response.status).toBe(401);
    expect(response.body).toEqual(expect.objectContaining({
      connected: false,
      connectUrl: '/api/lms/canvas/auth/login',
    }));
    expect(syncSectionRoster).not.toHaveBeenCalled();
  });

  it.each([
    [{ skipDrops: 'yes' }, 'skipDrops must be a boolean'],
    [{ skipDrops: 1 }, 'skipDrops must be a boolean'],
    [{ confirmDropUserIds: 'u1' }, 'confirmDropUserIds must be an array of user ids'],
    [{ confirmDropUserIds: ['u1', 7] }, 'confirmDropUserIds must be an array of user ids'],
    [{ confirmDropUserIds: ['u1', '  '] }, 'confirmDropUserIds must be an array of user ids'],
    [{ confirmDropUserIds: [{ $ne: null }] }, 'confirmDropUserIds must be an array of user ids'],
    [{ confirmDropUserIds: ['u1'], skipDrops: true }, 'Send either confirmDropUserIds or skipDrops, not both'],
  ])('400s the body %j', async (body, message) => {
    const integration = createIntegration();

    const response = await request(buildApp(integration)).post(SYNC_URL).send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, error: message });
    expect(integration.canvasApi.getAll).not.toHaveBeenCalled();
    expect(syncSectionRoster).not.toHaveBeenCalled();
  });

  it('400s a confirmed drop list larger than any section', async () => {
    const ids = Array.from({ length: 5001 }, (_, i) => `u${i}`);

    const response = await request(buildApp(createIntegration()))
      .post(SYNC_URL)
      .send({ confirmDropUserIds: ids });

    expect(response.status).toBe(400);
    expect(syncSectionRoster).not.toHaveBeenCalled();
  });

  it('422s with a Canvas SIS-permission explanation when no student carries an integration_id', async () => {
    syncSectionRoster.mockRejectedValue(new LmsRosterError('no-integration-ids', 'none'));

    const response = await request(buildApp(createIntegration())).post(SYNC_URL).send({});

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.code).toBe('no-integration-ids');
    expect(response.body.error).toMatch(/SIS/);
    expect(response.body.error).toMatch(/Nothing was changed/);
  });

  it('502s, without syncing, when Canvas returns enrollments without their section', async () => {
    const integration = createIntegration();
    integration.canvasApi.getAll.mockResolvedValue([
      { ...canvasEnrollment(1, 501), course_section_id: undefined },
    ]);

    const response = await request(buildApp(integration)).post(SYNC_URL).send({});

    expect(response.status).toBe(502);
    expect(response.body.code).toBe('section-scope-unavailable');
    expect(response.body.error).toMatch(/Nothing was changed/);
    expect(syncSectionRoster).not.toHaveBeenCalled();
  });

  it('tells the instructor to reconnect when Canvas rejects the token mid-sync', async () => {
    const integration = createIntegration();
    integration.canvasApi.getAll.mockRejectedValue(new FakeCanvasApiError(401));

    const response = await request(buildApp(integration)).post(SYNC_URL).send({});

    expect(response.status).toBe(401);
    expect(response.body).toEqual(expect.objectContaining({ success: false, connected: false }));
    // An expired token and a call outside the key's scopes look the same.
    expect(response.body.error).toMatch(/Reconnect Canvas/);
    expect(response.body.error).toMatch(/developer key may be missing a permission/);
    expect(syncSectionRoster).not.toHaveBeenCalled();
  });

  it('409s before touching Canvas when the deployment\'s scopes do not enable roster sync', async () => {
    const integration = createIntegration({
      capabilities: { link: true, rosterSync: false, assignments: false },
    });

    const response = await request(buildApp(integration)).post(SYNC_URL).send({});

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      success: false,
      code: 'capability-disabled',
      capability: 'rosterSync',
      error: 'This Canvas feature is not enabled on this GRASP deployment.',
    });
    expect(integration.canvas.getCourses).not.toHaveBeenCalled();
    expect(integration.canvasApi.getAll).not.toHaveBeenCalled();
    expect(syncSectionRoster).not.toHaveBeenCalled();
  });

  it('still refuses a section the instructor does not own before the capability check', async () => {
    getSectionsOwnedByUser.mockResolvedValue([]);
    const integration = createIntegration({
      capabilities: { link: true, rosterSync: false, assignments: false },
    });

    const response = await request(buildApp(integration)).post(SYNC_URL).send({});

    expect(response.status).toBe(403);
  });

  it('refuses to sync an archived course', async () => {
    getCourseById.mockResolvedValue({ _id: 'course-1', archived: true });

    const response = await request(buildApp(createIntegration())).post(SYNC_URL).send({});

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('course_archived');
    expect(syncSectionRoster).not.toHaveBeenCalled();
  });
});
