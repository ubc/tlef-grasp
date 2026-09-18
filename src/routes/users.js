const express = require("express");
const router = express.Router();
const usersController = require('../controllers/users');
const { requireActiveCourse } = require('../middleware/course-archive');

// Archived courses take no roster changes, and expose no roster to anyone but
// their owner.
router.use("/course/:courseId", requireActiveCourse());
router.use("/staff/not-in-course/:courseId", requireActiveCourse());
router.use("/students/not-in-course/:courseId", requireActiveCourse());
router.use("/all/not-in-course/:courseId", requireActiveCourse());
router.use("/search/not-in-course/:courseId", requireActiveCourse());

// Resolve the current user's effective role in the selected course.
router.get("/course/:courseId/access", usersController.getCourseAccessHandler);

// Get all users in a course
router.get("/course/:courseId", usersController.getCourseUsersHandler);

// Get all staff users not in a course
router.get("/staff/not-in-course/:courseId", usersController.getStaffUsersNotInCourseHandler);

// Get all students not in a course
router.get("/students/not-in-course/:courseId", usersController.getStudentsNotInCourseHandler);

// Get all users not in a course (combined - faculty, staff, students)
router.get("/all/not-in-course/:courseId", usersController.getAllUsersNotInCourseHandler);

// Search non-member accounts by email or name, to add one by hand (issue #115)
router.get("/search/not-in-course/:courseId", usersController.searchUsersNotInCourseHandler);

// Who granted, changed, or revoked access in this course, newest first
router.get("/course/:courseId/access-log", usersController.getCourseAccessLogHandler);

// Add a user to a course, as a plain member or straight in as a TA
router.post("/course/:courseId/add", express.json(), usersController.addUserToCourseHandler);

// Remove a user from a course
router.delete("/course/:courseId/remove/:userId", usersController.removeUserFromCourseHandler);

// Promote a student in the course to TA
router.post("/course/:courseId/promote", express.json(), usersController.promoteUserToTaHandler);

// Demote a TA in the course back to student
router.post("/course/:courseId/demote", express.json(), usersController.demoteTaToStudentHandler);

// Replace a TA's per-course permission map
router.put("/course/:courseId/ta-permissions", express.json(), usersController.updateTaPermissionsHandler);

module.exports = router;
