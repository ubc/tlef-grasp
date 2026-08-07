const express = require('express');
const { createCanvasIntegration } = require('../lms/canvas');
const { createCanvasController } = require('../controllers/lms-canvas');

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
  const controller = createCanvasController(canvas);
  const requireCanvasAuth = canvas.requireAuth(config);

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

  router.get(
    '/courses/:courseId/sections/:sectionId/available-courses',
    controller.requireOwnedSection,
    requireCanvasAuth,
    controller.listAvailableCourses
  );
  router.get(
    '/courses/:courseId/sections/:sectionId/canvas-courses/:canvasCourseId/sections',
    controller.requireOwnedSection,
    requireCanvasAuth,
    controller.listCanvasSections
  );
  router.put(
    '/courses/:courseId/sections/:sectionId/link',
    express.json(),
    controller.requireOwnedSection,
    requireCanvasAuth,
    controller.setSectionLink
  );
  router.delete(
    '/courses/:courseId/sections/:sectionId/link',
    controller.requireOwnedSection,
    controller.removeSectionLink
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
