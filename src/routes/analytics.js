const express = require("express");
const router = express.Router();
const analyticsController = require("../controllers/analytics");

// Read-only, so archived courses stay viewable: no requireActiveCourse here.

/**
 * Class-level question statistics (difficulty index, most missed).
 * GET /api/analytics/course/:courseId/questions?quizId=&sectionId=
 */
router.get("/course/:courseId/questions", analyticsController.getQuestionAnalyticsHandler);

/**
 * Class-level completion and score distribution per quiz.
 * GET /api/analytics/course/:courseId/quizzes?quizId=&sectionId=
 */
router.get("/course/:courseId/quizzes", analyticsController.getQuizAnalyticsHandler);

/**
 * Class-level share of correct answers per learning objective.
 * GET /api/analytics/course/:courseId/objectives?quizId=&sectionId=
 */
router.get("/course/:courseId/objectives", analyticsController.getObjectiveAnalyticsHandler);

/**
 * One of the views above as a CSV download, with the same filters.
 * GET /api/analytics/course/:courseId/export/:view?quizId=&sectionId=
 */
router.get("/course/:courseId/export/:view", analyticsController.exportAnalyticsHandler);

module.exports = router;
