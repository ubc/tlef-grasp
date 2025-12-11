const databaseService = require('./database');

const saveMaterial = async (sourceId, courseId, materialData) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_material");
        await collection.insertOne({
            sourceId: sourceId,
            courseId: courseId,
            fileName: materialData.fileName,
            fileType: materialData.fileType,
            fileSize: materialData.fileSize,
            fileContent: materialData.fileContent || null,
            createdAt: new Date(),
        });
    }
    catch (error) {
        console.error("Error uploading material:", error);
        throw error;
    }
};

const deleteMaterial = async (sourceId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_material");
        const material = await collection.deleteOne({ sourceId: sourceId });
    }
    catch (error) {
        console.error("Error deleting material:", error);
        throw error;
    }
};

const getMaterialCourseId = async (sourceId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_material");
        const material = await collection.findOne({ sourceId: sourceId });
        return material.courseId;
    }
    catch (error) {
        console.error("Error getting material course ID:", error);
        throw error;
    }
};

const getCourseMaterials = async (courseId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_material");
        const materials = await collection.find({ courseId: courseId }).toArray();
        return materials;
    }
    catch (error) {
        console.error("Error getting course materials:", error);
        throw error;
    }
};

module.exports = {
    saveMaterial,
    deleteMaterial,
    getCourseMaterials,
    getMaterialCourseId,
};