const express = require("express");
const router = express.Router();

// Course data storage (in-memory for now, replace with database integration)
let courses = [];

// Get all courses
router.get("/", (req, res) => {
  try {
    res.json({
      success: true,
      courses: courses,
    });
  } catch (error) {
    console.error("Error getting courses:", error);
    res.status(500).json({ error: "Failed to retrieve courses" });
  }
});

// Get course by ID
router.get("/:courseId", (req, res) => {
  try {
    const { courseId } = req.params;
    const course = courses.find((c) => c.id === courseId);

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
router.get("/:courseId/materials", (req, res) => {
  try {
    const { courseId } = req.params;
    const course = courses.find((c) => c.id === courseId);

    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    res.json({
      success: true,
      materials: course.materials,
    });
  } catch (error) {
    console.error("Error getting course materials:", error);
    res.status(500).json({ error: "Failed to retrieve course materials" });
  }
});

// Get course question sets
router.get("/:courseId/questions", (req, res) => {
  try {
    const { courseId } = req.params;
    const course = courses.find((c) => c.id === courseId);

    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    res.json({
      success: true,
      questionSets: course.questionSets,
    });
  } catch (error) {
    console.error("Error getting course question sets:", error);
    res.status(500).json({ error: "Failed to retrieve course question sets" });
  }
});

// Add new course material
router.post("/:courseId/materials", express.json(), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { title, type, date, status = "pending" } = req.body;

    if (!title || !type) {
      return res.status(400).json({ error: "Title and type are required" });
    }

    const course = courses.find((c) => c.id === courseId);
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    const newMaterial = {
      id: `m${Date.now()}`,
      title,
      type,
      date: date || new Date().toISOString().split("T")[0],
      status,
    };

    course.materials.push(newMaterial);

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

      const course = courses.find((c) => c.id === courseId);
      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      const material = course.materials.find((m) => m.id === materialId);
      if (!material) {
        return res.status(404).json({ error: "Material not found" });
      }

      material.status = status;

      res.json({
        success: true,
        message: "Material status updated successfully",
        material: material,
      });
    } catch (error) {
      console.error("Error updating material status:", error);
      res.status(500).json({ error: "Failed to update material status" });
    }
  }
);

// Create new course
router.post("/", express.json(), (req, res) => {
  try {
    const {
      courseCode,
      courseTitle,
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
      !courseTitle ||
      !instructorName ||
      !semester ||
      !expectedStudents
    ) {
      return res.status(400).json({
        error:
          "Missing required fields: courseCode, courseTitle, instructorName, semester, and expectedStudents are required",
      });
    }

    // Generate unique course ID
    const courseId = courseCode.toLowerCase().replace(/\s+/g, "");

    // Check if course already exists
    const existingCourse = courses.find((c) => c.id === courseId);
    if (existingCourse) {
      return res
        .status(409)
        .json({ error: "Course with this code already exists" });
    }

    // Create new course
    const newCourse = {
      id: courseId,
      code: courseCode,
      name: courseTitle,
      fullName: courseName || `${courseCode} - ${courseTitle}`,
      instructor: instructorName,
      semester: semester,
      students: expectedStudents,
      description: courseDescription || "",
      weeks: courseWeeks || null,
      lecturesPerWeek: lecturesPerWeek || null,
      credits: courseCredits || null,
      status: status,
      materials: [],
      questionSets: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Add to courses array (in real app, this would be saved to database)
    courses.push(newCourse);

    res.status(201).json({
      success: true,
      message: "Course created successfully",
      course: newCourse,
    });
  } catch (error) {
    console.error("Error creating course:", error);
    res.status(500).json({ error: "Failed to create course" });
  }
});

// Get course statistics
router.get("/:courseId/stats", (req, res) => {
  try {
    const { courseId } = req.params;
    const course = courses.find((c) => c.id === courseId);

    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    const stats = {
      totalMaterials: course.materials.length,
      completedMaterials: course.materials.filter(
        (m) => m.status === "completed"
      ).length,
      inProgressMaterials: course.materials.filter(
        (m) => m.status === "in-progress"
      ).length,
      totalQuestionSets: course.questionSets.length,
      reviewedQuestionSets: course.questionSets.filter(
        (qs) => qs.status === "reviewed"
      ).length,
      totalQuestions: course.questionSets.reduce(
        (sum, qs) => sum + qs.questions,
        0
      ),
      studentCount: course.students,
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

module.exports = router;
