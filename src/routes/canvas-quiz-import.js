// Canvas Classic Quizzes import (#140), mounted at /api/question-import/canvas
// for staff (server.js). Every request carries the export zip as `file`.
const express = require('express');
const multer = require('multer');
const canvasQuizImportController = require('../controllers/canvas-quiz-import');
const { requireActiveCourse } = require('../middleware/course-archive');

const router = express.Router();

// Real quiz exports are well under 1 MB; 50 MB matches the material uploads.
const MAX_EXPORT_BYTES = 50 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_EXPORT_BYTES, files: 1, fields: 10 },
});

// Multer reports an oversized or unexpected upload as an error; answer it with
// a message the import dialog can show.
const handleUpload = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'This file is larger than 50 MB, which is too large to import.',
        code: 'TOO_LARGE',
      });
    }
    return res.status(400).json({ error: 'Upload one Canvas quiz export (.zip).' });
  });
};

// The archived-course gate goes after multer, which is what fills req.body
// (where courseId arrives).
router.post(
  '/preview',
  handleUpload,
  requireActiveCourse(),
  canvasQuizImportController.previewHandler
);

router.post(
  '/commit',
  handleUpload,
  requireActiveCourse(),
  canvasQuizImportController.commitHandler
);

module.exports = router;
