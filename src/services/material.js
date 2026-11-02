const databaseService = require('./database');
const { ObjectId } = require('mongodb');
const { CANVAS_IMPORT_MATERIAL } = require('../constants/app-constants');

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
            // Where the material came from when it was imported from an LMS
            // (see findLmsImportedMaterials); absent for uploads and pasted text.
            ...(materialData.lms ? { lms: materialData.lms } : {}),
            createdAt: new Date(),
        });
    }
    catch (error) {
        console.error("Error uploading material:", error);
        throw error;
    }
};

/**
 * The materials of a course that were imported from one LMS course, without
 * their text. Each carries
 * `lms: { provider, instance, externalCourseId, externalFileId, externalFileName,
 * externalUpdatedAt, importedAt }`, which is how an import recognises a file it
 * has already brought in.
 *
 * @param {string|ObjectId} courseId - The GRASP course
 * @param {{ provider: string, instance: string|null, externalCourseId: string, externalFileId?: string }} source
 * @returns {Promise<Array<{ sourceId: string, documentTitle: string|null, lms: Object }>>}
 */
const findLmsImportedMaterials = async (courseId, { provider, instance, externalCourseId, externalFileId }) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_material");
        const courseIdObj = ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId;

        const query = {
            courseId: courseIdObj,
            'lms.provider': provider,
            'lms.instance': instance,
            'lms.externalCourseId': String(externalCourseId),
        };
        if (externalFileId !== undefined) query['lms.externalFileId'] = String(externalFileId);

        return await collection
            .find(query, { projection: { sourceId: 1, documentTitle: 1, lms: 1 } })
            .toArray();
    }
    catch (error) {
        console.error("Error finding LMS-imported materials:", error);
        throw error;
    }
};

/** Whether a material is a course's "From Canvas" placeholder. */
const isCanvasImportMaterial = (material) =>
    material?.fileType === CANVAS_IMPORT_MATERIAL.fileType;

/**
 * The course's "From Canvas" material (see CANVAS_IMPORT_MATERIAL), created
 * the first time a Canvas quiz import needs it. Its sourceId is fixed per
 * course, so the unique sourceId index keeps it to one even when two imports
 * create it at once. An instructor may delete it; the next import makes a new
 * one.
 *
 * @param {string|ObjectId} courseId
 * @returns {Promise<Object>} The material document
 */
const ensureCanvasImportMaterial = async (courseId) => {
    const db = await databaseService.connect();
    const collection = db.collection("grasp_material");
    const courseIdObj = ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId;
    const sourceId = `${courseIdObj}-from-canvas`;

    try {
        await collection.updateOne(
            { sourceId },
            {
                $setOnInsert: {
                    courseId: courseIdObj,
                    fileType: CANVAS_IMPORT_MATERIAL.fileType,
                    fileSize: 0,
                    fileContent: null,
                    documentTitle: CANVAS_IMPORT_MATERIAL.documentTitle,
                    createdAt: new Date(),
                },
            },
            { upsert: true }
        );
    } catch (error) {
        // Another import created it between the lookup and the insert.
        if (error?.code !== 11000) throw error;
    }
    return collection.findOne({ sourceId });
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
 * Replace a material's content in place. The row keeps its _id, sourceId,
 * courseId and createdAt; everything else comes from `materialData`, so the
 * outline fields go — the outline described text that no longer exists.
 *
 * In place rather than delete-then-insert: learning objectives link to a
 * material by its _id (grasp_objective_material.materialId), and a reinserted
 * row gets a new one, which silently cut the material off from every objective
 * that used it.
 *
 * @param {object} existingMaterial - The stored document being replaced
 * @param {object} materialData - The new fields, as saveMaterial takes them
 */
const replaceMaterial = async (existingMaterial, materialData) => {
    const db = await databaseService.connect();
    const collection = db.collection("grasp_material");
    const result = await collection.replaceOne(
        { _id: existingMaterial._id },
        {
            _id: existingMaterial._id,
            sourceId: existingMaterial.sourceId,
            courseId: existingMaterial.courseId,
            fileType: materialData.fileType,
            fileSize: materialData.fileSize,
            fileContent: materialData.fileContent || null,
            documentTitle: materialData.documentTitle || null,
            ...(materialData.lms ? { lms: materialData.lms } : {}),
            createdAt: existingMaterial.createdAt,
            updatedAt: new Date(),
        }
    );
    if (result.matchedCount === 0) {
        throw new Error(`Material ${existingMaterial.sourceId} no longer exists`);
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
        console.log(`Found ${materials.length} materials for course ${courseId}`);
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
    findLmsImportedMaterials,
    isCanvasImportMaterial,
    ensureCanvasImportMaterial,
    deleteMaterial,
    replaceMaterial,
    getCourseMaterials,
    getMaterialCourseId,
    getMaterialBySourceId,
    setMaterialOutline,
    clearMaterialOutline,
};