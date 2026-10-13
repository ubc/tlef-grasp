// Canvas Classic Quizzes import (#140): HTTP layer for the preview and the
// per-quiz commit. Both receive the export zip as a multipart upload.
const { previewCanvasImport, commitCanvasQuiz } = require('../services/canvas-quiz-import');
const { CanvasImportError } = require('../utils/canvas-qti-package');
const { hasStaffAccessInCourse } = require('../utils/course-access');
const { isFaculty } = require('../utils/auth');
const {
  assertCoInstructorPermission,
  hasCoInstructorPermission,
  PERMISSION_KEYS,
} = require('../utils/co-instructor-permissions');
const { assertTaPermission, TA_PERMISSION_KEYS } = require('../utils/ta-permissions');

const NO_FILE = 'Upload a Canvas quiz export (.zip).';
const NO_QUIZ = 'Choose a Canvas quiz to import.';
const IMPORT_FAILED = 'The Canvas import failed.';

// Multipart fields arrive as strings, or as arrays when a field is repeated.
const isText = (value) => typeof value === 'string' && value.trim() !== '';

// Image links in an export carry a credential (Canvas's verifier), so nothing
// that may quote one reaches the log.
function withoutUrls(error) {
  return String((error && error.stack) || error).replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[url]');
}

/**
 * Checks shared by preview and commit. Sends the error response and returns
 * null when the request may not go ahead, else the course and what the user
 * may do with the import.
 */
async function authorizeImport(req, res) {
  if (!req.file) {
    res.status(400).json({ error: NO_FILE });
    return null;
  }
  const courseId = req.body?.courseId;
  if (!isText(courseId)) {
    res.status(400).json({ error: 'Course ID is required' });
    return null;
  }
  if (!(await hasStaffAccessInCourse(req.user, courseId))) {
    res.status(403).json({ error: 'User is not in course' });
    return null;
  }
  // Saving questions and storing their images are separate permissions; an
  // import does both.
  if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_GENERATION))) return null;
  if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_BANK))) return null;
  if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.QUESTION_GENERATION))) return null;
  if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.QUESTION_BANK))) return null;

  // Approving is faculty-only elsewhere (the status route), and so is creating
  // a quiz (the quiz routes), which co-instructors can also be denied.
  const canApprove = await isFaculty(req.user);
  const canCreateQuizzes =
    canApprove && (await hasCoInstructorPermission(req.user, courseId, PERMISSION_KEYS.CREATE_QUIZ));
  return { courseId, permissions: { canApprove, canCreateQuizzes } };
}

function sendImportError(res, error) {
  if (error instanceof CanvasImportError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error('Canvas quiz import failed:', withoutUrls(error));
  return res.status(500).json({ error: IMPORT_FAILED });
}

// POST /api/question-import/canvas/preview  (multipart: courseId, file)
const previewHandler = async (req, res) => {
  try {
    const access = await authorizeImport(req, res);
    if (!access) return;

    const report = await previewCanvasImport({ courseId: access.courseId, buffer: req.file.buffer });
    res.json({ ...report, permissions: access.permissions });
  } catch (error) {
    sendImportError(res, error);
  }
};

// POST /api/question-import/canvas/commit  (multipart: courseId, quizIdent,
// createQuiz 'true'|'false', file). One Canvas quiz per request.
const commitHandler = async (req, res) => {
  try {
    const access = await authorizeImport(req, res);
    if (!access) return;
    const { quizIdent, createQuiz } = req.body;
    if (!isText(quizIdent)) {
      return res.status(400).json({ error: NO_QUIZ });
    }

    const report = await commitCanvasQuiz({
      courseId: access.courseId,
      buffer: req.file.buffer,
      quizIdent,
      createQuiz: createQuiz === 'true',
      user: req.user,
      ...access.permissions,
    });
    res.json(report);
  } catch (error) {
    sendImportError(res, error);
  }
};

module.exports = {
  previewHandler,
  commitHandler,
};
