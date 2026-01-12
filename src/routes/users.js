const express = require("express");
const router = express.Router();
const { getCourseUsers, createUserCourse, deleteUserCourse, isUserInCourse } = require('../services/user-course');
const { getStaffUsersNotInCourse } = require('../services/user');
const { getCourseById } = require('../services/course');
const { isFaculty } = require('../utils/auth');

// Get all users in a course
router.get("/course/:courseId", async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user._id || req.user.id;

    if (!userId) {
      console.error("User not authenticated - req.user:", req.user);
      return res.status(401).json({ 
        success: false,
        error: "User not authenticated" 
      });
    }

    console.log("Checking if user is in course:", { userId, courseId, userIdType: typeof userId, courseIdType: typeof courseId });

    // Check if user is in course
    const userInCourse = await isUserInCourse(userId, courseId);
    if (!userInCourse) {
      console.log("User is not in course");
      return res.status(403).json({ 
        success: false,
        error: "User is not in course" 
      });
    }

    console.log("Fetching course users for courseId:", courseId);
    const courseUsers = await getCourseUsers(courseId);
    console.log("Found", courseUsers.length, "users in course");

    res.json({
      success: true,
      users: courseUsers,
    });
  } catch (error) {
    console.error("Error fetching course users:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch course users",
      details: error.message 
    });
  }
});

// Get all staff users not in a course
router.get("/staff/not-in-course/:courseId", async (req, res) => {
  try {
    const { courseId } = req.params;

    // Only faculty can view available staff
    if (!isFaculty(req.user)) {
      return res.status(403).json({ 
        success: false,
        error: "Only faculty can view available staff" 
      });
    }

    // Check if user is in course
    if (!(await isUserInCourse(req.user.id || req.user._id, courseId))) {
      return res.status(403).json({ 
        success: false,
        error: "User is not in course" 
      });
    }

    const staffUsers = await getStaffUsersNotInCourse(courseId);

    res.json({
      success: true,
      users: staffUsers,
    });
  } catch (error) {
    console.error("Error fetching staff users not in course:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch staff users" 
    });
  }
});

// Add a user to a course
router.post("/course/:courseId/add", express.json(), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { userId } = req.body;

    // Only faculty can add users to courses
    if (!isFaculty(req.user)) {
      return res.status(403).json({ 
        success: false,
        error: "Only faculty can add users to courses" 
      });
    }

    // Check if current user is in course
    if (!(await isUserInCourse(req.user.id || req.user._id, courseId))) {
      return res.status(403).json({ 
        success: false,
        error: "User is not in course" 
      });
    }

    if (!userId) {
      return res.status(400).json({ 
        success: false,
        error: "userId is required" 
      });
    }

    // Check if user is already in course
    if (await isUserInCourse(userId, courseId)) {
      return res.status(409).json({ 
        success: false,
        error: "User is already in this course" 
      });
    }

    // Add user to course
    await createUserCourse(userId, courseId);

    res.json({
      success: true,
      message: "User added to course successfully",
    });
  } catch (error) {
    console.error("Error adding user to course:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to add user to course" 
    });
  }
});

// Remove a user from a course
router.delete("/course/:courseId/remove/:userId", async (req, res) => {
  try {
    const { courseId, userId } = req.params;

    // Only faculty can remove users from courses
    if (!isFaculty(req.user)) {
      return res.status(403).json({ 
        success: false,
        error: "Only faculty can remove users from courses" 
      });
    }

    // Check if current user is in course
    if (!(await isUserInCourse(req.user.id || req.user._id, courseId))) {
      return res.status(403).json({ 
        success: false,
        error: "User is not in course" 
      });
    }

    // Prevent removing yourself from the course
    const currentUserId = String(req.user.id || req.user._id);
    const targetUserId = String(userId);
    if (currentUserId === targetUserId) {
      return res.status(400).json({ 
        success: false,
        error: "Cannot remove yourself from the course" 
      });
    }

    // Check if user is in course
    if (!(await isUserInCourse(userId, courseId))) {
      return res.status(404).json({ 
        success: false,
        error: "User is not in this course" 
      });
    }

    // Remove user from course
    const result = await deleteUserCourse(userId, courseId);

    res.json({
      success: true,
      message: "User removed from course successfully",
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Error removing user from course:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to remove user from course" 
    });
  }
});

module.exports = router;

