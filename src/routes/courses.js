const express = require("express");
const router = express.Router();
const coursesController = require('../controllers/courses');
const settingsController = require('../controllers/settings');


router.get("/my", coursesController.getMyCourses);

// Get course by ID
router.get("/:courseId", coursesController.getCourseByIdHandler);

// Course settings
router.get("/:courseId/settings", settingsController.getSettingsHandler);
router.put("/:courseId/settings", express.json(), settingsController.updateSettingsHandler);

// Get course materials
router.get("/:courseId/materials", coursesController.getCourseMaterials);

// Get course questions
router.get("/:courseId/questions", coursesController.getCourseQuestions);

// Add new course material
router.post("/:courseId/materials", express.json(), coursesController.addCourseMaterial);

// Create new course
router.post("/new", express.json(), coursesController.createNewCourse);

module.exports = router;
