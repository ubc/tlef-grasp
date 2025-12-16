const express = require("express");
const router = express.Router();
const databaseService = require("../services/database");

// Save quiz questions to MongoDB
router.post("/save", express.json(), async (req, res) => {
  try {
    const { courseName, quizName, quizWeek, questions } = req.body;

    if (!courseName || !quizName || !questions || !Array.isArray(questions)) {
      return res.status(400).json({
        error:
          "Missing required fields: courseName, quizName, and questions array",
      });
    }

    // Transform questions to include all required fields
    const questionsToSave = questions.map((question, index) => ({
      courseName,
      quizName,
      quizWeek: quizWeek || `Week ${index + 1}`,
      learningObjective:
        question.learningObjective ||
        question.loCode ||
        `LO ${Math.floor(Math.random() * 5) + 1}.${
          Math.floor(Math.random() * 3) + 1
        }`,
      bloomsLevel:
        question.bloomsLevel ||
        question.bloom ||
        (question.difficulty === "easy"
          ? "Remember"
          : question.difficulty === "medium"
          ? "Understand"
          : "Analyze"),
      questionText:
        question.questionText ||
        question.content ||
        question.title ||
        `Question ${index + 1}`,
      questionType: question.questionType || question.type || "multiple-choice",
      difficulty: question.difficulty || "medium",
      options: question.options || [],
      correctAnswer: question.correctAnswer,
      explanation: question.explanation || "",
      status: question.status || "Draft",
      views: question.views || 0,
      flagged: question.flagged || false,
      published: question.published || false,
    }));

    const result = await databaseService.saveQuizQuestions(questionsToSave);

    res.json({
      success: true,
      message: `${questionsToSave.length} questions saved successfully`,
      insertedCount: result.insertedCount,
      insertedIds: result.insertedIds,
    });
  } catch (error) {
    console.error("Error saving quiz questions:", error);
    res.status(500).json({ error: "Failed to save quiz questions" });
  }
});

// Get all quiz questions
router.get("/", async (req, res) => {
  try {
    const { courseName, quizName, status } = req.query;

    const filters = {};
    if (courseName) filters.courseName = courseName;
    if (quizName) filters.quizName = quizName;
    if (status) filters.status = status;

    const questions = await databaseService.getQuizQuestions(filters);

    res.json({
      success: true,
      questions: questions,
      count: questions.length,
    });
  } catch (error) {
    console.error("Error getting quiz questions:", error);
    res.status(500).json({ error: "Failed to retrieve quiz questions" });
  }
});

// Get quiz questions by course
router.get("/course/:courseName", async (req, res) => {
  try {
    const { courseName } = req.params;
    const questions = await databaseService.getQuizQuestionsByCourse(
      courseName
    );

    res.json({
      success: true,
      questions: questions,
      count: questions.length,
    });
  } catch (error) {
    console.error("Error getting quiz questions by course:", error);
    res.status(500).json({ error: "Failed to retrieve quiz questions" });
  }
});

// Get quiz questions grouped by quiz
router.get("/quizzes", async (req, res) => {
  try {
    const { courseName } = req.query;

    const filters = {};
    if (courseName) filters.courseName = courseName;

    const questions = await databaseService.getQuizQuestions(filters);

    // Group questions by quiz
    const quizGroups = {};
    questions.forEach((question) => {
      const quizKey = `${question.courseName}-${question.quizName}`;
      if (!quizGroups[quizKey]) {
        quizGroups[quizKey] = {
          courseName: question.courseName,
          quizName: question.quizName,
          quizWeek: question.quizWeek,
          questions: [],
        };
      }
      quizGroups[quizKey].questions.push(question);
    });

    const quizzes = Object.values(quizGroups);

    res.json({
      success: true,
      quizzes: quizzes,
      count: quizzes.length,
    });
  } catch (error) {
    console.error("Error getting quiz groups:", error);
    res.status(500).json({ error: "Failed to retrieve quiz groups" });
  }
});

// Update quiz question
router.put("/:questionId", express.json(), async (req, res) => {
  try {
    const { questionId } = req.params;
    const updateData = req.body;

    const result = await databaseService.updateQuizQuestion(
      questionId,
      updateData
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Question not found" });
    }

    res.json({
      success: true,
      message: "Question updated successfully",
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Error updating quiz question:", error);
    res.status(500).json({ error: "Failed to update question" });
  }
});

// Delete quiz question
router.delete("/:questionId", async (req, res) => {
  try {
    const { questionId } = req.params;

    const result = await databaseService.deleteQuizQuestion(questionId);

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Question not found" });
    }

    res.json({
      success: true,
      message: "Question deleted successfully",
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Error deleting quiz question:", error);
    res.status(500).json({ error: "Failed to delete question" });
  }
});

// Get unique courses
router.get("/courses", async (req, res) => {
  try {
    const questions = await databaseService.getQuizQuestions();
    const courses = [...new Set(questions.map((q) => q.courseName))];

    res.json({
      success: true,
      courses: courses,
    });
  } catch (error) {
    console.error("Error getting courses:", error);
    res.status(500).json({ error: "Failed to retrieve courses" });
  }
});

// Get unique learning objectives
router.get("/objectives", async (req, res) => {
  try {
    const { courseName } = req.query;

    const filters = {};
    if (courseName) filters.courseName = courseName;

    const questions = await databaseService.getQuizQuestions(filters);
    const objectives = [...new Set(questions.map((q) => q.learningObjective))];

    res.json({
      success: true,
      objectives: objectives,
    });
  } catch (error) {
    console.error("Error getting learning objectives:", error);
    res.status(500).json({ error: "Failed to retrieve learning objectives" });
  }
});

// Get unique bloom levels
router.get("/bloom-levels", async (req, res) => {
  try {
    const { courseName } = req.query;

    const filters = {};
    if (courseName) filters.courseName = courseName;

    const questions = await databaseService.getQuizQuestions(filters);
    const bloomLevels = [...new Set(questions.map((q) => q.bloomsLevel))];

    res.json({
      success: true,
      bloomLevels: bloomLevels,
    });
  } catch (error) {
    console.error("Error getting bloom levels:", error);
    res.status(500).json({ error: "Failed to retrieve bloom levels" });
  }
});

module.exports = router;
