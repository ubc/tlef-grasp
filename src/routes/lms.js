const express = require('express');
const { requireOwnedSection } = require('../middleware/lms-section-access');
const lmsSectionLinkService = require('../services/lms-section-link');

const router = express.Router();

router.delete(
  '/courses/:courseId/sections/:sectionId/link',
  requireOwnedSection,
  async (req, res, next) => {
    try {
      const removed = await lmsSectionLinkService.removeSectionLmsLink(
        req.params.courseId,
        req.params.sectionId
      );
      if (!removed) {
        return res.status(404).json({
          success: false,
          error: 'GRASP section not found',
        });
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
