const express = require("express");
const router = express.Router();
const { getStudentCourses } = require('../services/user-course');
const quizService = require('../services/quiz');
const achievementService = require('../services/achievement');
const { getCourseById } = require('../services/course');

// Get courses for the current student
router.get("/courses", async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User not authenticated"
      });
    }

    const courses = await getStudentCourses(userId);

    res.json({
      success: true,
      courses: courses,
    });
  } catch (error) {
    console.error("[Student API] Error fetching student courses:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch student courses",
    });
  }
});



// Start a quiz
router.post("/quizzes/:quizId/start", async (req, res) => {
  try {
    const { quizId } = req.params;

    const quiz = await quizService.getQuizById(quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    if (!quiz.published) {
      return res.status(403).json({
        success: false,
        message: "This quiz is not available. Only published quizzes can be accessed.",
      });
    }

    // Verify quiz has approved questions
    const questions = await quizService.getQuizQuestions(quizId, true); // approvedOnly = true
    if (!questions || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: "This quiz has no approved questions available.",
      });
    }

    const sessionId = `session_${Date.now()}_${quizId}`;

    res.json({
      success: true,
      data: {
        quizId: quizId,
        sessionId: sessionId,
        message: "Quiz started successfully",
      },
    });
  } catch (error) {
    console.error("Error starting quiz:", error);
    res.status(500).json({
      success: false,
      message: "Failed to start quiz",
      error: error.message,
    });
  }
});

// Helper function to shuffle an array (Fisher-Yates algorithm)
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Helper function to shuffle question options and update correct answer
function shuffleQuestionOptions(question) {
  const optionKeys = ['A', 'B', 'C', 'D'];
  const originalCorrectAnswer = question.correctAnswer;
  // If options are objects {A: "text", ...}
  const correctOptionText = question.options[originalCorrectAnswer];

  // Create array of option entries and shuffle
  const optionEntries = optionKeys.map(key => ({
    key,
    text: question.options[key]
  }));
  const shuffledEntries = shuffleArray(optionEntries);

  // Rebuild options object with shuffled order
  const newOptions = {};
  let newCorrectAnswer = 'A';

  shuffledEntries.forEach((entry, index) => {
    const newKey = optionKeys[index];
    newOptions[newKey] = entry.text;

    // Track where the correct answer moved to
    if (entry.text === correctOptionText) {
      newCorrectAnswer = newKey;
    }
  });

  return {
    ...question,
    options: newOptions,
    correctAnswer: newCorrectAnswer
  };
}

// Get quiz questions (for students - only published quizzes with approved questions)
router.get("/quizzes/:quizId/questions", async (req, res) => {
  try {
    const { quizId } = req.params;

    // First, verify the quiz exists and is published
    const quiz = await quizService.getQuizById(quizId);
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    if (!quiz.published) {
      return res.status(403).json({
        success: false,
        message: "This quiz is not available. Only published quizzes can be accessed.",
      });
    }

    // Get questions, but only approved ones (for students)
    const questions = await quizService.getQuizQuestions(quizId, true); // approvedOnly = true

    if (!questions || questions.length === 0) {
      return res.json({
        success: true,
        data: {
          quizId: quizId,
          title: quiz.name || "Quiz",
          course: "",
          duration: 0,
          questions: [],
        },
        message: "No approved questions available for this quiz",
      });
    }

    const transformedQuestions = questions.map((q, index) => {
      let optionsObj = {};
      if (q.options && typeof q.options === 'object') {
        if (!Array.isArray(q.options)) {
          optionsObj = {
            A: (q.options.A?.text || q.options.A || "").toString(),
            B: (q.options.B?.text || q.options.B || "").toString(),
            C: (q.options.C?.text || q.options.C || "").toString(),
            D: (q.options.D?.text || q.options.D || "").toString()
          };
        } else {
          optionsObj = {
            A: (q.options[0]?.text || q.options[0] || "").toString(),
            B: (q.options[1]?.text || q.options[1] || "").toString(),
            C: (q.options[2]?.text || q.options[2] || "").toString(),
            D: (q.options[3]?.text || q.options[3] || "").toString()
          };
        }
      }

      const questionText = (q.title || q.stem || "").trim();

      return {
        id: q._id ? (q._id.toString ? q._id.toString() : String(q._id)) : String(q.id || index + 1),
        question: questionText || "Question text not available",
        options: optionsObj,
        correctAnswer: (q.correctAnswer || "A").toString().toUpperCase(),
      };
    });

    let courseName = "";
    if (quiz.courseId) {
      try {
        const course = await getCourseById(quiz.courseId.toString());
        if (course) {
          courseName = course.courseName || "";
        }
      } catch (courseError) {
        console.error("Error fetching course name:", courseError);
      }
    }

    const shuffledQuestions = shuffleArray(transformedQuestions);
    const randomizedQuestions = shuffledQuestions.map(q => shuffleQuestionOptions(q));

    res.json({
      success: true,
      data: {
        quizId: quizId,
        title: quiz.name || "Quiz",
        course: courseName,
        duration: 0,
        questions: randomizedQuestions,
      },
      message: "Quiz questions retrieved successfully",
    });
  } catch (error) {
    console.error("Error fetching quiz questions:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch quiz questions",
      error: error.message,
    });
  }
});

