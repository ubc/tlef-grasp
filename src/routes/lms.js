const express = require('express');
const { requireOwnedSection } = require('../middleware/lms-section-access');
const lmsSectionLinkService = require('../services/lms-section-link');
const { requireActiveCourse } = require('../middleware/course-archive');

const router = express.Router();

// Unlinking a section from an LMS is a write against the course.
router.use('/courses/:courseId', requireActiveCourse());

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
