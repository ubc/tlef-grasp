const express = require("express");
const router = express.Router();
const achievementController = require("../controllers/achievement");

/**
 * Save an achievement
 * POST /api/achievement
 */
router.post("/", express.json(), achievementController.saveAchievement);

/**
 * Get achievements for the current user
 * GET /api/achievement/my
 */
router.get("/my", achievementController.getMyAchievements);

/**
 * Get achievement counts for the current user
 * GET /api/achievement/my/counts
 */
router.get("/my/counts", achievementController.getMyAchievementCounts);

module.exports = router;
