const express = require("express");
const router = express.Router();
const questionController = require('../controllers/question');
const {
  requireActiveCourse,
  resolveCourseFromQuestion,
} = require('../middleware/course-archive');

// courseId arrives in the query (list) or the body (save/export); the
// per-question routes resolve it from the question itself.
router.use(requireActiveCourse());
router.use("/:questionId", requireActiveCourse({ resolve: resolveCourseFromQuestion }));

// Get questions for a course
router.get("/", questionController.getQuestionsHandler);

// Get a single question by ID
router.get("/:questionId", questionController.getQuestionByIdHandler);

// Save questions to question bank
router.post("/save", questionController.saveQuestionHandler);

// Update question
router.put("/:questionId", questionController.updateQuestionHandler);

// Update question status
router.put("/:questionId/status", questionController.updateQuestionStatusHandler);

// Delete question
router.delete("/:questionId", questionController.deleteQuestionHandler);

// Export questions in various formats
router.post("/export", questionController.exportQuestionsHandler);

module.exports = router;
