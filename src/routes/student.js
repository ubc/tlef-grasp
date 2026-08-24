const express = require("express");
const router = express.Router();
const studentController = require('../controllers/student');
const {
  requireActiveCourse,
  resolveCourseFromQuiz,
} = require('../middleware/course-archive');

// The hard cut for students. These are the routes an already-open quiz tab
// calls, so this gate is what turns "the instructor archived the course" into
// an immediate refusal mid-attempt rather than a silently accepted submission.
router.use("/quizzes/:quizId", requireActiveCourse({ resolve: resolveCourseFromQuiz }));

// Get courses for the current student
router.get("/courses", studentController.getStudentCoursesHandler);

// Start a quiz
router.post("/quizzes/:quizId/start", studentController.startQuizHandler);

// Get quiz questions (for students - only published quizzes with approved questions)
router.get("/quizzes/:quizId/questions", studentController.getQuizQuestionsHandler);

// Submit quiz answers
router.post("/quizzes/:quizId/submit", express.json(), studentController.submitQuizHandler);

// Get quiz results
router.get("/quizzes/:quizId/results", studentController.getQuizResultsHandler);

module.exports = router;
