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
    const { courseId, name, description, releaseDate, expireDate, questionLimit } = req.body;
    
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
      expireDate,
      questionLimit 
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
    const { name, description, published, releaseDate, expireDate, questionLimit } = req.body;
    
    // Get existing quiz to check current values
    const existingQuiz = await quizService.getQuizById(quizId);
    if (!existingQuiz) {
      return res.status(404).json({ success: false, error: "Quiz not found" });
    }

    // Validation for publishing: a quiz must have a release date and a question limit > 0
    const finalPublished = published !== undefined ? published : existingQuiz.published;
    
    if (finalPublished === true) {
      // Check final state of releaseDate and questionLimit
      const finalReleaseDate = releaseDate !== undefined ? releaseDate : existingQuiz.releaseDate;
      const finalQuestionLimit = questionLimit !== undefined ? questionLimit : existingQuiz.questionLimit;

      if (!finalReleaseDate) {
        return res.status(400).json({ 
          success: false, 
          error: "A published quiz must have a release date." 
        });
      }

      if (!finalQuestionLimit || parseInt(finalQuestionLimit) <= 0) {
        return res.status(400).json({ 
          success: false, 
          error: "A published quiz must have a question limit greater than 0." 
        });
      }
    }

    const result = await quizService.updateQuiz(quizId, { 
      name, 
      description, 
      published,
      releaseDate,
      expireDate,
      questionLimit
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

/**
 * Get all questions in a quiz
 */
const getQuizQuestionsHandler = async (req, res) => {
  try {
    const { quizId } = req.params;
    const { approvedOnly } = req.query;
    const approvedOnlyBool = approvedOnly === 'true' || approvedOnly === true;
    
    // Always use personalized selection logic, treating everyone as a student.
    // There is no 'full bank view' for taking or previewing quizzes.
    const userId = req.user ? (req.user._id || req.user.id) : null;
    const questions = await quizService.getQuizQuestionsForStudent(quizId, userId);
    
    res.json({ success: true, questions });
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

module.exports = {
  getQuizzesByCourseHandler,
  getQuizByIdHandler,
  createQuizHandler,
  updateQuizHandler,
  deleteQuizHandler,
  addQuizQuestionsHandler,
  getQuizQuestionsHandler,
  recordPerformanceHandler
};