// Submit quiz answers
router.post("/quizzes/:quizId/submit", express.json(), async (req, res) => {
  try {
    const { quizId } = req.params;
    const { answers, timeSpent, sessionId, score: clientScore, correctAnswers: clientCorrectAnswers, totalQuestions: clientTotalQuestions } = req.body;

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({
        success: false,
        message: "Answers are required",
      });
    }

    const quiz = await quizService.getQuizById(quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    if (!quiz.published) {
      return res.status(403).json({
        success: false,
        message: "This quiz is not available.",
      });
    }

    // Validation
    const questions = await quizService.getQuizQuestions(quizId, true);
    const totalQuestions = questions ? questions.length : 0;

    if (totalQuestions === 0) {
      return res.status(400).json({
        success: false,
        message: "This quiz has no approved questions.",
      });
    }

    const score = Number(clientScore);
    const correctAnswers = Number(clientCorrectAnswers) || 0;

    // Award achievements
    let newAchievements = [];
    try {
      const userId = req.user._id || req.user.id;
      const courseId = quiz.courseId;
      const quizName = quiz.name || "Quiz";

      if (userId && courseId) {
        newAchievements = await achievementService.awardQuizAchievements(
          userId.toString(),
          courseId.toString(),
          quizId,
          quizName,
          score
        );
      }
    } catch (achievementError) {
      console.error("Error awarding achievements:", achievementError);
    }

    res.json({
      success: true,
      data: {
        quizId: quizId,
        sessionId: sessionId,
        score: score,
        correctAnswers: correctAnswers,
        totalQuestions: totalQuestions,
        timeSpent: timeSpent,
        submittedAt: new Date().toISOString(),
        message: "Quiz submitted successfully",
        newAchievements: newAchievements,
      },
      message: "Quiz submitted successfully",
    });
  } catch (error) {
    console.error("Error submitting quiz:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit quiz",
      error: error.message,
    });
  }
});

router.get("/quizzes/:quizId/results", async (req, res) => {
  res.status(501).json({
    success: false,
    message: "Quiz history not implemented yet"
  });
});

// Get student profile/achievements
router.get("/profile", async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    // Get aggregated data
    const achievements = await achievementService.getUserAchievements(userId);
    const achievementCounts = await achievementService.getAchievementCounts(userId);

    const studentCourses = await getStudentCourses(userId);
    const courseNames = studentCourses.map(c => c.course.courseCode || c.course.courseName);

    const totalQuizzes = 0;
    const completedQuizzes = achievementCounts.quiz_completed || 0;

    const profile = {
      studentId: req.user.puid || "unknown",
      name: req.user.displayName || "Student",
      email: req.user.email || "",
      courses: courseNames,
      totalQuizzes: totalQuizzes,
      completedQuizzes: completedQuizzes,
      averageScore: 0,
      achievements: achievements.map(a => ({
        id: a._id,
        name: a.title,
        description: a.description,
        earnedAt: a.earnedAt,
        icon: a.icon
      })),
      streak: {
        current: 0,
        longest: 0,
      },
    };

    res.json({
      success: true,
      data: profile,
      message: "Student profile retrieved successfully",
    });
  } catch (error) {
    console.error("Error fetching student profile:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch student profile",
      error: error.message,
    });
  }
});

module.exports = router;
