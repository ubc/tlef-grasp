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
  setCanvasSectionLink: jest.fn(),
}));

const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const { isAppAdministrator } = require('../../src/utils/auth');
const {
  getCourseSections,
  getSectionsOwnedByUser,
} = require('../../src/services/course-section');
const lmsSectionLinkService = require('../../src/services/lms-section-link');
const { createCanvasRouter } = require('../../src/routes/lms-canvas');

class FakeCanvasApiError extends Error {
  constructor(statusCode) {
    super(`Canvas returned ${statusCode}`);
    this.statusCode = statusCode;
  }
}

class FakeCanvasOAuthError extends Error {}

function createIntegration({ connected = true } = {}) {
  const authRouter = express.Router();
  authRouter.get('/login', (_req, res) =>
    res.redirect('https://canvas.example.test/oauth')
  );
  authRouter.post('/logout', (_req, res) => res.status(204).end());

  const canvas = {
    CanvasApiError: FakeCanvasApiError,
    CanvasOAuthError: FakeCanvasOAuthError,
    createAuthRouter: jest.fn(() => authRouter),
    requireAuth: jest.fn(() => (req, res, next) => {
      if (!connected) {
        return res.status(401).json({
          success: false,
          connected: false,
          connectUrl: '/api/lms/canvas/auth/login',
        });
      }
      req.canvasApi = { connected: true };
      next();
    }),
    getCourses: jest.fn(),
    getCourseSections: jest.fn(),
  };

  return { configured: true, canvas, config: {} };
}

