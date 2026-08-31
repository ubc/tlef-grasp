const express = require("express");
const router = express.Router();
const coursesController = require('../controllers/courses');
const settingsController = require('../controllers/settings');
const { requireRole } = require('../middleware/auth');
const { requireActiveCourse } = require('../middleware/course-archive');
const { ROLES } = require('../utils/auth');


router.get("/my", coursesController.getMyCourses);

// Archived courses the caller owns (must precede "/:courseId")
router.get("/archived", coursesController.getArchivedCoursesHandler);

// The caller's own switcher order. Literal path, so it must precede "/:courseId"
// or "order" is parsed as a course id.
router.put("/order", express.json(), coursesController.reorderMyCoursesHandler);

// Student self-enrollment (must be before "/:courseId" so "enrollment-list" is not parsed as an id)
router.get("/enrollment-list", coursesController.listEnrollmentCourses);
router.post("/join-by-code", express.json(), coursesController.joinCourseByEnrollmentCode);

router.post("/new", express.json(), coursesController.createNewCourse);

// Archive / unarchive. Declared ahead of the requireActiveCourse gate below so
// they stay reachable on an archived course — they are the way back out. Both
// are owner-only, enforced by isCourseManager inside the handlers.
router.post("/:courseId/archive", express.json(), coursesController.archiveCourseHandler);
router.post("/:courseId/unarchive", express.json(), coursesController.unarchiveCourseHandler);

// From here down, every course-scoped route is gated: an archived course is
// invisible to everyone but its owner, and read-only even for them. Literal
// paths that reach this point ("/defaults/settings") resolve to no course and
// pass straight through.
router.use("/:courseId", requireActiveCourse());

router.post("/:courseId/join", express.json(), coursesController.joinCourseWithCode);
router.get("/:courseId/enrollment-code", coursesController.getEnrollmentCode);

// Owner-only course nickname. Below the requireActiveCourse gate on purpose:
// an archived course is read-only, renaming it included.
router.patch("/:courseId/nickname", express.json(), coursesController.updateCourseNicknameHandler);
router.post(
  "/:courseId/regenerate-enrollment-code",
  express.json(),
  coursesController.regenerateEnrollmentCode
);

// Section routes (must be before /:courseId to avoid param capture)
router.get("/my-owned-sections", coursesController.getMyOwnedSectionsHandler);
router.post("/:courseId/sections/:sectionId/recycle", express.json(), coursesController.recycleSectionHandler);
router.post("/:courseId/sections", express.json(), coursesController.addSectionsToCourseHandler);
router.get("/:courseId/sections", coursesController.getCourseSectionsHandler);
router.get("/:courseId/visible-sections", coursesController.getVisibleCourseSectionsHandler);
router.get("/:courseId/sections/:sectionId/students", coursesController.getSectionStudentsHandler);
router.get("/:courseId/my-sections", coursesController.getMyCourseSectionsHandler);

// Get course by ID
router.get("/:courseId", coursesController.getCourseByIdHandler);

// Course settings (faculty and staff)
router.get("/defaults/settings", requireRole(ROLES.STAFF), settingsController.getDefaultSettingsHandler);
router.get("/:courseId/settings", requireRole(ROLES.STAFF), settingsController.getSettingsHandler);
router.put("/:courseId/settings", requireRole(ROLES.STAFF), express.json(), settingsController.updateSettingsHandler);

// Get course materials
router.get("/:courseId/materials", coursesController.getCourseMaterials);

// Get course questions
router.get("/:courseId/questions", coursesController.getCourseQuestions);

// Add new course material
router.post("/:courseId/materials", express.json(), coursesController.addCourseMaterial);

module.exports = router;
