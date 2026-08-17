const express = require('express');
const { createMoodleIntegration } = require('../lms/moodle');
const { createMoodleController } = require('../controllers/lms-moodle');
const { requireOwnedSection } = require('../middleware/lms-section-access');

function createMoodleRouter(integration = createMoodleIntegration()) {
  const router = express.Router();

  if (!integration.configured) {
    router.use((_req, res) => {
      res.status(404).json({
        success: false,
        configured: false,
        error: 'Moodle integration is not configured',
      });
    });
    return router;
  }

  const { moodle, config } = integration;
  const controller = createMoodleController(moodle);
  const requireMoodleAuth = moodle.requireAuth(config);

  router.use('/auth', express.json(), moodle.createAuthRouter(config));
  router.get('/status', requireMoodleAuth, controller.getStatus);
  router.get(
    '/courses/:courseId/sections/:sectionId/available-courses',
    requireOwnedSection,
    requireMoodleAuth,
    controller.listAvailableCourses
  );
  router.get(
    '/courses/:courseId/sections/:sectionId/moodle-courses/:moodleCourseId/groups',
    requireOwnedSection,
    requireMoodleAuth,
    controller.listMoodleGroups
  );
  router.put(
    '/courses/:courseId/sections/:sectionId/link',
    express.json(),
    requireOwnedSection,
    requireMoodleAuth,
    controller.setSectionLink
  );
  return router;
}

module.exports = { createMoodleRouter };
