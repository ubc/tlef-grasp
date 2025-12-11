const express = require("express");
const router = express.Router();
const { saveMaterial, getCourseMaterials, getMaterialCourseId, deleteMaterial } = require('../services/material');
const { isUserInCourse } = require('../services/user-course');

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

module.exports = router;