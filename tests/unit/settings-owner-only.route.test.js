// The generation controls (per-stage reasoning effort, automatic-fix toggle)
// are course-owner-only: they change what every co-instructor's generation
// costs and whether flagged questions are repaired. A co-instructor who holds
// the Settings permission may still edit prompts and bloom preferences, so the
// rejection has to be per-key, not per-request.

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

jest.mock('../../src/utils/ta-permissions', () => ({
  assertTaPermission: jest.fn(),
  TA_SETTINGS_KEY: 'settings',
}));

const settingsService = require('../../src/services/settings');
const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const {
  assertCoInstructorPermission,
  isCourseManager,
} = require('../../src/utils/co-instructor-permissions');
const { assertTaPermission } = require('../../src/utils/ta-permissions');
const settingsController = require('../../src/controllers/settings');

function buildApp(user = { _id: 'user-1' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.put('/courses/:courseId/settings', settingsController.updateSettingsHandler);
  return app;
}

const GENERATION_UPDATE = {
  prompts: { questionGeneration: 'Custom prompt' },
  reasoningEffort: { 'question-generation': 'high' },
  autoFixEnabled: false,
};

describe('PUT /courses/:courseId/settings generation controls', () => {
  beforeEach(() => {
    hasStaffAccessInCourse.mockResolvedValue(true);
    assertCoInstructorPermission.mockResolvedValue(true);
    assertTaPermission.mockResolvedValue(true);
    settingsService.updateSettings.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('lets the course owner set effort and turn auto-fix off', async () => {
    isCourseManager.mockResolvedValue(true);

    await request(buildApp())
      .put('/courses/course-1/settings')
      .send(GENERATION_UPDATE)
      .expect(200);

    expect(settingsService.updateSettings).toHaveBeenCalledWith('course-1', GENERATION_UPDATE);
  });

  it('strips both from a non-owner while still saving what they may edit', async () => {
    isCourseManager.mockResolvedValue(false);

    await request(buildApp())
      .put('/courses/course-1/settings')
      .send(GENERATION_UPDATE)
      .expect(200);

    // The prompt edit survives; the owner-only keys never reach the service, so
    // a co-instructor cannot switch auto-fix off for the whole course.
    expect(settingsService.updateSettings).toHaveBeenCalledWith('course-1', {
      prompts: { questionGeneration: 'Custom prompt' },
    });
  });

  it('still strips co-instructor permissions from a non-owner', async () => {
    isCourseManager.mockResolvedValue(false);

    await request(buildApp())
      .put('/courses/course-1/settings')
      .send({ coInstructorPermissions: { settings: true }, autoFixEnabled: false })
      .expect(200);

    expect(settingsService.updateSettings).toHaveBeenCalledWith('course-1', {});
  });

  it('does not consult ownership when no owner-only key is present', async () => {
    isCourseManager.mockResolvedValue(false);

    await request(buildApp())
      .put('/courses/course-1/settings')
      .send({ prompts: { questionGeneration: 'Only a prompt' } })
      .expect(200);

    expect(isCourseManager).not.toHaveBeenCalled();
    expect(settingsService.updateSettings).toHaveBeenCalledWith('course-1', {
      prompts: { questionGeneration: 'Only a prompt' },
    });
  });
});
