const express = require("express");
const router = express.Router();

// Mock course data (replace with database integration)
const mockCourses = [
  {
    id: "chem121",
    code: "CHEM 121",
    name: "General Chemistry I",
    instructor: "Dr. Brown",
    semester: "Fall 2024",
    students: 45,
    status: "active",
    materials: [
      {
        id: "m1",
        title: "Lecture 1: Introduction to Chemistry",
        type: "lecture",
        date: "2024-08-26",
        status: "completed",
      },
      {
        id: "m2",
        title: "Lecture 2: Atomic Structure",
        type: "lecture",
        date: "2024-08-28",
        status: "completed",
      },
      {
        id: "m3",
        title: "Lecture 3: Chemical Bonding",
        type: "lecture",
        date: "2024-08-30",
        status: "in-progress",
      },
    ],
    questionSets: [
      {
        id: "qs1",
        title: "Atomic Structure Quiz",
        questions: 15,
        status: "reviewed",
        createdAt: "2024-08-27",
      },
      {
        id: "qs2",
        title: "Chemical Bonding Practice",
        questions: 12,
        status: "generated",
        createdAt: "2024-08-29",
      },
    ],
  },
  {
    id: "chem123",
    code: "CHEM 123",
    name: "General Chemistry II",
    instructor: "Dr. Brown",
    semester: "Fall 2024",
    students: 38,
    status: "active",
    materials: [
      {
        id: "m4",
        title: "Lecture 1: Thermodynamics",
        type: "lecture",
        date: "2024-08-27",
        status: "completed",
      },
      {
        id: "m5",
        title: "Lecture 2: Kinetics",
        type: "lecture",
        date: "2024-08-29",
        status: "in-progress",
      },
    ],
    questionSets: [
      {
        id: "qs3",
        title: "Thermodynamics Quiz",
        questions: 10,
        status: "reviewed",
        createdAt: "2024-08-28",
      },
    ],
  },
  {
    id: "chem125",
    code: "CHEM 125",
    name: "Organic Chemistry I",
    instructor: "Dr. Brown",
    semester: "Fall 2024",
    students: 32,
    status: "active",
    materials: [
      {
        id: "m6",
        title: "Lecture 1: Introduction to Organic Chemistry",
        type: "lecture",
        date: "2024-08-28",
        status: "completed",
      },
    ],
    questionSets: [],
  },
];

// Get all courses
router.get("/", (req, res) => {
  try {
    res.json({
      success: true,
      courses: mockCourses,
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
    const course = mockCourses.find((c) => c.id === courseId);

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
    const course = mockCourses.find((c) => c.id === courseId);

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
    const course = mockCourses.find((c) => c.id === courseId);

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

    const course = mockCourses.find((c) => c.id === courseId);
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

      const course = mockCourses.find((c) => c.id === courseId);
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

// Get course statistics
router.get("/:courseId/stats", (req, res) => {
  try {
    const { courseId } = req.params;
    const course = mockCourses.find((c) => c.id === courseId);

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
