const express = require('express');
const request = require('supertest');

jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn(),
}));

jest.mock('../../src/utils/auth', () => ({
  isAppAdministrator: jest.fn(),
}));

jest.mock('../../src/services/course-section', () => ({
  getCourseSections: jest.fn(),
  getSectionsOwnedByUser: jest.fn(),
}));

jest.mock('../../src/services/lms-section-link', () => ({
  setMoodleSectionLink: jest.fn(),
}));

const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const { isAppAdministrator } = require('../../src/utils/auth');
const { getSectionsOwnedByUser } = require('../../src/services/course-section');
const lmsSectionLinkService = require('../../src/services/lms-section-link');
const { createMoodleRouter } = require('../../src/routes/lms-moodle');

class FakeMoodleApiError extends Error {
  constructor(errorcode) {
    super(`Moodle returned ${errorcode}`);
    this.errorcode = errorcode;
  }
}

function createIntegration({ connected = true } = {}) {
  const authRouter = express.Router();
  authRouter.post('/connect', (_req, res) =>
    res.json({ success: true, sitename: 'Test Moodle', username: 'teacher' })
  );
  authRouter.post('/disconnect', (_req, res) => res.status(204).end());

  const moodle = {
    MoodleApiError: FakeMoodleApiError,
    createAuthRouter: jest.fn(() => authRouter),
    requireAuth: jest.fn(() => (req, res, next) => {
      if (!connected) {
        return res.status(401).json({
          success: false,
          connected: false,
          connectUrl: '/api/lms/moodle/auth/connect',
        });
      }
      req.moodleApi = { connected: true };
      next();
    }),
    getCourses: jest.fn(),
    getCourseSections: jest.fn(),
  };

  return { configured: true, moodle, config: {} };
}

