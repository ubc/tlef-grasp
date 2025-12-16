const express = require("express");
const router = express.Router();
const llmService = require("../services/llm");

/**
 * POST /api/llm/summary
 * Generate a summary from course materials
 */
router.post("/summary", async (req, res) => {
  try {
    const { course, files, urls } = req.body;

    if (!course) {
      return res.status(400).json({
        success: false,
        error: "Course name is required",
      });
    }

    const summary = await llmService.generateSummary(course, files || [], urls || []);

    res.json({
      success: true,
      summary: summary,
    });
  } catch (error) {
    console.error("Error generating summary:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to generate summary",
    });
  }
});

/**
 * POST /api/llm/questions
 * Generate questions from course content and objectives
 */
router.post("/questions", async (req, res) => {
  try {
    const { course, summary, objectiveGroups } = req.body;

    if (!course) {
      return res.status(400).json({
        success: false,
        error: "Course name is required",
      });
    }

    if (!summary) {
      return res.status(400).json({
        success: false,
        error: "Summary is required",
      });
    }

    if (!objectiveGroups || !Array.isArray(objectiveGroups) || objectiveGroups.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Objective groups are required",
      });
    }

    const questions = await llmService.generateQuestions(course, summary, objectiveGroups);

    res.json({
      success: true,
      questions: questions,
    });
  } catch (error) {
    console.error("Error generating questions:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to generate questions",
    });
  }
});

module.exports = router;
