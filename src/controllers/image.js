const { uploadImage, getImageStream, deleteImage } = require("../services/image");
const { isUserInCourse } = require("../services/user-course");
const { assertCoInstructorPermission, PERMISSION_KEYS } = require("../utils/co-instructor-permissions");
const { assertTaPermission, TA_PERMISSION_KEYS } = require("../utils/ta-permissions");

// SVG is deliberately excluded: it can carry scripts (XSS vector).
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/**
 * Verify the buffer's magic bytes match the claimed mime type so a renamed
 * file (e.g. an .html saved as .png) cannot lie its way into storage.
 */
const sniffImageType = (buffer) => {
    if (!buffer || buffer.length < 12) return null;
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return "image/png";
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return "image/jpeg";
    }
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
        return "image/gif";
    }
    if (
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
        return "image/webp";
    }
    return null;
};

const uploadImageHandler = async (req, res) => {
    try {
        const file = req.file;
        const { courseId } = req.body;
        const userId = req.user._id || req.user.id;

        if (!file) {
            return res.status(400).json({ error: "No image uploaded" });
        }
        if (!courseId) {
            return res.status(400).json({ error: "courseId is required" });
        }

        const sniffedType = sniffImageType(file.buffer);
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype) || sniffedType !== file.mimetype) {
            return res.status(400).json({
                error: "Unsupported image type. Allowed formats: PNG, JPEG, GIF, WebP.",
            });
        }

        if (!(await isUserInCourse(userId, courseId))) {
            return res.status(403).json({ error: "User is not in course" });
        }
        if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_BANK))) return;
        if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.QUESTION_BANK))) return;

        const image = await uploadImage(file.buffer, {
            filename: file.originalname,
            mimeType: file.mimetype,
            courseId,
            uploadedBy: userId,
        });

        res.json({ success: true, image });
    } catch (error) {
        console.error("Error uploading question image:", error);
        res.status(500).json({ error: "Failed to upload image" });
    }
};

const getImageHandler = async (req, res) => {
    try {
        const { fileId } = req.params;
        const userId = req.user._id || req.user.id;

        const result = await getImageStream(fileId);
        if (!result) {
            return res.status(404).json({ error: "Image not found" });
        }

        const { stream, file } = result;
        const courseId = file.metadata?.courseId;
        if (courseId && !(await isUserInCourse(userId, courseId))) {
            return res.status(403).json({ error: "User is not in course" });
        }

        res.set({
            "Content-Type": file.contentType || "application/octet-stream",
            "Content-Length": file.length,
            // fileIds are immutable (a replaced image gets a new id), so the
            // browser can cache indefinitely; `private` keeps shared caches out.
            "Cache-Control": "private, max-age=31536000, immutable",
            "Content-Disposition": "inline",
        });

        stream.on("error", (error) => {
            console.error(`Error streaming image ${fileId}:`, error);
            if (!res.headersSent) {
                res.status(500).json({ error: "Failed to stream image" });
            } else {
                res.destroy();
            }
        });
        stream.pipe(res);
    } catch (error) {
        console.error("Error fetching question image:", error);
        res.status(500).json({ error: "Failed to fetch image" });
    }
};

const deleteImageHandler = async (req, res) => {
    try {
        const { fileId } = req.params;
        const userId = req.user._id || req.user.id;

        const result = await getImageStream(fileId);
        if (!result) {
            // Already gone — treat as success (delete is idempotent).
            return res.json({ success: true });
        }
        result.stream.destroy();

        const courseId = result.file.metadata?.courseId;
        if (courseId && !(await isUserInCourse(userId, courseId))) {
            return res.status(403).json({ error: "User is not in course" });
        }

        await deleteImage(fileId);
        res.json({ success: true });
    } catch (error) {
        console.error("Error deleting question image:", error);
        res.status(500).json({ error: "Failed to delete image" });
    }
};

module.exports = {
    uploadImageHandler,
    getImageHandler,
    deleteImageHandler,
};
