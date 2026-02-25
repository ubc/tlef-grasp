const express = require("express");
const router = express.Router();
const quizController = require("../controllers/quiz");

/**
 * GET /api/quiz/course/:courseId
 * Get all quizzes for a course
 */
router.get("/course/:courseId", quizController.getQuizzesByCourseHandler);

/**
 * GET /api/quiz/:quizId
 * Get a quiz by ID
 */
router.get("/:quizId", quizController.getQuizByIdHandler);

/**
 * POST /api/quiz
 * Create a new quiz
 */
router.post("/", express.json(), quizController.createQuizHandler);

/**
 * PUT /api/quiz/:quizId
 * Update a quiz
 */
router.put("/:quizId", express.json(), quizController.updateQuizHandler);

/**
 * DELETE /api/quiz/:quizId
 * Delete a quiz
 */
router.delete("/:quizId", quizController.deleteQuizHandler);

/**
 * POST /api/quiz/:quizId/questions
 * Add questions to a quiz
 */
router.post("/:quizId/questions", express.json(), quizController.addQuizQuestionsHandler);

/**
 * GET /api/quiz/:quizId/questions
 * Get all questions in a quiz
 * Query params: approvedOnly (optional) - if true, only return approved questions (for students)
 */
router.get("/:quizId/questions", quizController.getQuizQuestionsHandler);

module.exports = router;