function buildApp(integration, user = { _id: '507f1f77bcf86cd799439011' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/lms/canvas', createCanvasRouter(integration));
  return app;
}

const sectionBase = '/api/lms/canvas/courses/local-1/sections/101';

describe('Canvas LMS section routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hasStaffAccessInCourse.mockResolvedValue(true);
    isAppAdministrator.mockResolvedValue(false);
    getSectionsOwnedByUser.mockResolvedValue([{ sectionId: '101' }]);
    getCourseSections.mockResolvedValue([{ sectionId: '101' }]);
  });

  it('returns 404 for every Canvas endpoint when deployment config is absent', async () => {
    const response = await request(buildApp({ configured: false }))
      .get('/api/lms/canvas/status');

    expect(response.status).toBe(404);
    expect(response.body).toEqual(expect.objectContaining({ configured: false }));
  });

  it('reports connected and disconnected per-user states', async () => {
    const connected = await request(buildApp(createIntegration()))
      .get('/api/lms/canvas/status');
    expect(connected.status).toBe(200);
    expect(connected.body).toEqual(expect.objectContaining({
      configured: true,
      connected: true,
    }));

    const disconnected = await request(buildApp(createIntegration({ connected: false })))
      .get('/api/lms/canvas/status');
    expect(disconnected.status).toBe(401);
    expect(disconnected.body.connected).toBe(false);
  });

  it('returns Canvas OAuth denials to the Settings connection UI', async () => {
    const response = await request(buildApp(createIntegration()))
      .get('/api/lms/canvas/auth/callback')
      .query({ error: 'unauthorized_client' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/settings?canvas=error');
  });

  it('lists normalized teacher courses for a locally owned section', async () => {
    const integration = createIntegration();
    integration.canvas.getCourses.mockResolvedValue([
      {
        id: '42',
        name: 'Biology 302',
        code: 'BIOC 302',
        raw: { access_token: 'must-not-leak' },
      },
    ]);

    const response = await request(buildApp(integration))
      .get(`${sectionBase}/available-courses`);

    expect(response.status).toBe(200);
    expect(integration.canvas.getCourses).toHaveBeenCalledWith(
      { connected: true },
      { enrollment_type: 'teacher' }
    );
    expect(response.body.courses).toEqual([
      { id: '42', name: 'Biology 302', code: 'BIOC 302' },
    ]);
    expect(response.body.courses[0]).not.toHaveProperty('raw');
  });

  it('blocks an instructor from managing another instructor section', async () => {
    getSectionsOwnedByUser.mockResolvedValue([]);
    const integration = createIntegration();

    const response = await request(buildApp(integration))
      .get(`${sectionBase}/available-courses`);

    expect(response.status).toBe(403);
    expect(integration.canvas.getCourses).not.toHaveBeenCalled();
  });

  it('lists Canvas sections only after revalidating teacher course access', async () => {
    const integration = createIntegration();
    integration.canvas.getCourses.mockResolvedValue([
      { id: '42', name: 'Biology 302', code: 'BIOC 302' },
    ]);
    integration.canvas.getCourseSections.mockResolvedValue([
      { id: '501', name: 'Section 1', courseId: '42', raw: {} },
      { id: '502', name: 'Section 2', courseId: '42', raw: {} },
    ]);

    const response = await request(buildApp(integration))
      .get(`${sectionBase}/canvas-courses/42/sections`);

    expect(response.status).toBe(200);
    expect(response.body.sections).toEqual([
      { id: '501', name: 'Section 1', courseId: '42' },
      { id: '502', name: 'Section 2', courseId: '42' },
    ]);
  });

  it('automatically links a Canvas course with one section', async () => {
    const integration = createIntegration();
    const canvasCourse = { id: '42', name: 'Biology 302', code: 'BIOC 302' };
    const canvasSection = { id: '501', name: 'Only Section', courseId: '42' };
    integration.canvas.getCourses.mockResolvedValue([canvasCourse]);
    integration.canvas.getCourseSections.mockResolvedValue([canvasSection]);
    lmsSectionLinkService.setCanvasSectionLink.mockResolvedValue({
      provider: 'canvas',
      externalCourseId: '42',
      externalSectionId: '501',
    });

    const response = await request(buildApp(integration))
      .put(`${sectionBase}/link`)
      .send({ canvasCourseId: '42' });

    expect(response.status).toBe(200);
    expect(lmsSectionLinkService.setCanvasSectionLink).toHaveBeenCalledWith(
      'local-1',
      '101',
      canvasCourse,
      canvasSection,
      '507f1f77bcf86cd799439011'
    );
  });

  it('requires an explicit selection when a Canvas course has multiple sections', async () => {
    const integration = createIntegration();
    integration.canvas.getCourses.mockResolvedValue([
      { id: '42', name: 'Biology 302', code: 'BIOC 302' },
    ]);
    integration.canvas.getCourseSections.mockResolvedValue([
      { id: '501', name: 'Section 1', courseId: '42' },
      { id: '502', name: 'Section 2', courseId: '42' },
    ]);

    const response = await request(buildApp(integration))
      .put(`${sectionBase}/link`)
      .send({ canvasCourseId: '42' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Select a Canvas section');
    expect(lmsSectionLinkService.setCanvasSectionLink).not.toHaveBeenCalled();
  });

  it('stores the selected Canvas course and section using server metadata', async () => {
    const integration = createIntegration();
    const canvasCourse = { id: '42', name: 'Biology 302', code: 'BIOC 302' };
    const canvasSection = { id: '502', name: 'Section 2', courseId: '42' };
    integration.canvas.getCourses.mockResolvedValue([canvasCourse]);
    integration.canvas.getCourseSections.mockResolvedValue([
      { id: '501', name: 'Section 1', courseId: '42' },
      canvasSection,
    ]);
    lmsSectionLinkService.setCanvasSectionLink.mockResolvedValue({
      provider: 'canvas',
      externalCourseId: '42',
      externalSectionId: '502',
    });

    const response = await request(buildApp(integration))
      .put(`${sectionBase}/link`)
      .send({
        canvasCourseId: '42',
        canvasSectionId: '502',
        externalCourseName: 'Attacker-controlled name',
      });

    expect(response.status).toBe(200);
    expect(lmsSectionLinkService.setCanvasSectionLink).toHaveBeenCalledWith(
      'local-1',
      '101',
      canvasCourse,
      canvasSection,
      '507f1f77bcf86cd799439011'
    );
  });

});
