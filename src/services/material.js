const databaseService = require('./database');
const { ObjectId } = require('mongodb');

const saveMaterial = async (sourceId, courseId, materialData) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_material");
        
        // Convert courseId to ObjectId if it's a string
        const courseIdObj = ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId;
        
        await collection.insertOne({
            sourceId: sourceId,
            courseId: courseIdObj,
            fileType: materialData.fileType,
            fileSize: materialData.fileSize,
            fileContent: materialData.fileContent || null,
            documentTitle: materialData.documentTitle || null,
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
    console.log("Getting course materials for courseId:", courseId);
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_material");
        
        // Convert courseId to ObjectId if it's a string
        const courseIdObj = ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId;
        
        const materials = await collection.find({ courseId: courseIdObj }).toArray();
        console.log("Found materials:", materials);
        return materials;
    }
    catch (error) {
        console.error("Error getting course materials:", error);
        throw error;
    }
};

const getMaterialBySourceId = async (sourceId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_material");
        const material = await collection.findOne({ sourceId: sourceId });
        return material;
    }
    catch (error) {
        console.error("Error getting material by sourceId:", error);
        throw error;
    }
};

module.exports = {
    saveMaterial,
    deleteMaterial,
    getCourseMaterials,
    getMaterialCourseId,
    getMaterialBySourceId,
};