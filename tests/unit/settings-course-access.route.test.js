const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/settings', () => ({
  getSettings: jest.fn(),
  updateSettings: jest.fn(),
}));

jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn(),
}));

jest.mock('../../src/utils/co-instructor-permissions', () => ({
  assertCoInstructorPermission: jest.fn(),
  isCourseManager: jest.fn(),
  PERMISSION_KEYS: { SETTINGS: 'settings' },
}));

const settingsService = require('../../src/services/settings');
const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const settingsController = require('../../src/controllers/settings');

function buildApp(user = { _id: 'ta-1' }) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.get('/courses/:courseId/settings', settingsController.getSettingsHandler);
  return app;
}

describe('GET /courses/:courseId/settings course-scoped access', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('allows a TA to read settings in their TA course', async () => {
    hasStaffAccessInCourse.mockResolvedValue(true);
    settingsService.getSettings.mockResolvedValue({ prompts: {} });

    const response = await request(buildApp()).get('/courses/course-1/settings');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('blocks the same promoted account in another course', async () => {
    hasStaffAccessInCourse.mockResolvedValue(false);

    const response = await request(buildApp()).get('/courses/course-2/settings');

    expect(response.status).toBe(403);
    expect(settingsService.getSettings).not.toHaveBeenCalled();
  });
});
