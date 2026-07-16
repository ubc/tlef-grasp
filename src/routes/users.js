const express = require("express");
const router = express.Router();
const usersController = require('../controllers/users');

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

// Add a user to a course
router.post("/course/:courseId/add", express.json(), usersController.addUserToCourseHandler);

// Remove a user from a course
router.delete("/course/:courseId/remove/:userId", usersController.removeUserFromCourseHandler);

// Promote a student in the course to TA
router.post("/course/:courseId/promote", express.json(), usersController.promoteUserToTaHandler);

// Demote a TA in the course back to student
router.post("/course/:courseId/demote", express.json(), usersController.demoteTaToStudentHandler);

module.exports = router;
