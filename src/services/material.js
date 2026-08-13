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

/**
 * Put a material document back exactly as it was — same _id, createdAt, and any
 * outline fields. Used to undo the delete half of a content swap that failed
 * partway through: editing a material deletes the row and re-inserts it, and the
 * extracted text lives nowhere else, so a failure between the two used to lose
 * the material permanently.
 *
 * Upserts rather than inserts so a retry is idempotent.
 */
const restoreMaterialDocument = async (document) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_material");
        await collection.replaceOne(
            { sourceId: document.sourceId },
            document,
            { upsert: true }
        );
    }
    catch (error) {
        console.error("Error restoring material:", error);
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

// outlineSource/outlineEditedAt are legacy: they recorded whether an outline had
// been hand-edited, and nothing writes them now that outlines are generate-only.
// They stay in this list so clearing an outline also removes them from documents
// written before that change.
const OUTLINE_FIELDS = [
    'outline',
    'outlineSource',
    'outlineEditedAt',
];

/** Write outline fields for one material. */
const setMaterialOutline = async (sourceId, fields) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_material");
        await collection.updateOne({ sourceId: sourceId }, { $set: fields });
    }
    catch (error) {
        console.error("Error setting material outline:", error);
        throw error;
    }
};

/**
 * Remove every outline field. Called when a material's content changes: the
 * outline described text that no longer exists, including any instructor edits.
 */
const clearMaterialOutline = async (sourceId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_material");
        const unset = {};
        OUTLINE_FIELDS.forEach((field) => { unset[field] = ""; });
        await collection.updateOne({ sourceId: sourceId }, { $unset: unset });
    }
    catch (error) {
        console.error("Error clearing material outline:", error);
        throw error;
    }
};

module.exports = {
    saveMaterial,
    deleteMaterial,
    restoreMaterialDocument,
    getCourseMaterials,
    getMaterialCourseId,
    getMaterialBySourceId,
    setMaterialOutline,
    clearMaterialOutline,
};