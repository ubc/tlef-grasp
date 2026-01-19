const express = require("express");
const router = express.Router();

// Mock student quiz data
const mockStudentQuizzes = [
  {
    id: "CS101-Lecture3",
    title: "CS101 Lecture 3",
    course: "CS101",
    objective: "lecture3",
    week: "week3",
    completion: 0,
    dueDate: "Dec 15, 2024",
    timeLimit: "30 min",
    questionCount: 15,
    status: "not-started",
  },
  {
    id: "CS101-Lecture4",
    title: "CS101 Lecture 4",
    course: "CS101",
    objective: "lecture4",
    week: "week4",
    completion: 40,
    dueDate: "Dec 20, 2024",
    timeLimit: "45 min",
    questionCount: 20,
    status: "in-progress",
  },
  {
    id: "MATH200-Lecture5",
    title: "MATH200 Lecture 5",
    course: "MATH200",
    objective: "lecture5",
    week: "week5",
    completion: 100,
    dueDate: "Dec 10, 2024",
    timeLimit: "60 min",
    questionCount: 25,
    status: "completed",
  },
  {
    id: "PHYS150-Lecture2",
    title: "PHYS150 Lecture 2",
    course: "PHYS150",
    objective: "lecture2",
    week: "week2",
    completion: 60,
    dueDate: "Dec 25, 2024",
    timeLimit: "40 min",
    questionCount: 18,
    status: "in-progress",
  },
  {
    id: "CS101-Lecture1",
    title: "CS101 Lecture 1",
    course: "CS101",
    objective: "lecture1",
    week: "week1",
    completion: 100,
    dueDate: "Nov 30, 2024",
    timeLimit: "25 min",
    questionCount: 12,
    status: "completed",
  },
  {
    id: "MATH200-Lecture3",
    title: "MATH200 Lecture 3",
    course: "MATH200",
    objective: "lecture3",
    week: "week3",
    completion: 0,
    dueDate: "Dec 28, 2024",
    timeLimit: "50 min",
    questionCount: 22,
    status: "not-started",
  },
];

// Get all quizzes for a student
router.get("/quizzes", (req, res) => {
  try {
    // In a real application, you would:
    // 1. Get the student ID from the session/auth
    // 2. Query the database for their quizzes
    // 3. Return the actual data

    // For now, return mock data
    res.json({
      success: true,
      data: mockStudentQuizzes,
      message: "Student quizzes retrieved successfully",
    });
  } catch (error) {
    console.error("Error fetching student quizzes:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch student quizzes",
      error: error.message,
    });
  }
});

// Get a specific quiz by ID
router.get("/quizzes/:quizId", (req, res) => {
  try {
    const { quizId } = req.params;

    const quiz = mockStudentQuizzes.find((q) => q.id === quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    res.json({
      success: true,
      data: quiz,
      message: "Quiz retrieved successfully",
    });
  } catch (error) {
    console.error("Error fetching quiz:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch quiz",
      error: error.message,
    });
  }
});

