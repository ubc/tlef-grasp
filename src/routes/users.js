const express = require("express");
const router = express.Router();
const usersController = require('../controllers/users');

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

module.exports = router;
