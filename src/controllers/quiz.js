const quizService = require("../services/quiz");
const questionService = require("../services/question");
const { isFaculty } = require("../utils/auth");

/**
 * Get all quizzes for a course
 */
const getQuizzesByCourseHandler = async (req, res) => {
  try {
    const { courseId } = req.params;
    const quizzes = await quizService.getQuizzesByCourse(courseId);
    res.json({ success: true, quizzes });
  } catch (error) {
    console.error("Error fetching quizzes:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get a quiz by ID
 */
const getQuizByIdHandler = async (req, res) => {
  try {
    const { quizId } = req.params;
    const quiz = await quizService.getQuizById(quizId);
    
    if (!quiz) {
      return res.status(404).json({ success: false, error: "Quiz not found" });
    }
    
    res.json({ success: true, quiz });
  } catch (error) {
    console.error("Error fetching quiz:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Create a new quiz
 */
const createQuizHandler = async (req, res) => {
  try {
    const { courseId, name, description, releaseDate, expireDate } = req.body;
    
    if (!courseId || !name) {
      return res.status(400).json({
        success: false,
        error: "Course ID and quiz name are required",
      });
    }
    
    const quiz = await quizService.createQuiz(courseId, { 
      name, 
      description,
      releaseDate,
      expireDate
    });
    res.status(201).json({ success: true, quiz });
  } catch (error) {
    console.error("Error creating quiz:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Update a quiz
 */
const updateQuizHandler = async (req, res) => {
  try {
    const { quizId } = req.params;
    const { name, description, published, releaseDate, expireDate } = req.body;
    
    // Get existing quiz to check current values
    const existingQuiz = await quizService.getQuizById(quizId);
    if (!existingQuiz) {
      return res.status(404).json({ success: false, error: "Quiz not found" });
    }

    // Validation for publishing: a quiz must have a release date
    const finalPublished = published !== undefined ? published : existingQuiz.published;
    
    if (finalPublished === true) {
      // Check final state of releaseDate
      const finalReleaseDate = releaseDate !== undefined ? releaseDate : existingQuiz.releaseDate;

      if (!finalReleaseDate) {
        return res.status(400).json({ 
          success: false, 
          error: "A published quiz must have a release date." 
        });
      }
    }

    const result = await quizService.updateQuiz(quizId, { 
      name, 
      description, 
      published,
      releaseDate,
      expireDate
    });
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: "Quiz not found" });
    }
    
    res.json({ success: true, result });
  } catch (error) {
    console.error("Error updating quiz:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Delete a quiz
 */
const deleteQuizHandler = async (req, res) => {
  try {
    // Only faculty can delete quizzes
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({ 
        success: false, 
        error: "Only faculty can delete quizzes" 
      });
    }
    
    const { quizId } = req.params;
    const result = await quizService.deleteQuiz(quizId);
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: "Quiz not found" });
    }
    
    res.json({ success: true, result });
  } catch (error) {
    console.error("Error deleting quiz:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Add questions to a quiz
 */
const addQuizQuestionsHandler = async (req, res) => {
  try {
    const { quizId } = req.params;
    const { questions } = req.body;
    
    if (!questions || !Array.isArray(questions)) {
      return res.status(400).json({
        success: false,
        error: "Questions array is required",
      });
    }
    
    // First, save all questions to the database and get their IDs
    const courseId = req.body.courseId;
    if (!courseId) {
      return res.status(400).json({
        success: false,
        error: "Course ID is required",
      });
    }
    
    const savedQuestionIds = [];
    
    for (const questionData of questions) {
      try {
        // Save the question
        const questionResult = await questionService.saveQuestion(courseId, questionData);
        savedQuestionIds.push(questionResult.insertedId.toString());
      } catch (error) {
        console.error("Error saving question:", error);
        // Continue with other questions even if one fails
      }
    }
    
    if (savedQuestionIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No questions were saved successfully",
      });
    }
    
    // Add questions to quiz
    const result = await quizService.addQuestionsToQuiz(quizId, savedQuestionIds);
    
    res.json({
      success: true,
      result,
      questionsAdded: savedQuestionIds.length,
    });
  } catch (error) {
    console.error("Error adding questions to quiz:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Helper function to generate a shuffled order of option indices
function shuffleQuestionOptions(question) {
  const optionIndices = [0, 1, 2, 3];
  const shuffledIndices = shuffleArray(optionIndices);

  return {
    ...question,
    optionOrder: shuffledIndices
    // We intentionally leave correctAnswer and options alone here
    // as they will be cleansed before sending to the client.
  };
}

/**
 * Get all questions in a quiz
 */
const getQuizQuestionsHandler = async (req, res) => {
  try {
    const { quizId } = req.params;
    const { approvedOnly } = req.query;
    const approvedOnlyBool = approvedOnly === 'true' || approvedOnly === true;
    
    let questions;
    
    if (approvedOnlyBool) {
        // Students quiz view: use personalized selection logic
        const userId = req.user ? (req.user._id || req.user.id) : null;
        questions = await quizService.getQuizQuestionsForStudent(quizId, userId);
    } else {
        // Bank full questions view: return all questions for instructors
        questions = await quizService.getQuizQuestions(quizId, false);
    }
    
    const transformedQuestions = questions.map((q, index) => {
      let optionsObj = {};
      if (q.options && typeof q.options === 'object') {
        if (!Array.isArray(q.options)) {
          optionsObj = {
            A: { ...(q.options.A || { text: "" }), index: 0 },
            B: { ...(q.options.B || { text: "" }), index: 1 },
            C: { ...(q.options.C || { text: "" }), index: 2 },
            D: { ...(q.options.D || { text: "" }), index: 3 }
          };
        } else {
          optionsObj = {
            A: { ...(q.options[0] || { text: "" }), index: 0 },
            B: { ...(q.options[1] || { text: "" }), index: 1 },
            C: { ...(q.options[2] || { text: "" }), index: 2 },
            D: { ...(q.options[3] || { text: "" }), index: 3 }
          };
        }
      }
      // If approvedOnlyBool is true, this is the student view. We MUST strip secure answers.
      if (approvedOnlyBool) {
        ['A', 'B', 'C', 'D'].forEach(key => {
          if (optionsObj[key] && typeof optionsObj[key] === 'object') {
            // Strip out feedback before sending to the client browser
            delete optionsObj[key].feedback;
          }
        });
      }

      const questionText = (q.title || q.stem || "").trim();

      const formattedQuestion = {
        ...q,
        id: q._id ? (q._id.toString ? q._id.toString() : String(q._id)) : String(q.id || index + 1),
        question: questionText || "Question text not available",
        options: optionsObj,
        correctAnswer: (q.correctAnswer || "A").toString().toUpperCase()
      };
      
      // Shuffle options for students
      let finalQuestion = approvedOnlyBool ? shuffleQuestionOptions(formattedQuestion) : formattedQuestion;
      
      // Completely strip out the correct answer if this is for the student
      if (approvedOnlyBool) {
        delete finalQuestion.correctAnswer;
      }
      
      return finalQuestion;
    });

    res.json({ success: true, questions: transformedQuestions });
  } catch (error) {
    console.error("Error fetching quiz questions:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Record student performance for a quiz question
 */
const recordPerformanceHandler = async (req, res) => {
    try {
        const { quizId } = req.params;
        const { questionId, learningObjectiveId, granularObjectiveId, bloom, isCorrect } = req.body;
        
        if (!questionId || !bloom || isCorrect === undefined) {
            return res.status(400).json({
                success: false,
                error: "questionId, bloom, and isCorrect are required",
            });
        }
        
        const result = await quizService.saveStudentPerformance({
            userId: req.user._id,
            quizId,
            questionId,
            learningObjectiveId,
            granularObjectiveId,
            bloom,
            isCorrect
        });
        
        res.json({ success: true, result });
    } catch (error) {
        console.error("Error recording student performance:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Check if a selected answer is correct and return the feedback securely
 */
const checkQuestionAnswerHandler = async (req, res) => {
  try {
    const { questionId } = req.params;
    const { selectedIndex } = req.body;

    if (selectedIndex === undefined || selectedIndex === null) {
      return res.status(400).json({ success: false, error: "selectedIndex is required" });
    }

    const { getQuestion } = require('../services/question');
    const question = await getQuestion(questionId);
    
    if (!question) {
      return res.status(404).json({ success: false, error: "Question not found" });
    }
    
    // Convert the numeric index sent by the frontend back to the original DB key mapping
    const optionKeys = ['A', 'B', 'C', 'D'];
    const selectedKey = optionKeys[selectedIndex];

    if (!selectedKey) {
        return res.status(400).json({ success: false, error: "Invalid selectedIndex provided" });
    }

    // Normalize correct answer identifier from DB
    let correctAnswerLetter = question.correctAnswer || 'A';
    if (typeof correctAnswerLetter === 'number') {
      correctAnswerLetter = optionKeys[correctAnswerLetter] || 'A';
    } else if (typeof correctAnswerLetter === 'string') {
      correctAnswerLetter = correctAnswerLetter.toUpperCase();
    }
    
    const isCorrect = selectedKey === correctAnswerLetter;

    // Retrieve feedback specific to the selected option
    const selectedOptionObj = question.options[selectedKey];
    const feedback = typeof selectedOptionObj === 'object' && selectedOptionObj !== null 
      ? (selectedOptionObj.feedback || "")
      : "";

    // Safely retrieve the text of the actual correct option to send back
    const correctOptionObj = question.options[correctAnswerLetter];
    const correctOptionText = typeof correctOptionObj === 'object' && correctOptionObj !== null 
      ? (correctOptionObj.text || "")
      : (correctOptionObj || "");

    res.json({
      success: true,
      isCorrect,
      feedback,
      correctAnswer: isCorrect ? correctAnswerLetter : null,
      correctOptionText: isCorrect ? correctOptionText : null
    });
  } catch (error) {
    console.error("Error checking question answer:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get scores for a quiz with student data (Instructors only)
 */
const getQuizScoresHandler = async (req, res) => {
  try {
    const { quizId } = req.params;
    const scores = await quizService.getQuizScores(quizId);
    
    if (!scores) {
      return res.status(404).json({ success: false, error: "Scores not found" });
    }
    
    res.json({ success: true, data: scores });
  } catch (error) {
    console.error("Error fetching quiz scores:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get detailed student attempt answers for a specific quiz (Instructors only)
 */
const getStudentQuizAttemptHandler = async (req, res) => {
  try {
    const { quizId, userId } = req.params;
    const attempts = await quizService.getStudentQuizAttempt(quizId, userId);
    
    if (!attempts) {
      return res.status(404).json({ success: false, error: "Attempts not found" });
    }
    
    res.json({ success: true, data: attempts });
  } catch (error) {
    console.error("Error fetching student quiz attempts:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getQuizzesByCourseHandler,
  getQuizByIdHandler,
  createQuizHandler,
  updateQuizHandler,
  deleteQuizHandler,
  addQuizQuestionsHandler,
  getQuizQuestionsHandler,
  recordPerformanceHandler,
  checkQuestionAnswerHandler,
  getQuizScoresHandler,
  getStudentQuizAttemptHandler
};
