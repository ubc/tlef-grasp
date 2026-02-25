const achievementService = require("../services/achievement");
const { isUserInCourse } = require("../services/user-course");

/**
 * Save an achievement
 * POST /api/achievement
 */
const saveAchievement = async (req, res) => {
  try {
    const { userId, courseId, quizId, type } = req.body;

    if (!userId || !courseId || !quizId || !type) {
      return res.status(400).json({
        success: false,
        error: "User ID, Course ID, Quiz ID, and type are required"
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
      type
    );

    if (!achievement) {
      return res.json({
        success: true,
        data: null,
        message: "Achievement already exists"
      });
    }

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
};

/**
 * Get achievements for the current user
 * GET /api/achievement/my
 */
const getMyAchievements = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { courseId } = req.query;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User not authenticated"
      });
    }

    const achievements = await achievementService.getUserAchievements(userId.toString(), courseId);

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
};

/**
 * Get achievement counts for the current user
 * GET /api/achievement/my/counts
 */
const getMyAchievementCounts = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { courseId } = req.query;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User not authenticated"
      });
    }

    const counts = await achievementService.getAchievementCounts(userId.toString(), courseId);

    res.json({
      success: true,
      data: counts
    });
  } catch (error) {
    console.error("Error fetching achievement counts:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  saveAchievement,
  getMyAchievements,
  getMyAchievementCounts
};
