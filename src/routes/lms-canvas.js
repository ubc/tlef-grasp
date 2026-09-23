const express = require('express');
const { createCanvasIntegration } = require('../lms/canvas');
const { createCanvasController } = require('../controllers/lms-canvas');
const { requireOwnedSection } = require('../middleware/lms-section-access');
const { requireActiveCourse } = require('../middleware/course-archive');
const { resolveCanvasCapabilities } = require('../lms/canvas-scopes');

/**
 * Refuse a route whose Canvas capability this deployment's scopes do not
 * enable, before anything reaches Canvas (the call would only come back as a
 * 401 "Insufficient scopes on access token.").
 */
function requireCanvasCapability(capabilities, capability) {
  return (_req, res, next) => {
    if (capabilities[capability]) return next();
    return res.status(409).json({
      success: false,
      code: 'capability-disabled',
      capability,
      error: 'This Canvas feature is not enabled on this GRASP deployment.',
    });
  };
}

function createCanvasRouter(integration = createCanvasIntegration()) {
  const router = express.Router();

  if (!integration.configured) {
    router.use((_req, res) => {
      res.status(404).json({
        success: false,
        configured: false,
        error: 'Canvas integration is not configured',
      });
    });
    return router;
  }

  const { canvas, config } = integration;
  // Every capability is on unless CANVAS_SCOPES says otherwise (see
  // lms/canvas-scopes.js); createCanvasIntegration resolves it from the env.
  const capabilities = integration.capabilities || resolveCanvasCapabilities([]);
  const controller = createCanvasController(canvas, { capabilities });
  const requireCanvasAuth = canvas.requireAuth(config);
  const requireLink = requireCanvasCapability(capabilities, 'link');
  const requireRosterSync = requireCanvasCapability(capabilities, 'rosterSync');

  // Canvas sends OAuth denials back as `?error=...` without an authorization
  // code. Handle that before the toolkit's callback route so users return to
  // the connection UI instead of seeing a low-level missing-code response.
  router.get('/auth/callback', (req, res, next) => {
    if (!req.query.error) return next();
    if (req.session) {
      delete req.session.canvasOAuthState;
      delete req.session.canvasOAuthReturnTo;
    }
    return res.redirect('/settings?canvas=error');
  });
  router.use('/auth', canvas.createAuthRouter(config));
  router.get('/status', requireCanvasAuth, controller.getStatus);

  // Every course-scoped Canvas route is gated: an archived course exposes no
  // integration state to anyone but its owner, and accepts no link changes.
  // Mounted after the OAuth and status routes, which are user-scoped.
  router.use('/courses/:courseId', requireActiveCourse());

  router.get(
    '/courses/:courseId/sections/:sectionId/available-courses',
    requireOwnedSection,
    requireLink,
    requireCanvasAuth,
    controller.listAvailableCourses
  );
  router.get(
    '/courses/:courseId/sections/:sectionId/canvas-courses/:canvasCourseId/sections',
    requireOwnedSection,
    requireLink,
    requireCanvasAuth,
    controller.listCanvasSections
  );
  router.put(
    '/courses/:courseId/sections/:sectionId/link',
    express.json(),
    requireOwnedSection,
    requireLink,
    requireCanvasAuth,
    controller.setSectionLink
  );
  router.post(
    '/courses/:courseId/sections/:sectionId/sync-students',
    express.json(),
    requireOwnedSection,
    requireRosterSync,
    requireCanvasAuth,
    controller.syncSectionStudents
  );
  // The package deliberately avoids exposing provider details. Send OAuth
  // failures back to Settings with a generic marker rather than rendering an
  // internal error or token-exchange response in the browser.
  router.use((error, req, res, next) => {
    if (error instanceof canvas.CanvasOAuthError && req.path === '/auth/callback') {
      return res.redirect('/settings?canvas=error');
    }
    next(error);
  });

  return router;
}

module.exports = { createCanvasRouter };
