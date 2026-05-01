const express = require("express");
const router = express.Router();
const coursesController = require('../controllers/courses');
const settingsController = require('../controllers/settings');


router.get("/my", coursesController.getMyCourses);

// Student self-enrollment (must be before "/:courseId" so "enrollment-list" is not parsed as an id)
router.get("/enrollment-list", coursesController.listEnrollmentCourses);
router.post("/join-by-code", express.json(), coursesController.joinCourseByEnrollmentCode);

router.post("/new", express.json(), coursesController.createNewCourse);

router.post("/:courseId/join", express.json(), coursesController.joinCourseWithCode);
router.get("/:courseId/enrollment-code", coursesController.getEnrollmentCode);
router.post(
  "/:courseId/regenerate-enrollment-code",
  express.json(),
  coursesController.regenerateEnrollmentCode
);

// Get course by ID
router.get("/:courseId", coursesController.getCourseByIdHandler);

// Course settings
router.get("/defaults/settings", settingsController.getDefaultSettingsHandler);
router.get("/:courseId/settings", settingsController.getSettingsHandler);
router.put("/:courseId/settings", express.json(), settingsController.updateSettingsHandler);

// Get course materials
router.get("/:courseId/materials", coursesController.getCourseMaterials);

// Get course questions
router.get("/:courseId/questions", coursesController.getCourseQuestions);

// Add new course material
router.post("/:courseId/materials", express.json(), coursesController.addCourseMaterial);

module.exports = router;
