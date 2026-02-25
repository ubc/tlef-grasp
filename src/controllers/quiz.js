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
    const { courseId, name, description } = req.body;
    
    if (!courseId || !name) {
      return res.status(400).json({
        success: false,
        error: "Course ID and quiz name are required",
      });
    }
    
    const quiz = await quizService.createQuiz(courseId, { name, description });
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
    const { name, description, published } = req.body;
    
    // Check if user is trying to publish/unpublish - only faculty can do this
    if (published !== undefined && !(await isFaculty(req.user))) {
      return res.status(403).json({ 
        success: false, 
        error: "Only faculty can publish or unpublish quizzes" 
      });
    }
    
    const result = await quizService.updateQuiz(quizId, { name, description, published });
    
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
    const questions = await quizService.getQuizQuestions(quizId, approvedOnlyBool);
    res.json({ success: true, questions });
  } catch (error) {
    console.error("Error fetching quiz questions:", error);
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
  getQuizQuestionsHandler
};
