const { ObjectId, GridFSBucket } = require("mongodb");
const { Readable } = require("stream");
const databaseService = require("./database");
const { MC_OPTION_KEYS } = require("../utils/mc-options");

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
 * The course an uploaded image belongs to, or null if the file is unknown.
 * Reads the GridFS files document only — deliberately does not open a download
 * stream, since the archived-course gate needs the metadata and nothing else.
 */
const getImageCourseId = async (fileId) => {
    const id = toObjectId(fileId);
    if (!id) return null;

    const bucket = await getBucket();
    const file = await bucket.find({ _id: id }).next();
    return file?.metadata?.courseId || null;
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
 * (stem images + per-option images). Used by cleanup and export.
 */
const collectQuestionImageIds = (question) => {
    const ids = [];
    const pushRef = (ref) => {
        if (ref?.fileId) ids.push(String(ref.fileId));
    };

    if (Array.isArray(question?.stemImages)) question.stemImages.forEach(pushRef);
    // Legacy: a single stem image (still cleaned up).
    pushRef(question?.stemImage);
    // One image per multiple-choice option (issue #146).
    const options = question?.options;
    if (options && typeof options === "object") {
        for (const key of Object.keys(options)) {
            pushRef(options[key]?.image);
        }
    }
    return ids;
};

/**
 * Whether a saved question still uses this image, as a stem image or as an
 * option image. Edit forms delete an image as soon as it is removed, before
 * the question is saved; the delete route asks this first so cancelling the
 * edit cannot leave a saved question pointing at a deleted file. Saving the
 * question cleans up what it no longer uses.
 */
const isImageInUse = async (fileId) => {
    const id = String(fileId);
    const paths = [
        "stemImages.fileId",
        "stemImage.fileId",
        ...MC_OPTION_KEYS.map((key) => `options.${key}.image.fileId`),
    ];
    const db = await databaseService.connect();
    const match = await db.collection("grasp_question").findOne(
        { $or: paths.map((path) => ({ [path]: id })) },
        { projection: { _id: 1 } }
    );
    return Boolean(match);
};

module.exports = {
    uploadImage,
    getImageStream,
    getImageCourseId,
    downloadImageBuffer,
    deleteImage,
    deleteImages,
    collectQuestionImageIds,
    isImageInUse,
};