// Start a quiz
router.post("/quizzes/:quizId/start", async (req, res) => {
  try {
    const { quizId } = req.params;

    // Log the quizId for debugging
    console.log("Starting quiz with ID:", quizId, "Type:", typeof quizId);

    // Use the quiz service to get the quiz
    const quizService = require("../services/quiz");
    const quiz = await quizService.getQuizById(quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    // Check if quiz is published - students can only start published quizzes
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

    // Create a quiz session
    // TODO: In a real application, you would:
    // 1. Check if the student can start the quiz (not expired, not already completed, etc.)
    // 2. Store the session in the database
    // 3. Track start time, etc.

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

// Get quiz questions (for students - only published quizzes with approved questions)
router.get("/quizzes/:quizId/questions", async (req, res) => {
  try {
    const { quizId } = req.params;

    // Use the quiz service to get quiz and questions
    const quizService = require("../services/quiz");
    
    // First, verify the quiz exists and is published
    const quiz = await quizService.getQuizById(quizId);
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    // Check if quiz is published - students can only access published quizzes
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

    // Debug: Log first question structure
    if (questions.length > 0) {
      console.log("Sample question structure:", {
        hasStem: !!questions[0].stem,
        hasTitle: !!questions[0].title,
        stem: questions[0].stem,
        title: questions[0].title,
        options: questions[0].options,
        correctAnswer: questions[0].correctAnswer
      });
    }

    // Transform questions to match expected format
    // Frontend expects options as an object with keys A, B, C, D containing text strings
    const transformedQuestions = questions.map((q, index) => {
      // Ensure options is an object (not array) with A, B, C, D keys
      let optionsObj = {};
      if (q.options && typeof q.options === 'object') {
        // If options is already an object, use it
        if (!Array.isArray(q.options)) {
          // Options might be nested objects with 'text' property or simple strings
          optionsObj = {
            A: (q.options.A?.text || q.options.A || "").toString(),
            B: (q.options.B?.text || q.options.B || "").toString(),
            C: (q.options.C?.text || q.options.C || "").toString(),
            D: (q.options.D?.text || q.options.D || "").toString()
          };
        } else {
          // If options is an array, convert to object
          optionsObj = {
            A: (q.options[0]?.text || q.options[0] || "").toString(),
            B: (q.options[1]?.text || q.options[1] || "").toString(),
            C: (q.options[2]?.text || q.options[2] || "").toString(),
            D: (q.options[3]?.text || q.options[3] || "").toString()
          };
        }
      }

      // Get question text - prefer title (full question), fallback to stem
      // Title usually contains the full question, stem might just be a prefix like "Select the best answer:"
      const questionText = (q.title || q.stem || "").trim();
      if (!questionText) {
        console.warn(`Question ${index} (ID: ${q._id}) has no title or stem. Available fields:`, Object.keys(q));
      }

      return {
        id: q._id ? (q._id.toString ? q._id.toString() : String(q._id)) : String(q.id || index + 1),
        question: questionText || "Question text not available",
        options: optionsObj,
        correctAnswer: (q.correctAnswer || "A").toString().toUpperCase(),
      };
    });

    // Get course name if courseId is available
    let courseName = "";
    if (quiz.courseId) {
      try {
        const { getCourseById } = require("../services/course");
        const course = await getCourseById(quiz.courseId.toString());
        if (course) {
          courseName = course.courseName || "";
        }
      } catch (courseError) {
        console.error("Error fetching course name:", courseError);
        // Continue without course name
      }
    }

    res.json({
      success: true,
      data: {
        quizId: quizId,
        title: quiz.name || "Quiz",
        course: courseName,
        duration: 0, // TODO: Add duration field to quiz model if needed
        questions: transformedQuestions,
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
    const { answers, timeSpent, sessionId } = req.body;

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({
        success: false,
        message: "Answers are required",
      });
    }

    // Use the quiz service to get the quiz and questions
    const quizService = require("../services/quiz");
    const quiz = await quizService.getQuizById(quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    // Check if quiz is published
    if (!quiz.published) {
      return res.status(403).json({
        success: false,
        message: "This quiz is not available. Only published quizzes can be accessed.",
      });
    }

    // Get approved questions for this quiz
    const questions = await quizService.getQuizQuestions(quizId, true); // approvedOnly = true

    if (!questions || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: "This quiz has no approved questions.",
      });
    }

    // Calculate score based on actual answers
    let correctAnswers = 0;
    const totalQuestions = questions.length;
    
    // answers is an object with question index as key and selected answer as value
    // e.g., { "0": "A", "1": "B", ... } or { 0: "A", 1: "B", ... }
    questions.forEach((question, index) => {
      // Try both string and number keys
      const userAnswer = answers[String(index)] || answers[index];
      const correctAnswer = question.correctAnswer;
      
      if (userAnswer && correctAnswer) {
        // Normalize answers to uppercase for comparison
        const normalizedUserAnswer = String(userAnswer).toUpperCase().trim();
        const normalizedCorrectAnswer = String(correctAnswer).toUpperCase().trim();
        
        if (normalizedUserAnswer === normalizedCorrectAnswer) {
          correctAnswers++;
        }
      }
    });

    const score = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;

    // TODO: In a real application, you would:
    // 1. Validate the session
    // 2. Check if the quiz is still active
    // 3. Save the results to the database
    // 4. Update the student's progress

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

// Get quiz results/review
router.get("/quizzes/:quizId/results", (req, res) => {
  try {
    const { quizId } = req.params;

    const quiz = mockStudentQuizzes.find((q) => q.id === quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    // For demo purposes, allow results even if completion is not 100%
    // In a real application, you would check if the quiz was actually submitted
    // if (quiz.completion < 100) {
    //   return res.status(400).json({
    //     success: false,
    //     message: "Quiz not completed yet",
    //   });
    // }

    // Mock quiz results with detailed feedback - matching the 5 questions from the quiz
    const mockResults = {
      quizId: quiz.id,
      score: 60,
      totalQuestions: 5,
      correctAnswers: 3,
      timeSpent: "18:45",
      completedAt: new Date().toISOString(),
      questions: [
        {
          id: 1,
          question: "What is the time complexity of binary search algorithm?",
          userAnswer: "O(log n)",
          correctAnswer: "O(log n)",
          isCorrect: true,
          explanation:
            "Correct! Binary search has logarithmic time complexity O(log n) because it eliminates half of the search space with each comparison.",
        },
        {
          id: 2,
          question: "Which data structure uses LIFO principle?",
          userAnswer: "Queue",
          correctAnswer: "Stack",
          isCorrect: false,
          explanation:
            "Incorrect. Stack uses Last In First Out (LIFO) principle, while Queue uses First In First Out (FIFO) principle.",
        },
        {
          id: 3,
          question: "What is the worst-case time complexity of quicksort?",
          userAnswer: "O(n log n)",
          correctAnswer: "O(n²)",
          isCorrect: false,
          explanation:
            "Incorrect. While quicksort has average time complexity of O(n log n), its worst-case time complexity is O(n²) when the pivot is always the smallest or largest element.",
        },
        {
          id: 4,
          question: "Which sorting algorithm is stable?",
          userAnswer: "Merge sort",
          correctAnswer: "Merge sort",
          isCorrect: true,
          explanation:
            "Correct! Merge sort is a stable sorting algorithm, meaning it maintains the relative order of equal elements in the sorted output.",
        },
        {
          id: 5,
          question: "What is the space complexity of recursive binary search?",
          userAnswer: "O(n log n)",
          correctAnswer: "O(log n)",
          isCorrect: false,
          explanation:
            "Incorrect. Recursive binary search has O(log n) space complexity due to the recursive call stack, not O(n log n). Each recursive call uses O(1) space, and the maximum depth is O(log n).",
        },
      ],
    };

    res.json({
      success: true,
      data: mockResults,
      message: "Quiz results retrieved successfully",
    });
  } catch (error) {
    console.error("Error fetching quiz results:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch quiz results",
      error: error.message,
    });
  }
});

// Get student profile/achievements
router.get("/profile", (req, res) => {
  try {
    // Mock student profile
    const mockProfile = {
      studentId: "student_123",
      name: "John Doe",
      email: "john.doe@university.edu",
      courses: ["CS101", "MATH200", "PHYS150"],
      totalQuizzes: 6,
      completedQuizzes: 2,
      averageScore: 82.5,
      achievements: [
        {
          id: "first_quiz",
          name: "First Quiz Complete",
          description: "Completed your first quiz",
          earnedAt: "2024-11-30T10:15:00Z",
          icon: "fas fa-star",
        },
        {
          id: "perfect_score",
          name: "Perfect Score",
          description: "Achieved 100% on a quiz",
          earnedAt: "2024-12-10T14:30:00Z",
          icon: "fas fa-trophy",
        },
      ],
      streak: {
        current: 3,
        longest: 5,
      },
    };

    res.json({
      success: true,
      data: mockProfile,
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
