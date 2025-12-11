const express = require("express");
const router = express.Router();
const { saveMaterial, getCourseMaterials, getMaterialCourseId, deleteMaterial, getMaterialBySourceId } = require('../services/material');
const { isUserInCourse } = require('../services/user-course');
const { getCourseById } = require('../services/course');
const ragService = require('../services/rag');

router.post("/save", express.json(), async (req, res) => {
    try {
        const { sourceId, courseId, materialData } = req.body;
        const userId = req.user.id;

        if (!isUserInCourse(userId, courseId)) {
            return res.status(403).json({ error: "User is not in course" });
        }

        await saveMaterial(sourceId, courseId, materialData);
        res.json({ success: true, message: "Material saved successfully" });
    } catch (error) {
        console.error("Error saving material:", error);
        res.status(500).json({ error: "Failed to save material" });
    }
});

router.delete("/delete/:sourceId", async (req, res) => {
    try {
        const { sourceId } = req.params;
        const userId = req.user.id;
        const courseId = await getMaterialCourseId(sourceId);

        if (!courseId) {
            return res.status(404).json({ error: "Course current material attached to not found" });
        }

        if (!isUserInCourse(userId, courseId)) {
            return res.status(403).json({ error: "User is not in course" });
        }

        await deleteMaterial(sourceId);
        res.json({ success: true, message: "Material deleted successfully" });
    } catch (error) {
        console.error("Error deleting material:", error);
        res.status(500).json({ error: "Failed to delete material" });
    }
});

router.get("/course/:courseId", async (req, res) => {
    try {
        const { courseId } = req.params;
        const userId = req.user.id;
    
        if (!isUserInCourse(userId, courseId)) {
            return res.status(403).json({ error: "User is not in course" });
        }

        const materials = await getCourseMaterials(courseId);
        res.json({ success: true, materials: materials });
    } catch (error) {
        console.error("Error getting materials:", error);
        res.status(500).json({ error: "Failed to get materials" });
    }
});

router.post("/update", express.json(), async (req, res) => {
    try {
        const { sourceId, courseId, textContent } = req.body;
        const userId = req.user.id;

        if (!sourceId || !textContent) {
            return res.status(400).json({ error: "sourceId and textContent are required" });
        }

        // Get existing material to verify it exists and get course info
        const existingMaterial = await getMaterialBySourceId(sourceId);
        if (!existingMaterial) {
            return res.status(404).json({ error: "Material not found" });
        }

        const materialCourseId = existingMaterial.courseId || courseId;
        if (!materialCourseId) {
            return res.status(400).json({ error: "Course ID is required" });
        }

        if (!isUserInCourse(userId, materialCourseId)) {
            return res.status(403).json({ error: "User is not in course" });
        }

        // Step 1: Delete from vector database (RAG)
        try {
            await ragService.deleteDocumentFromRAG(sourceId);
            console.log("✅ Deleted from vector database");
        } catch (ragError) {
            console.error("Error deleting from vector database:", ragError);
            // Continue anyway - we'll try to add it back
        }

        // Step 2: Delete from MongoDB
        await deleteMaterial(sourceId);
        console.log("✅ Deleted from MongoDB");

        // Step 3: Re-save to vector database (RAG)
        try {
            // Get course name for metadata
            let courseName = "Unknown Course";
            try {
                const course = await getCourseById(materialCourseId);
                if (course) {
                    courseName = course.courseName || course.courseTitle || "Unknown Course";
                }
            } catch (courseError) {
                console.error("Error getting course name:", courseError);
                // Continue with default name
            }

            await ragService.addDocumentToRAG(textContent, {
                source: "",
                type: "text",
                course: courseName,
                sourceId: sourceId,
            });
            console.log("✅ Re-saved to vector database");
        } catch (ragAddError) {
            console.error("Error saving to vector database:", ragAddError);
            throw ragAddError;
        }

        // Step 4: Re-save to MongoDB
        // Calculate file size (using Buffer in Node.js instead of Blob)
        const fileSize = Buffer.byteLength(textContent, 'utf8');
        await saveMaterial(sourceId, materialCourseId, {
            fileName: existingMaterial.fileName || "",
            fileType: existingMaterial.fileType || "text/plain",
            fileSize: fileSize,
            fileContent: textContent,
        });
        console.log("✅ Re-saved to MongoDB");

        res.json({ success: true, message: "Material updated successfully" });
    } catch (error) {
        console.error("Error updating material:", error);
        res.status(500).json({ error: "Failed to update material", details: error.message });
    }
});

module.exports = router;