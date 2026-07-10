const express = require("express");
const router = express.Router();
const multer = require("multer");
const imageController = require("../controllers/image");
const { requireRole } = require("../middleware/auth");
const { ROLES } = require("../utils/auth");

// Images are held in memory briefly, validated, then streamed into GridFS.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// Multer emits a MulterError for oversized files; map it to a clean 400.
const handleUpload = (req, res, next) => {
    upload.single("image")(req, res, (err) => {
        if (err) {
            const message =
                err.code === "LIMIT_FILE_SIZE"
                    ? "Image is too large. Maximum size is 5 MB."
                    : "Failed to process image upload";
            return res.status(400).json({ error: message });
        }
        next();
    });
};

/**
 * POST /api/image/upload
 * Upload a question image (staff and above).
 */
router.post("/upload", requireRole(ROLES.STAFF), handleUpload, imageController.uploadImageHandler);

/**
 * GET /api/image/:fileId
 * Stream a question image. Any authenticated user enrolled in the image's
 * course (students need this to see images while taking quizzes).
 */
router.get("/:fileId", imageController.getImageHandler);

/**
 * DELETE /api/image/:fileId
 * Delete an uploaded image (staff and above). Used by editors when an image
 * is removed before the question referencing it was ever saved.
 */
router.delete("/:fileId", requireRole(ROLES.STAFF), imageController.deleteImageHandler);

module.exports = router;
