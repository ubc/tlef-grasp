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
router.post("/quizzes/:quizId/start", (req, res) => {
  try {
    const { quizId } = req.params;

    const quiz = mockStudentQuizzes.find((q) => q.id === quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    // In a real application, you would:
    // 1. Check if the student can start the quiz (not expired, not already completed, etc.)
    // 2. Create a quiz session
    // 3. Return the quiz questions and session info

    res.json({
      success: true,
      data: {
        quizId: quiz.id,
        sessionId: `session_${Date.now()}`,
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

// Get quiz questions
router.get("/quizzes/:quizId/questions", (req, res) => {
  try {
    const { quizId } = req.params;

    const quiz = mockStudentQuizzes.find((q) => q.id === quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    // Mock quiz questions
    const mockQuestions = [
      {
        id: 1,
        question: "What is the time complexity of binary search algorithm?",
        options: [
          { letter: "A", text: "O(n)" },
          { letter: "B", text: "O(log n)" },
          { letter: "C", text: "O(n²)" },
          { letter: "D", text: "O(1)" },
        ],
        correctAnswer: "B",
      },
      {
        id: 2,
        question: "Which data structure uses LIFO principle?",
        options: [
          { letter: "A", text: "Queue" },
          { letter: "B", text: "Stack" },
          { letter: "C", text: "Array" },
          { letter: "D", text: "Linked List" },
        ],
        correctAnswer: "B",
      },
      {
        id: 3,
        question: "What is the worst-case time complexity of quicksort?",
        options: [
          { letter: "A", text: "O(n log n)" },
          { letter: "B", text: "O(n²)" },
          { letter: "C", text: "O(n)" },
          { letter: "D", text: "O(log n)" },
        ],
        correctAnswer: "B",
      },
      {
        id: 4,
        question: "Which sorting algorithm is stable?",
        options: [
          { letter: "A", text: "Quicksort" },
          { letter: "B", text: "Heapsort" },
          { letter: "C", text: "Merge sort" },
          { letter: "D", text: "Selection sort" },
        ],
        correctAnswer: "C",
      },
      {
        id: 5,
        question: "What is the space complexity of recursive binary search?",
        options: [
          { letter: "A", text: "O(1)" },
          { letter: "B", text: "O(log n)" },
          { letter: "C", text: "O(n)" },
          { letter: "D", text: "O(n log n)" },
        ],
        correctAnswer: "B",
      },
    ];

    res.json({
      success: true,
      data: {
        quizId: quiz.id,
        title: quiz.title,
        course: quiz.course,
        duration: parseInt(quiz.timeLimit),
        questions: mockQuestions,
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
router.post("/quizzes/:quizId/submit", (req, res) => {
  try {
    const { quizId } = req.params;
    const { answers, timeSpent, sessionId } = req.body;

    const quiz = mockStudentQuizzes.find((q) => q.id === quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    // In a real application, you would:
    // 1. Validate the session
    // 2. Check if the quiz is still active
    // 3. Calculate the score
    // 4. Save the results to the database
    // 5. Update the student's progress

    // Mock score calculation
    const totalQuestions = 5; // This would come from the actual quiz data
    const correctAnswers = Math.floor(Math.random() * totalQuestions) + 1; // Random for demo
    const score = Math.round((correctAnswers / totalQuestions) * 100);

    res.json({
      success: true,
      data: {
        quizId: quiz.id,
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
