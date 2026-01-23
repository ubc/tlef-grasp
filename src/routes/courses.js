const express = require("express");
const router = express.Router();
const { createCourse, getCourseByCourseCode, getCourseById, getAllCourses } = require('../services/course');
const { createUserCourse, getUserCourses } = require('../services/user-course');
const materialService = require('../services/material');
const questionService = require('../services/question');
const { isFaculty } = require('../utils/auth');

// Get all courses
router.get("/", async (req, res) => {
  try {
    const courses = await getAllCourses();

    res.json({
      success: true,
      courses: courses,
    });
  } catch (error) {
    console.error("Error getting courses:", error);
    res.status(500).json({ error: "Failed to retrieve courses" });
  }
});

router.get("/my", async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userCourses = await getUserCourses(userId);
    const courses = userCourses.map((course) => course.course);

    res.json({
      success: true,
      courses: courses,
    });
  } catch (error) {
    console.error("Error getting user courses:", error);
    res.status(500).json({ error: "Failed to retrieve courses" });
  }
});

// Get course by ID
router.get("/:courseId", async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await getCourseById(courseId);

    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    res.json({
      success: true,
      course: course,
    });
  } catch (error) {
    console.error("Error getting course:", error);
    res.status(500).json({ error: "Failed to retrieve course" });
  }
});

// Get course materials
router.get("/:courseId/materials", async (req, res) => {
  try {
    const { courseId } = req.params;

    // Verify course exists
    const course = await getCourseById(courseId);
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    const materials = await materialService.getCourseMaterials(courseId);

    res.json({
      success: true,
      materials: materials,
    });
  } catch (error) {
    console.error("Error getting course materials:", error);
    res.status(500).json({ error: "Failed to retrieve course materials" });
  }
});

// Get course questions
router.get("/:courseId/questions", async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await getCourseById(courseId);
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    const questions = await questionService.getQuestions(courseId);

    res.json({
      success: true,
      questions: questions,
    });
  } catch (error) {
    console.error("Error getting course questions:", error);
    res.status(500).json({ error: "Failed to retrieve course questions" });
  }
});

// Add new course material
router.post("/:courseId/materials", express.json(), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { title, type, date, status = "pending", sourceId, fileContent, fileSize } = req.body;

    if (!title || !type) {
      return res.status(400).json({ error: "Title and type are required" });
    }

    const course = await getCourseById(courseId);
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    // Generate a sourceId if not provided (e.g. for manual entries)
    const materialSourceId = sourceId || `m${Date.now()}`;

    await materialService.saveMaterial(materialSourceId, courseId, {
      fileType: type,
      fileSize: fileSize || 0,
      fileContent: fileContent,
      documentTitle: title,
    });



    // Fetch the stored material to return it
    const newMaterial = await materialService.getMaterialBySourceId(materialSourceId);

    res.json({
      success: true,
      message: "Material added successfully",
      material: newMaterial,
    });
  } catch (error) {
    console.error("Error adding course material:", error);
    res.status(500).json({ error: "Failed to add course material" });
  }
});

// Update course material status
router.put(
  "/:courseId/materials/:materialId",
  express.json(),
  async (req, res) => {
    try {
      const { courseId, materialId } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({ error: "Status is required" });
      }

      const course = await getCourseById(courseId);
      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // materialId here corresponds to sourceId
      const result = await materialService.updateMaterialStatus(courseId, materialId, status);

      if (result.matchedCount === 0) {
        return res.status(404).json({ error: "Material not found" });
      }

      const updatedMaterial = await materialService.getMaterialBySourceId(materialId);

      res.json({
        success: true,
        message: "Material status updated successfully",
        material: updatedMaterial,
      });
    } catch (error) {
      console.error("Error updating material status:", error);
      res.status(500).json({ error: "Failed to update material status" });
    }
  }
);

// Get course statistics
router.get("/:courseId/stats", async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await getCourseById(courseId);

    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    // Fetch real data
    const materials = await materialService.getCourseMaterials(courseId);
    const questions = await questionService.getQuestions(courseId);

    // Calculate stats
    const stats = {
      totalMaterials: materials.length,
      completedMaterials: materials.filter(m => m.status === "completed").length,
      inProgressMaterials: materials.filter(m => m.status === "in-progress").length,
      totalQuestions: questions.length,
      approvedQuestions: questions.filter(q => q.status === "Approved").length,
      studentCount: course.students || course.expectedStudents || 0,
    };

    res.json({
      success: true,
      stats: stats,
    });
  } catch (error) {
    console.error("Error getting course statistics:", error);
    res.status(500).json({ error: "Failed to retrieve course statistics" });
  }
});

// Create new course
router.post("/new", express.json(), async (req, res) => {
  try {
    // Staff cannot create new courses
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({
        error: "Only faculty can create new courses"
      });
    }

    const {
      courseCode,
      courseName,
      instructorName,
      semester,
      expectedStudents,
      courseDescription,
      courseWeeks,
      lecturesPerWeek,
      courseCredits,
      status = "active",
    } = req.body;

    // Validate required fields
    if (
      !courseCode ||
      !courseName ||
      !instructorName ||
      !semester ||
      !expectedStudents
    ) {
      return res.status(400).json({
        error:
          "Missing required fields: courseCode, courseName, instructorName, semester, and expectedStudents are required",
      });
    }

    // Check if course already exists
    const existingCourse = await getCourseByCourseCode(courseCode);
    if (existingCourse) {
      return res
        .status(409)
        .json({ error: "Course with this code already exists" });
    }

    // Prepare course data for database
    const courseData = {
      courseCode: courseCode.trim(),
      courseName: courseName.trim(),
      instructorName,
      semester: semester.trim(),
      expectedStudents,
      courseDescription: courseDescription || "",
      courseWeeks: courseWeeks || null,
      lecturesPerWeek: lecturesPerWeek || null,
      courseCredits: courseCredits || null,
      status: status,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Create course in database
    const result = await createCourse(courseData);
    const courseId = result.insertedId;

    // Get the current user from session (set by passport authentication)
    const userId = req.user?._id;
    if (userId) {
      // Create user-course relationship
      try {
        await createUserCourse(userId, courseId);
      } catch (userCourseError) {
        console.error("Error creating user-course relationship:", userCourseError);
        // Don't fail the request if user-course creation fails, but log it
      }
    }

    // Return the created course with all fields
    const newCourse = {
      _id: courseId.toString(),
      code: courseCode,
      courseName: courseName.trim(),
      instructor: instructorName,
      semester: semester,
      students: expectedStudents,
      description: courseDescription || "",
      weeks: courseWeeks || null,
      lecturesPerWeek: lecturesPerWeek || null,
      credits: courseCredits || null,
      status: status,
      materials: [],
      questions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    res.status(201).json({
      success: true,
      message: "Course created successfully",
      course: newCourse,
    });
  } catch (error) {
    console.error("Error creating course:", error);
    res.status(500).json({
      error: "Failed to create course",
      details: error.message
    });
  }
});

module.exports = router;
