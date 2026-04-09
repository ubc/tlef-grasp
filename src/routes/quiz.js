const express = require("express");
const router = express.Router();
const quizController = require("../controllers/quiz");
const { requireRole } = require("../middleware/auth");
const { ROLES } = require("../utils/auth");

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

/**
 * POST /api/quiz/:quizId/performance
 * Record student performance for a quiz question
 */
router.post("/:quizId/performance", express.json(), quizController.recordPerformanceHandler);

/**
 * POST /api/quiz/:quizId/question/:questionId/check
 * Check if a selected answer is correct (secure server-side validation)
 */
router.post("/:quizId/question/:questionId/check", express.json(), quizController.checkQuestionAnswerHandler);

/**
 * GET /api/quiz/:quizId/scores
 * Get scores for a quiz with student data (Instructors only)
 */
router.get("/:quizId/scores", requireRole(ROLES.STAFF), quizController.getQuizScoresHandler);

module.exports = router;

