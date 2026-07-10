const { ObjectId, GridFSBucket } = require("mongodb");
const { Readable } = require("stream");
const databaseService = require("./database");

const BUCKET_NAME = "grasp_question_images";

const getBucket = async () => {
    const db = await databaseService.connect();
    return new GridFSBucket(db, { bucketName: BUCKET_NAME });
};

const toObjectId = (fileId) => {
    if (fileId instanceof ObjectId) return fileId;
    if (typeof fileId === "string" && ObjectId.isValid(fileId)) return new ObjectId(fileId);
    return null;
};

/**
 * Store an image buffer in GridFS.
 * Returns { fileId, filename, mimeType, size } with fileId as a string
 * (question docs store image refs as plain JSON).
 */
const uploadImage = async (buffer, { filename, mimeType, courseId, uploadedBy }) => {
    const bucket = await getBucket();

    return new Promise((resolve, reject) => {
        const uploadStream = bucket.openUploadStream(filename, {
            contentType: mimeType,
            metadata: {
                courseId: String(courseId),
                uploadedBy: String(uploadedBy),
                uploadedAt: new Date(),
                originalName: filename,
            },
        });

        uploadStream.on("error", reject);
        uploadStream.on("finish", () => {
            resolve({
                fileId: String(uploadStream.id),
                filename,
                mimeType,
                size: buffer.length,
            });
        });

        Readable.from(buffer).pipe(uploadStream);
    });
};

/**
 * Get a readable stream + file metadata for an image.
 * Returns null when the file does not exist.
 */
const getImageStream = async (fileId) => {
    const id = toObjectId(fileId);
    if (!id) return null;

    const bucket = await getBucket();
    const file = await bucket.find({ _id: id }).next();
    if (!file) return null;

    return { stream: bucket.openDownloadStream(id), file };
};

/**
 * Read an entire image into a Buffer (used by QTI export).
 * Returns null when the file does not exist.
 */
const downloadImageBuffer = async (fileId) => {
    const result = await getImageStream(fileId);
    if (!result) return null;

    const chunks = [];
    for await (const chunk of result.stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
};

/**
 * Best-effort delete: missing files are ignored.
 */
const deleteImage = async (fileId) => {
    const id = toObjectId(fileId);
    if (!id) return;

    try {
        const bucket = await getBucket();
        await bucket.delete(id);
    } catch (error) {
        // FileNotFound or transient errors are non-fatal — cleanup is best-effort.
        console.warn(`Could not delete question image ${fileId}:`, error.message);
    }
};

const deleteImages = async (fileIds) => {
    for (const fileId of fileIds || []) {
        await deleteImage(fileId);
    }
};

/**
 * Collect every image fileId referenced by a question doc
 * (stem image + per-option images). Used by cleanup and export.
 */
const collectQuestionImageIds = (question) => {
    const ids = [];
    const pushRef = (ref) => {
        if (ref?.fileId) ids.push(String(ref.fileId));
    };

    // Current: an array of stem images.
    if (Array.isArray(question?.stemImages)) question.stemImages.forEach(pushRef);
    // Legacy: a single stem image / per-option images (still cleaned up).
    pushRef(question?.stemImage);
    const options = question?.options;
    if (options && typeof options === "object") {
        for (const key of Object.keys(options)) {
            pushRef(options[key]?.image);
        }
    }
    return ids;
};

module.exports = {
    uploadImage,
    getImageStream,
    downloadImageBuffer,
    deleteImage,
    deleteImages,
    collectQuestionImageIds,
};
