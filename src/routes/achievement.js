const express = require("express");
const router = express.Router();
const achievementService = require("../services/achievement");
const { isUserInCourse } = require("../services/user-course");

/**
 * Save an achievement
 * POST /api/achievement
 */
router.post("/", express.json(), async (req, res) => {
  try {
    const { userId, courseId, quizId, title, description, type } = req.body;

    if (!userId || !courseId || !quizId) {
      return res.status(400).json({
        success: false,
        error: "User ID, Course ID, and Quiz ID are required"
      });
    }

    // Verify user is in course
    if (!(await isUserInCourse(userId, courseId))) {
      return res.status(403).json({
        success: false,
        error: "User is not in course"
      });
    }

    const achievement = await achievementService.saveAchievement(
      userId,
      courseId,
      quizId,
      {
        title: title || "Perfect Score!",
        description: description || "Answered all questions correctly",
        type: type || "quiz_perfect"
      }
    );

    res.json({
      success: true,
      data: achievement,
      message: "Achievement saved successfully"
    });
  } catch (error) {
    console.error("Error saving achievement:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get user achievements
 * GET /api/achievement/user/:userId
 */
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { courseId } = req.query;

    const achievements = await achievementService.getUserAchievements(userId, courseId);

    res.json({
      success: true,
      data: achievements,
      count: achievements.length
    });
  } catch (error) {
    console.error("Error fetching achievements:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Check if user has achievement for a quiz
 * GET /api/achievement/check/:userId/:quizId
 */
router.get("/check/:userId/:quizId", async (req, res) => {
  try {
    const { userId, quizId } = req.params;

    const hasAchievement = await achievementService.hasAchievement(userId, quizId);

    res.json({
      success: true,
      hasAchievement: hasAchievement
    });
  } catch (error) {
    console.error("Error checking achievement:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

