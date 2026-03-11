const { getStudentCourses } = require('../services/user-course');
const quizService = require('../services/quiz');
const achievementService = require('../services/achievement');
const { getCourseById } = require('../services/course');
const { ObjectId } = require('mongodb');
const databaseService = require('../services/database');

const isQuizAccessible = (quiz) => {
  if (!quiz) return { success: false, status: 404, message: "Quiz not found" };
  if (!quiz.published) return { success: false, status: 403, message: "This quiz is not available. Only published quizzes can be accessed." };

  const now = new Date();
  if (quiz.releaseDate && new Date(quiz.releaseDate) > now) {
    return { 
      success: false, 
      status: 403, 
      message: `This quiz is not yet available. It will be released on ${new Date(quiz.releaseDate).toLocaleString()}.` 
    };
  }

  if (quiz.expireDate && new Date(quiz.expireDate) < now) {
    return { 
      success: false, 
      status: 403, 
      message: "This quiz has expired and is no longer available." 
    };
  }

  return { success: true };
};

const getStudentCoursesHandler = async (req, res) => {
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
};

const startQuizHandler = async (req, res) => {
  try {
    const { quizId } = req.params;

    const quiz = await quizService.getQuizById(quizId);

    const accessibility = isQuizAccessible(quiz);
    if (!accessibility.success) {
      return res.status(accessibility.status).json({
        success: false,
        message: accessibility.message,
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
};

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

const getQuizQuestionsHandler = async (req, res) => {
  try {
    const { quizId } = req.params;

    // First, verify the quiz exists and is published
    const quiz = await quizService.getQuizById(quizId);
    const accessibility = isQuizAccessible(quiz);
    if (!accessibility.success) {
      return res.status(accessibility.status).json({
        success: false,
        message: accessibility.message,
      });
    }

    // Get personalized questions for the student
    const userId = req.user._id || req.user.id;
    const questions = await quizService.getQuizQuestionsForStudent(quizId, userId);

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
        // Keep metadata for performance tracking
        learningObjectiveId: q.learningObjectiveId,
        granularObjectiveId: q.granularObjectiveId,
        bloom: q.bloom
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

    // Questions are already selected and ordered by service logic (LO distribution, etc.)
    // We just need to shuffle options for each question
    const randomizedQuestions = transformedQuestions.map(q => shuffleQuestionOptions(q));

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
};

const submitQuizHandler = async (req, res) => {
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

    const accessibility = isQuizAccessible(quiz);
    if (!accessibility.success) {
      return res.status(accessibility.status).json({
        success: false,
        message: accessibility.message,
      });
    }

    // Validation
    const totalQuestions = Number(clientTotalQuestions) || (req.body.feedback ? Object.keys(req.body.feedback).length : 0);

    if (totalQuestions === 0) {
      return res.status(400).json({
        success: false,
        message: "This quiz submission has no questions.",
      });
    }

    const score = Number(clientScore);
    const correctAnswers = Number(clientCorrectAnswers) || 0;

    // Record performance and Award achievements
    let newAchievements = [];
    try {
      const userId = req.user._id || req.user.id;
      const courseId = quiz.courseId;
      const quizName = quiz.name || "Quiz";
      
      // Accept feedback results from the client (which were securely verified server-side per click)
      const { feedback } = req.body;

      if (userId && courseId && feedback) {
        const submittedQuestionIds = Object.keys(feedback).map(id => {
            return ObjectId.isValid(id) ? new ObjectId(id) : id;
        });

        const db = await databaseService.connect();
        const rawSubmittedQuestions = await db.collection("grasp_question").find({
            _id: { $in: submittedQuestionIds }
        }).toArray();
        const enrichedSubmittedQuestions = await quizService.enrichQuestionsWithLO(rawSubmittedQuestions);

        // Build a fast lookup map for questions to extract LOs and Blooms
        const questionLookup = {};
        enrichedSubmittedQuestions.forEach(q => questionLookup[q._id.toString()] = q);

        // Record performance for each question answered in this session
        for (const questionId of Object.keys(feedback)) {
            const questionData = questionLookup[questionId];
            const feedbackResult = feedback[questionId];
            
            if (questionData && feedbackResult) {
                await quizService.saveStudentPerformance({
                    userId: userId.toString(),
                    quizId,
                    questionId,
                    learningObjectiveId: questionData.learningObjectiveId,
                    granularObjectiveId: questionData.granularObjectiveId,
                    bloom: questionData.bloom,
                    isCorrect: !!feedbackResult.isCorrect
                });
            }
        }

        // Award achievements
        newAchievements = await achievementService.awardQuizAchievements(
          userId.toString(),
          courseId.toString(),
          quizId,
          quizName,
          score
        );
      }
    } catch (performanceError) {
      console.error("Error recording performance or awarding achievements:", performanceError);
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
};

const getQuizResultsHandler = async (req, res) => {
  res.status(501).json({
    success: false,
    message: "Quiz history not implemented yet"
  });
};



module.exports = {
  getStudentCoursesHandler,
  startQuizHandler,
  getQuizQuestionsHandler,
  submitQuizHandler,
  getQuizResultsHandler
};