function buildApp(integration, user = { _id: '507f1f77bcf86cd799439011' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/lms/moodle', createMoodleRouter(integration));
  return app;
}

const sectionBase = '/api/lms/moodle/courses/local-1/sections/101';

describe('Moodle LMS section routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hasStaffAccessInCourse.mockResolvedValue(true);
    isAppAdministrator.mockResolvedValue(false);
    getSectionsOwnedByUser.mockResolvedValue([{ sectionId: '101' }]);
  });

  it('returns 404 for every Moodle endpoint when deployment config is absent', async () => {
    const response = await request(buildApp({ configured: false }))
      .get('/api/lms/moodle/status');

    expect(response.status).toBe(404);
    expect(response.body).toEqual(expect.objectContaining({ configured: false }));
  });

  it('reports connected and disconnected per-user states', async () => {
    const connected = await request(buildApp(createIntegration()))
      .get('/api/lms/moodle/status');
    expect(connected.status).toBe(200);
    expect(connected.body).toEqual(expect.objectContaining({
      configured: true,
      connected: true,
    }));

    const disconnected = await request(buildApp(createIntegration({ connected: false })))
      .get('/api/lms/moodle/status');
    expect(disconnected.status).toBe(401);
    expect(disconnected.body.connected).toBe(false);
  });

  it('lists normalized Moodle courses for an owned section', async () => {
    const integration = createIntegration();
    integration.moodle.getCourses.mockResolvedValue([
      { id: '42', name: 'Biology', code: 'BIO 101', raw: { token: 'hidden' } },
    ]);

    const response = await request(buildApp(integration))
      .get(`${sectionBase}/available-courses`);

    expect(response.status).toBe(200);
    expect(response.body.courses).toEqual([
      { id: '42', name: 'Biology', code: 'BIO 101' },
    ]);
    expect(response.body.courses[0]).not.toHaveProperty('raw');
  });

  it('blocks an instructor from managing another instructor section', async () => {
    getSectionsOwnedByUser.mockResolvedValue([]);
    const integration = createIntegration();

    const response = await request(buildApp(integration))
      .get(`${sectionBase}/available-courses`);

    expect(response.status).toBe(403);
    expect(integration.moodle.getCourses).not.toHaveBeenCalled();
  });

  it('lists Moodle groups after revalidating course access', async () => {
    const integration = createIntegration();
    integration.moodle.getCourses.mockResolvedValue([
      { id: '42', name: 'Biology', code: 'BIO 101' },
    ]);
    integration.moodle.getCourseSections.mockResolvedValue([
      { id: '501', name: 'Group A', courseId: '42', raw: {} },
      { id: '502', name: 'Group B', courseId: '42', raw: {} },
    ]);

    const response = await request(buildApp(integration))
      .get(`${sectionBase}/moodle-courses/42/groups`);

    expect(response.status).toBe(200);
    expect(response.body.groups).toEqual([
      { id: '501', name: 'Group A', courseId: '42' },
      { id: '502', name: 'Group B', courseId: '42' },
    ]);
  });

  it('automatically links a Moodle course with one group', async () => {
    const integration = createIntegration();
    const moodleCourse = { id: '42', name: 'Biology', code: 'BIO 101' };
    const moodleGroup = { id: '501', name: 'Only Group', courseId: '42' };
    integration.moodle.getCourses.mockResolvedValue([moodleCourse]);
    integration.moodle.getCourseSections.mockResolvedValue([moodleGroup]);
    lmsSectionLinkService.setMoodleSectionLink.mockResolvedValue({
      provider: 'moodle',
      externalCourseId: '42',
      externalSectionId: '501',
    });

    const response = await request(buildApp(integration))
      .put(`${sectionBase}/link`)
      .send({ moodleCourseId: '42' });

    expect(response.status).toBe(200);
    expect(lmsSectionLinkService.setMoodleSectionLink).toHaveBeenCalledWith(
      'local-1',
      '101',
      moodleCourse,
      moodleGroup,
      '507f1f77bcf86cd799439011'
    );
  });

  it('requires a group selection when a Moodle course has multiple groups', async () => {
    const integration = createIntegration();
    integration.moodle.getCourses.mockResolvedValue([
      { id: '42', name: 'Biology', code: 'BIO 101' },
    ]);
    integration.moodle.getCourseSections.mockResolvedValue([
      { id: '501', name: 'Group A', courseId: '42' },
      { id: '502', name: 'Group B', courseId: '42' },
    ]);

    const response = await request(buildApp(integration))
      .put(`${sectionBase}/link`)
      .send({ moodleCourseId: '42' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Select a Moodle group');
  });

  it('does not create a link when the Moodle course has no groups', async () => {
    const integration = createIntegration();
    integration.moodle.getCourses.mockResolvedValue([
      { id: '42', name: 'Biology', code: 'BIO 101' },
    ]);
    integration.moodle.getCourseSections.mockResolvedValue([]);

    const response = await request(buildApp(integration))
      .put(`${sectionBase}/link`)
      .send({ moodleCourseId: '42' });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/no groups/i);
    expect(lmsSectionLinkService.setMoodleSectionLink).not.toHaveBeenCalled();
  });

  it('marks a revoked Moodle token as disconnected without exposing details', async () => {
    const integration = createIntegration();
    integration.moodle.getCourses.mockRejectedValue(
      new FakeMoodleApiError('invalidtoken')
    );

    const response = await request(buildApp(integration))
      .get(`${sectionBase}/available-courses`);

    expect(response.status).toBe(401);
    expect(response.body).toEqual(expect.objectContaining({
      success: false,
      connected: false,
    }));
    expect(response.body.error).not.toContain('invalidtoken');
  });

  it('stores server-derived Moodle course and group metadata', async () => {
    const integration = createIntegration();
    const moodleCourse = { id: '42', name: 'Biology', code: 'BIO 101' };
    const moodleGroup = { id: '502', name: 'Group B', courseId: '42' };
    integration.moodle.getCourses.mockResolvedValue([moodleCourse]);
    integration.moodle.getCourseSections.mockResolvedValue([
      { id: '501', name: 'Group A', courseId: '42' },
      moodleGroup,
    ]);
    lmsSectionLinkService.setMoodleSectionLink.mockResolvedValue({
      provider: 'moodle',
      externalCourseId: '42',
      externalSectionId: '502',
    });

    const response = await request(buildApp(integration))
      .put(`${sectionBase}/link`)
      .send({
        moodleCourseId: '42',
        moodleGroupId: '502',
        externalCourseName: 'Browser-controlled name',
      });

    expect(response.status).toBe(200);
    expect(lmsSectionLinkService.setMoodleSectionLink).toHaveBeenCalledWith(
      'local-1',
      '101',
      moodleCourse,
      moodleGroup,
      '507f1f77bcf86cd799439011'
    );
  });

});
