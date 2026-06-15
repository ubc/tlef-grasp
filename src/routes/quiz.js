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
 * GET /api/quiz/course/:courseId/with-questions
 * All quizzes for a course with their questions attached (staff and above —
 * the instructor view includes correct answers).
 */
router.get(
  "/course/:courseId/with-questions",
  requireRole(ROLES.STAFF),
  quizController.getQuizzesByCourseWithQuestionsHandler
);

/**
 * GET /api/quiz/course/:courseId/student-overview
 * Published, currently-open quizzes with the student's personalized question
 * counts. No question content or answers are included.
 */
router.get(
  "/course/:courseId/student-overview",
  quizController.getStudentQuizOverviewHandler
);

router.get("/my-scores", quizController.getMyScoresHandler);

/**
 * GET /api/quiz/:quizId
 * Get a quiz by ID
 */
router.get("/:quizId", quizController.getQuizByIdHandler);

/**
 * POST /api/quiz
 * Create a new quiz
 */
router.post("/", requireRole(ROLES.FACULTY), quizController.createQuizHandler);

/**
 * PUT /api/quiz/:quizId
 * Update a quiz
 */
router.put("/:quizId", requireRole(ROLES.FACULTY), quizController.updateQuizHandler);

/**
 * DELETE /api/quiz/:quizId
 * Delete a quiz
 */
router.delete("/:quizId", requireRole(ROLES.FACULTY), quizController.deleteQuizHandler);

/**
 * POST /api/quiz/:quizId/questions
 * Add questions to a quiz
 */
router.post("/:quizId/questions", requireRole(ROLES.FACULTY), quizController.addQuizQuestionsHandler);

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
router.post("/:quizId/performance", quizController.recordPerformanceHandler);

/**
 * POST /api/quiz/:quizId/question/:questionId/check
 * Check if a selected answer is correct (secure server-side validation)
 */
router.post("/:quizId/question/:questionId/check", quizController.checkQuestionAnswerHandler);

/**
 * GET /api/quiz/:quizId/scores
 * Get scores for a quiz with student data (Instructors only)
 */
router.get("/:quizId/scores", requireRole(ROLES.STAFF), quizController.getQuizScoresHandler);

/**
 * GET /api/quiz/:quizId/student/:userId/attempts
 * Get detailed student attempt answers for a specific quiz (Instructors only)
 */
router.get("/:quizId/student/:userId/attempts", requireRole(ROLES.STAFF), quizController.getStudentQuizAttemptHandler);

/**
 * PUT /api/quiz/:quizId/student/:userId/grade
 * Grade an open-ended question for a student (Faculty only)
 */
router.put("/:quizId/student/:userId/grade", requireRole(ROLES.FACULTY), express.json(), quizController.gradeOpenEndedHandler);

module.exports = router;

