const archiver = require('archiver');
const { saveQuestion, updateQuestion, deleteQuestion, getQuestions } = require('../services/question');
const { hasStaffAccessInCourse } = require('../utils/course-access');
const { getQuestionCourseId, getQuestion } = require('../services/question');
const { isFaculty } = require('../utils/auth');
const { assertCoInstructorPermission, PERMISSION_KEYS } = require('../utils/co-instructor-permissions');
const { assertTaPermission, TA_PERMISSION_KEYS } = require("../utils/ta-permissions");
const quizService = require('../services/quiz');
const { downloadImageBuffer } = require('../services/image');
const { ObjectId } = require('mongodb');
const { QUESTION_TYPES } = require('../constants/app-constants');
const {
  normalizeQuestionType,
  getQuestionText,
  getOptionText,
  getCorrectAnswerIndex,
  getAcceptableAnswers,
  stemImagesOf,
} = require('../utils/question-export-helpers');
const { filterH5PExportableQuestions, buildH5PPackage } = require('../utils/h5p-export');
const databaseService = require('../services/database');

// --- Objective enrichment for export ----------------------------------------

// Normalize any id-ish value (string, {$oid}, ObjectId) to an ObjectId, or null.
function toObjectId(value) {
  if (!value) return null;
  if (value instanceof ObjectId) return value;
  const str = typeof value === 'object' && value.$oid ? value.$oid : String(value);
  return ObjectId.isValid(str) ? new ObjectId(str) : null;
}

// Questions arriving from the client carry only objective IDs (as strings over
// JSON). We re-read grasp_objective so exported objective names are current even
// if an objective was renamed since the question was authored. Each question is
// returned with granular/meta objective IDs (as strings) and their names filled
// in. The meta (parent) objective is taken from the question when present, else
// derived from the granular objective's parent — the same rule the app uses on
// save (see services/question.js).
async function enrichQuestionsWithObjectives(questions) {
  const db = await databaseService.connect();
  const objectives = db.collection('grasp_objective');

  // Collect the granular objective IDs referenced by the questions.
  const granularIds = new Map();
  questions.forEach((q) => {
    const id = toObjectId(q.granularObjectiveId || q.objectiveId);
    if (id) granularIds.set(id.toString(), id);
  });

  const granularDocs = granularIds.size
    ? await objectives.find({ _id: { $in: Array.from(granularIds.values()) } }).toArray()
    : [];

  const granularById = new Map();
  const parentIds = new Map();
  granularDocs.forEach((o) => {
    const parentStr = o.parent ? o.parent.toString() : null;
    granularById.set(o._id.toString(), { name: o.name || '', parent: parentStr });
    if (parentStr) {
      const pid = toObjectId(parentStr);
      if (pid) parentIds.set(parentStr, pid);
    }
  });

  // Meta objectives may also be referenced directly on a question that has no
  // granular link, so gather those too.
  questions.forEach((q) => {
    const id = toObjectId(q.learningObjectiveId);
    if (id) parentIds.set(id.toString(), id);
  });

  const parentDocs = parentIds.size
    ? await objectives.find({ _id: { $in: Array.from(parentIds.values()) } }).toArray()
    : [];
  const parentById = new Map();
  parentDocs.forEach((o) => parentById.set(o._id.toString(), o.name || ''));

  return questions.map((q) => {
    const gId = toObjectId(q.granularObjectiveId || q.objectiveId);
    const gStr = gId ? gId.toString() : null;
    const gInfo = gStr ? granularById.get(gStr) : null;

    let metaId = toObjectId(q.learningObjectiveId);
    if (!metaId && gInfo && gInfo.parent) metaId = toObjectId(gInfo.parent);
    const metaStr = metaId ? metaId.toString() : null;

    return {
      ...q,
      granularObjectiveId: gStr,
      granularObjectiveName: (gInfo && gInfo.name) || q.granularObjectiveName || '',
      learningObjectiveId: metaStr,
      learningObjectiveName: (metaStr && parentById.get(metaStr)) || q.learningObjectiveName || '',
    };
  });
}

// Quiz-level view of the objectives an export covers: the distinct meta
// objectives, each with the granular children that actually appear among the
// exported questions. Granular objectives whose parent could not be resolved are
// grouped under a null-meta entry so nothing is silently dropped.
function buildObjectivesSummary(enrichedQuestions) {
  const metaMap = new Map();
  const orphanGranulars = new Map();

  enrichedQuestions.forEach((q) => {
    const metaId = q.learningObjectiveId;
    const gId = q.granularObjectiveId;
    if (metaId) {
      if (!metaMap.has(metaId)) {
        metaMap.set(metaId, {
          metaObjectiveId: metaId,
          metaObjectiveName: q.learningObjectiveName || '',
          granularObjectives: new Map(),
        });
      }
      if (gId) {
        metaMap.get(metaId).granularObjectives.set(gId, { id: gId, name: q.granularObjectiveName || '' });
      }
    } else if (gId) {
      orphanGranulars.set(gId, { id: gId, name: q.granularObjectiveName || '' });
    }
  });

  const summary = Array.from(metaMap.values()).map((m) => ({
    metaObjectiveId: m.metaObjectiveId,
    metaObjectiveName: m.metaObjectiveName,
    granularObjectives: Array.from(m.granularObjectives.values()),
  }));
  if (orphanGranulars.size) {
    summary.push({
      metaObjectiveId: null,
      metaObjectiveName: '',
      granularObjectives: Array.from(orphanGranulars.values()),
    });
  }
  return summary;
}

// Whitelist the quiz settings that are safe to round-trip on import, coercing
// them to the same shapes createQuiz expects. Anything else the client sends
// (ids, section schedules, timestamps we regenerate) is dropped.
function normalizeQuizMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const out = {
    name: typeof meta.name === 'string' ? meta.name : '',
    description: typeof meta.description === 'string' ? meta.description : '',
    deliveryFormat: meta.deliveryFormat === 'spaced-3phase' ? 'spaced-3phase' : 'all-approved',
    disablePreviousNavigation: meta.disablePreviousNavigation === true,
    published: meta.published === true,
  };
  const minutes = Number(meta.timeLimitMinutes);
  if (Number.isInteger(minutes) && minutes > 0) out.timeLimitMinutes = minutes;
  // Informational only — import stamps its own createdAt; kept so a human reading
  // the file can see when the source quiz was made.
  if (meta.createdAt) out.createdAt = meta.createdAt;
  return out;
}

// --- Export helpers shared across CSV / QTI ---------------------------------

// Escape text for use in XML attributes / plain-text nodes.
function escapeXml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Canvas expects HTML content escaped, wrapping bare text in div/p like Canvas does.
function escapeHtmlForQTI(text) {
  if (!text) return '';
  const textStr = String(text).trim();
  if (/<[^>]+>/.test(textStr)) {
    return escapeXml(textStr);
  }
  return escapeXml(`<div><p>${textStr}</p></div>`);
}

// Wrap a value as a properly-escaped CSV field (double embedded quotes).
function csvField(value) {
  return `"${String(value === null || value === undefined ? '' : value).replace(/"/g, '""')}"`;
}

// Calculation questions have no QTI export: they were cut from the Canvas
// export (issue #46) because their parameterized model needs verification
// against a live Canvas import before we ship it. CSV and JSON still include
// them as data.
function filterQTIExportableQuestions(questions) {
  return questions.filter(
    (q) => normalizeQuestionType(q) !== QUESTION_TYPES.CALCULATION
  );
}

// Get questions for a course
const getQuestionsHandler = async (req, res) => {
  try {
    const { courseId } = req.query;

    if (!courseId) {
      return res.status(400).json({ 
        success: false,
        error: "courseId query parameter is required" 
      });
    }

    // Check if user is in course
    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({ 
        success: false,
        error: "User is not in course" 
      });
    }

    const questions = await getQuestions(courseId);

    res.json({
      success: true,
      questions: questions,
    });
  } catch (error) {
    console.error("Error fetching questions:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch questions" 
    });
  }
};

// Get a single question by ID
const getQuestionByIdHandler = async (req, res) => {
  try {
    const { questionId } = req.params;

    const courseId = await getQuestionCourseId(questionId);

    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({ 
        success: false,
        error: "User is not in course" 
      });
    }

    const question = await getQuestion(questionId);

    if (!question) {
      return res.status(404).json({ 
        success: false,
        error: "Question not found" 
      });
    }

    res.json({
      success: true,
      question: question,
    });
  } catch (error) {
    console.error("Error fetching question:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch question" 
    });
  }
};

// Save questions to question bank
const saveQuestionHandler = async (req, res) => {
  try {
    const { questions, courseId } = req.body;

    if (!courseId) {
      return res.status(400).json({ error: "Course ID is required" });
    }

    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({ error: "User is not in course" });
    }
    if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_GENERATION))) return;
    if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.QUESTION_GENERATION))) return;

    // Normalize to array
    const questionsArray = Array.isArray(questions) ? questions : (questions ? [questions] : []);

    if (questionsArray.length === 0) {
      return res.status(400).json({ error: "No questions provided to save" });
    }

    const savedQuestionIds = [];
    for (const questionData of questionsArray) {
      try {
        const questionResult = await saveQuestion(courseId, questionData);
        savedQuestionIds.push(questionResult.insertedId.toString());
      } catch (error) {
        console.error("Error saving individual question:", error);
      }
    }

    if (savedQuestionIds.length === 0) {
      return res.status(500).json({ error: "Failed to save any questions" });
    }

    res.json({
      success: true,
      message: `${savedQuestionIds.length} question(s) saved successfully`,
      savedCount: savedQuestionIds.length,
      questionIds: savedQuestionIds
    });
  } catch (error) {
    console.error("Error saving question:", error);
    res.status(500).json({ error: "Failed to save question" });
  }
};

// Update question
const updateQuestionHandler = async (req, res) => {
  try {
    const { questionId } = req.params;
    const updateData = req.body;

    const courseId = await getQuestionCourseId(questionId);

    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({ error: "User is not in course" });
    }
    if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_BANK))) return;
    if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.QUESTION_BANK))) return;

    if (!updateData) {
      return res.status(400).json({ error: "No update data provided" });
    }

    const question = await getQuestion(questionId);

    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    // Check if question is approved - non-faculty cannot edit approved questions
    if (!(await isFaculty(req.user))) {
      const questionStatus = question.status || "Draft";
      if (questionStatus.toLowerCase() === "approved") {
        return res.status(403).json({ 
          error: "You cannot edit approved questions" 
        });
      }
    }

    const result = await updateQuestion(questionId, updateData);

    res.json({
      success: true,
      message: "Question updated successfully",
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Error updating question:", error);
    if (error.code === "ORPHANED_APPROVAL_BLOCKED") {
      return res.status(409).json({ error: error.message });
    }
    res.status(500).json({ error: "Failed to update question" });
  }
};

// Update question status
const updateQuestionStatusHandler = async (req, res) => {
  try {
    const { questionId } = req.params;
    const { status } = req.body;

    const courseId = await getQuestionCourseId(questionId);

    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({ error: "User is not in course" });
    }
    if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_BANK))) return;
    if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.QUESTION_BANK))) return;

    // Staff cannot approve/unapprove questions
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({ 
        error: "Only faculty can approve or unapprove questions" 
      });
    }

    if (!status) {
      return res.status(400).json({ error: "Status is required" });
    }

    const question = await getQuestion(questionId);

    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    await updateQuestion(questionId, {
      status: status,
    });

    res.json({
      success: true,
      message: "Question status updated successfully",
      questionId,
      status,
    });
  } catch (error) {
    console.error("Error updating question status:", error);
    if (error.code === "ORPHANED_APPROVAL_BLOCKED") {
      return res.status(409).json({ error: error.message });
    }
    res.status(500).json({ error: "Failed to update question status" });
  }
};

// Delete question
const deleteQuestionHandler = async (req, res) => {
  try {
    const { questionId } = req.params;

    const courseId = await getQuestionCourseId(questionId);

    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({ error: "User is not in course" });
    }
    if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_BANK))) return;
    if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.QUESTION_BANK))) return;

    // Only faculty can delete questions
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({ 
        error: "Only faculty can delete questions" 
      });
    }

    const question = await getQuestion(questionId);
    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    const result = await deleteQuestion(questionId);

    res.json({
      success: true,
      message: "Question deleted successfully",
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Error deleting question:", error);
    res.status(500).json({ error: "Failed to delete question" });
  }
};

// Export questions in various formats
const exportQuestionsHandler = async (req, res) => {
  try {
    const { course, summary, questionIds, quizName, quizDescription, quizMeta } = req.body;
    const format = req.query.format || 'qti';

    // Two entry points: quiz export sends full question objects in `questions`;
    // individual export from the bank sends `questionIds`, and we fetch the full,
    // current docs from the database (the bank list carries only a slim shape).
    let questions = req.body.questions;
    if ((!questions || questions.length === 0) && Array.isArray(questionIds) && questionIds.length > 0) {
      if (!course) {
        return res.status(400).json({ error: "Course ID is required to export by question ID" });
      }
      if (!(await hasStaffAccessInCourse(req.user, course))) {
        return res.status(403).json({ error: "User is not in course" });
      }
      const allQuestions = await getQuestions(course);
      const wanted = new Set(questionIds.map((id) => String(id)));
      questions = (allQuestions || []).filter((q) => wanted.has(String(q._id)));
    }

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: "No questions provided for export" });
    }

    let exportData;
    let contentType;
    let filename;

    // CSV and JSON carry the objectives each question is linked to; resolve their
    // current names/IDs from the database before writing them out.
    const needsObjectives = format === 'csv' || format === 'json';
    const enrichedQuestions = needsObjectives
      ? await enrichQuestionsWithObjectives(questions)
      : questions;

    switch (format) {
      case 'csv':
        exportData = createCSVExport(course, enrichedQuestions);
        contentType = 'text/csv';
        filename = `questions-${course}-${Date.now()}.csv`;
        break;
      case 'json':
        exportData = JSON.stringify({
          course,
          summary,
          // Quiz-level settings, present only for a quiz export, so the file can
          // be re-imported as a working quiz (Phase 4).
          ...(quizMeta ? { quiz: normalizeQuizMeta(quizMeta) } : {}),
          // Objectives covered by this export, derived from the questions so the
          // summary always agrees with the per-question links below.
          objectives: buildObjectivesSummary(enrichedQuestions),
          questions: enrichedQuestions,
          exportedAt: new Date().toISOString()
        }, null, 2);
        contentType = 'application/json';
        filename = `questions-${course}-${Date.now()}.json`;
        break;
      case 'h5p': {
        const h5pQuestions = filterH5PExportableQuestions(questions);
        if (h5pQuestions.length === 0) {
          return res.status(400).json({
            error: "This quiz only contains calculation questions, which have no H5P equivalent. Use CSV or JSON instead."
          });
        }
        return await createH5PZipExport(res, course, h5pQuestions, quizName);
      }
      case 'qti':
      default: {
        // Canvas requires QTI in ZIP format
        const qtiQuestions = filterQTIExportableQuestions(questions);
        if (qtiQuestions.length === 0) {
          return res.status(400).json({
            error: "This quiz only contains calculation questions, which are not yet supported in Canvas (QTI) export. Use CSV or JSON instead."
          });
        }
        return await createQTIZipExport(res, course, qtiQuestions, quizName, quizDescription);
      }
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(exportData);

  } catch (error) {
    console.error("Export error:", error);
    res.status(500).json({ error: "Export failed" });
  }
};

// CSV export covers every question type with a shared, spreadsheet-friendly set
// of columns. Columns that don't apply to a given type are left blank.
function createCSVExport(course, questions) {
  const headers = [
    'Type',
    'Question',
    'Option A',
    'Option B',
    'Option C',
    'Option D',
    'Correct Answer',
    'Acceptable Answers',
    'Sample Answer',
    'Grading Criteria',
    'Formula',
    'Bloom Level',
    'Meta Learning Objective',
    'Granular Learning Objective',
    'Meta LO ID',
    'Granular LO ID',
  ];
  let csv = `${headers.map(csvField).join(',')}\n`;

  questions.forEach((q) => {
    const type = normalizeQuestionType(q);
    const row = {
      type,
      question: getQuestionText(q),
      optA: '',
      optB: '',
      optC: '',
      optD: '',
      correctAnswer: '',
      acceptableAnswers: '',
      sampleAnswer: '',
      gradingCriteria: '',
      formula: '',
      bloom: q.bloom || q.bloomLevel || '',
      metaObjective: q.learningObjectiveName || '',
      granularObjective: q.granularObjectiveName || '',
      metaObjectiveId: q.learningObjectiveId || '',
      granularObjectiveId: q.granularObjectiveId || '',
    };

    if (type === QUESTION_TYPES.MULTIPLE_CHOICE) {
      row.optA = getOptionText(q, 'A');
      row.optB = getOptionText(q, 'B');
      row.optC = getOptionText(q, 'C');
      row.optD = getOptionText(q, 'D');

      // correctAnswer may be a letter (A-D) or a numeric index (0-3).
      let letter = q.correctAnswer;
      if (typeof letter === 'number') {
        letter = ['A', 'B', 'C', 'D'][letter] || 'A';
      }
      letter = String(letter || '').toUpperCase();
      row.correctAnswer = getOptionText(q, letter) || letter;
    } else if (type === QUESTION_TYPES.FILL_IN_THE_BLANK) {
      const acceptable = getAcceptableAnswers(q);
      row.correctAnswer = String(q.correctAnswer || acceptable[0] || '');
      row.acceptableAnswers = acceptable.join('; ');
    } else if (type === QUESTION_TYPES.OPEN_ENDED) {
      row.sampleAnswer = String(q.openEndedSampleAnswer || '');
      row.gradingCriteria = String(q.openEndedGradingCriteria || '');
    } else if (type === QUESTION_TYPES.CALCULATION) {
      row.formula = String(q.calculationFormula || '');
      const specs = Array.isArray(q.calculationVariables) ? q.calculationVariables : [];
      if (specs.length > 0) {
        row.acceptableAnswers = specs
          .map((v) => `${v.name} ∈ [${v.min}, ${v.max}]`)
          .join('; ');
      }
    }

    csv += [
      row.type,
      row.question,
      row.optA,
      row.optB,
      row.optC,
      row.optD,
      row.correctAnswer,
      row.acceptableAnswers,
      row.sampleAnswer,
      row.gradingCriteria,
      row.formula,
      row.bloom,
      row.metaObjective,
      row.granularObjective,
      row.metaObjectiveId,
      row.granularObjectiveId,
    ].map(csvField).join(',') + '\n';
  });

  return csv;
}

/**
 * Generate a Canvas-compatible identifier (similar to Canvas's hash format)
 */
function generateCanvasId(prefix = 'g') {
  const chars = '0123456789abcdef';
  let id = prefix;
  for (let i = 0; i < 31; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Collect every instructor-attached image ref ({ fileId, filename, ... })
 * across the exported questions, de-duplicated by fileId.
 */
function collectExportImageRefs(questions) {
  const refs = new Map();
  const add = (ref) => {
    if (ref && typeof ref === 'object' && ref.fileId && !refs.has(String(ref.fileId))) {
      refs.set(String(ref.fileId), ref);
    }
  };
  for (const q of questions) {
    stemImagesOf(q).forEach(add);
  }
  return refs;
}

/**
 * Download the export's images from GridFS and lay out their ZIP placement.
 * `zipDir` is the archive folder the files land in; `imageSrc(name)` is the
 * reference stored in the exported document for a bundled file.
 *
 * Returns { imageMap, imageFiles } where imageMap: fileId -> { src, mimeType }
 * and imageFiles: [{ buffer, zipPath, href }] for the archive and manifest.
 * Missing GridFS files are skipped so one lost image never fails the export.
 */
async function prepareExportImages(questions, { zipDir, imageSrc }) {
  const refs = collectExportImageRefs(questions);
  const imageMap = new Map();
  const imageFiles = [];

  for (const [fileId, ref] of refs) {
    let buffer = null;
    try {
      buffer = await downloadImageBuffer(fileId);
    } catch (error) {
      console.error(`Failed to download image ${fileId} for export:`, error);
    }
    if (!buffer) {
      console.warn(`Skipping missing question image in export: ${fileId}`);
      continue;
    }

    const safeName =
      String(ref.filename || 'image').replace(/[^A-Za-z0-9._-]/g, '_') || 'image';
    const name = `${fileId}-${safeName}`;
    imageFiles.push({
      buffer,
      zipPath: `${zipDir}/${name}`,
      href: `${zipDir}/${name}`,
    });
    imageMap.set(fileId, {
      src: imageSrc(name),
      mimeType: String(ref.mimeType || ''),
    });
  }

  return { imageMap, imageFiles };
}

// Canvas imports files under web_resources/ into course Files, and
// $IMS-CC-FILEBASE$ in item HTML resolves to that root.
function prepareQTIExportImages(questions) {
  return prepareExportImages(questions, {
    zipDir: 'web_resources/grasp',
    imageSrc: (name) => `$IMS-CC-FILEBASE$/grasp/${encodeURIComponent(name)}`,
  });
}

// H5P media files live under content/; content.json references them with
// paths relative to that folder (filenames are already URL-safe).
function prepareH5PExportImages(questions) {
  return prepareExportImages(questions, {
    zipDir: 'content/images',
    imageSrc: (name) => `images/${name}`,
  });
}

/**
 * Create H5P export: a .h5p package (ZIP with h5p.json + content/content.json).
 * The package shape depends on the question mix (see utils/h5p-export.js).
 * Content-only package — the target host must already have the referenced H5P
 * libraries installed.
 */
async function createH5PZipExport(res, course, questions, quizName) {
  const title = quizName || course || 'Quiz';
  const safeName = String(title).replace(/[^a-zA-Z0-9-_]+/g, '-').toLowerCase() || 'quiz';
  const filename = `${safeName}-${Date.now()}.h5p`;

  // Fetch instructor-attached images from GridFS before any headers are
  // sent, so failures here still return a clean JSON error.
  const { imageMap, imageFiles } = await prepareH5PExportImages(questions);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('H5P archive error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to create H5P file' });
    }
  });
  archive.pipe(res);

  const { manifest, content } = buildH5PPackage(title, questions, imageMap);
  archive.append(JSON.stringify(manifest, null, 2), { name: 'h5p.json' });
  archive.append(JSON.stringify(content, null, 2), { name: 'content/content.json' });
  for (const imageFile of imageFiles) {
    archive.append(imageFile.buffer, { name: imageFile.zipPath });
  }
  archive.finalize();
}

/**
 * Create QTI export as ZIP file (Canvas requires ZIP format with specific structure)
 */
async function createQTIZipExport(res, course, questions, quizName, quizDescription) {
  const timestamp = Date.now();
  const filename = `questions-${course}-${timestamp}.zip`;

  // Generate Canvas-compatible IDs
  const assessmentId = generateCanvasId('g');

  // Fetch instructor-attached images from GridFS before any headers are
  // sent, so failures here still return a clean JSON error.
  const { imageMap, imageFiles } = await prepareQTIExportImages(questions);

  // Set headers for ZIP file
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  // Create archiver for ZIP
  const archive = archiver('zip', {
    zlib: { level: 9 } // Maximum compression
  });

  // Handle errors
  archive.on('error', (err) => {
    console.error('Archive error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to create ZIP file' });
    }
  });

  // Pipe archive data to response
  archive.pipe(res);

  // Use quiz name for title, fallback to course name
  const title = quizName || course || 'Quiz';

  // Generate QTI XML (Canvas format)
  const qtiXml = createQTIExport(title, questions, assessmentId, imageMap);

  // Create manifest (Canvas Common Cartridge format)
  const { manifest, metaId } = createIMSManifest(course, assessmentId, timestamp, imageFiles);

  // Create assessment_meta.xml (Canvas requires this)
  const assessmentMeta = createAssessmentMeta(title, quizDescription, assessmentId, metaId, questions.length);

  // Add files in Canvas structure:
  // - imsmanifest.xml at root
  // - {assessmentId}/{assessmentId}.xml (the QTI assessment)
  // - {assessmentId}/assessment_meta.xml (metadata)
  // - web_resources/grasp/* (question images, imported into Canvas Files)
  archive.append(manifest, { name: 'imsmanifest.xml' });
  archive.append(qtiXml, { name: `${assessmentId}/${assessmentId}.xml` });
  archive.append(assessmentMeta, { name: `${assessmentId}/assessment_meta.xml` });
  for (const imageFile of imageFiles) {
    archive.append(imageFile.buffer, { name: imageFile.zipPath });
  }

  // Finalize the archive
  archive.finalize();
}

/**
 * Create assessment_meta.xml (Canvas-specific metadata file)
 */
function createAssessmentMeta(quizName, quizDescription, assessmentId, metaId, questionCount) {
  const safeQuizName = escapeXml(quizName || 'Quiz');
  const safeDescription = escapeXml(quizDescription || '');
  // Canvas expects description to be wrapped in <p> tags if it contains HTML
  const descriptionXml = safeDescription ? `&lt;p&gt;${safeDescription}&lt;/p&gt;` : '';
  const assignmentId = generateCanvasId('g');
  // Canvas sets points_possible to the number of questions (1 point per question)
  const totalPoints = questionCount || 1;
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<quiz identifier="${assessmentId}" xmlns="http://canvas.instructure.com/xsd/cccv1p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd">
  <title>${safeQuizName}</title>
  <description>${descriptionXml}</description>
  <shuffle_answers>true</shuffle_answers>
  <scoring_policy>keep_highest</scoring_policy>
  <hide_results></hide_results>
  <quiz_type>assignment</quiz_type>
  <points_possible>${totalPoints}.0</points_possible>
  <require_lockdown_browser>false</require_lockdown_browser>
  <require_lockdown_browser_for_results>false</require_lockdown_browser_for_results>
  <require_lockdown_browser_monitor>false</require_lockdown_browser_monitor>
  <lockdown_browser_monitor_data/>
  <show_correct_answers>true</show_correct_answers>
  <anonymous_submissions>false</anonymous_submissions>
  <could_be_locked>false</could_be_locked>
  <disable_timer_autosubmission>false</disable_timer_autosubmission>
  <allowed_attempts>1</allowed_attempts>
  <one_question_at_a_time>false</one_question_at_a_time>
  <cant_go_back>false</cant_go_back>
  <available>false</available>
  <one_time_results>false</one_time_results>
  <show_correct_answers_last_attempt>false</show_correct_answers_last_attempt>
  <only_visible_to_overrides>false</only_visible_to_overrides>
  <module_locked>false</module_locked>
  <assignment identifier="${assignmentId}">
    <title>${safeQuizName}</title>
    <due_at/>
    <lock_at/>
    <unlock_at/>
    <module_locked>false</module_locked>
    <workflow_state>unpublished</workflow_state>
    <assignment_overrides>
    </assignment_overrides>
    <quiz_identifierref>${assessmentId}</quiz_identifierref>
    <allowed_extensions></allowed_extensions>
    <has_group_category>false</has_group_category>
    <points_possible>${totalPoints}.0</points_possible>
    <grading_type>points</grading_type>
    <all_day>false</all_day>
    <submission_types>online_quiz</submission_types>
    <position>1</position>
    <turnitin_enabled>false</turnitin_enabled>
    <vericite_enabled>false</vericite_enabled>
    <peer_review_count>0</peer_review_count>
    <peer_reviews>false</peer_reviews>
    <automatic_peer_reviews>false</automatic_peer_reviews>
    <anonymous_peer_reviews>false</anonymous_peer_reviews>
    <grade_group_students_individually>false</grade_group_students_individually>
    <freeze_on_copy>false</freeze_on_copy>
    <omit_from_final_grade>false</omit_from_final_grade>
    <hide_in_gradebook>false</hide_in_gradebook>
    <intra_group_peer_reviews>false</intra_group_peer_reviews>
    <only_visible_to_overrides>false</only_visible_to_overrides>
    <post_to_sis>false</post_to_sis>
    <moderated_grading>false</moderated_grading>
    <grader_count>0</grader_count>
    <grader_comments_visible_to_graders>true</grader_comments_visible_to_graders>
    <anonymous_grading>false</anonymous_grading>
    <graders_anonymous_to_graders>false</graders_anonymous_to_graders>
    <grader_names_visible_to_final_grader>true</grader_names_visible_to_final_grader>
    <anonymous_instructor_annotations>false</anonymous_instructor_annotations>
    <post_policy>
      <post_manually>false</post_manually>
    </post_policy>
  </assignment>
  <assignment_group_identifierref>${generateCanvasId('g')}</assignment_group_identifierref>
  <assignment_overrides>
  </assignment_overrides>
</quiz>`;
}

/**
 * Create IMS Manifest XML file (Canvas Common Cartridge format)
 */
function createIMSManifest(course, assessmentId, timestamp, imageFiles = []) {
  const safeCourse = escapeXml(course || 'Quiz');
  const manifestId = generateCanvasId('g');
  const metaId = generateCanvasId('g');

  // Question images ship as webcontent resources the assessment depends on;
  // Canvas copies them into course Files on import.
  const imageResources = imageFiles.map((imageFile) => ({
    id: generateCanvasId('g'),
    href: imageFile.href,
  }));
  const imageDependenciesXml = imageResources
    .map((r) => `\n      <dependency identifierref="${r.id}"/>`)
    .join('');
  const imageResourcesXml = imageResources
    .map(
      (r) => `
    <resource identifier="${r.id}" type="webcontent" href="${escapeXml(r.href)}">
      <file href="${escapeXml(r.href)}"/>
    </resource>`
    )
    .join('');

  return {
    manifest: `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${manifestId}" xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1" xmlns:lom="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource" xmlns:imsmd="http://www.imsglobal.org/xsd/imsmd_v1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1 http://www.imsglobal.org/xsd/imscp_v1p1.xsd http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource http://www.imsglobal.org/profile/cc/ccv1p1/LOM/ccv1p1_lomresource_v1p0.xsd http://www.imsglobal.org/xsd/imsmd_v1p2 http://www.imsglobal.org/xsd/imsmd_v1p2p2.xsd">
  <metadata>
    <schema>IMS Content</schema>
    <schemaversion>1.1.3</schemaversion>
    <imsmd:lom>
      <imsmd:general>
        <imsmd:title>
          <imsmd:string>QTI Quiz Export for course "${safeCourse}"</imsmd:string>
        </imsmd:title>
      </imsmd:general>
      <imsmd:lifeCycle>
        <imsmd:contribute>
          <imsmd:date>
            <imsmd:dateTime>${new Date().toISOString().split('T')[0]}</imsmd:dateTime>
          </imsmd:date>
        </imsmd:contribute>
      </imsmd:lifeCycle>
      <imsmd:rights>
        <imsmd:copyrightAndOtherRestrictions>
          <imsmd:value>yes</imsmd:value>
        </imsmd:copyrightAndOtherRestrictions>
        <imsmd:description>
          <imsmd:string>Private (Copyrighted) - http://en.wikipedia.org/wiki/Copyright</imsmd:string>
        </imsmd:description>
      </imsmd:rights>
    </imsmd:lom>
  </metadata>
  <organizations/>
  <resources>
    <resource identifier="${assessmentId}" type="imsqti_xmlv1p2">
      <file href="${assessmentId}/${assessmentId}.xml"/>
      <dependency identifierref="${metaId}"/>${imageDependenciesXml}
    </resource>
    <resource identifier="${metaId}" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="${assessmentId}/assessment_meta.xml">
      <file href="${assessmentId}/assessment_meta.xml"/>
    </resource>${imageResourcesXml}
  </resources>
</manifest>`,
    metaId: metaId
  };
}

// Build the escaped mattext body for the stem text plus its attached images.
// The <img> src uses $IMS-CC-FILEBASE$ so Canvas rewrites it to the imported
// course file. Renders the stem text followed by every bundled image; falls
// back to text-only when no images were bundled (e.g. missing from GridFS).
function buildHtmlWithImages(text, imageRefs, imageMap) {
  const bundled = (Array.isArray(imageRefs) ? imageRefs : [])
    .map((ref) => ({ ref, entry: ref?.fileId ? imageMap?.get(String(ref.fileId)) : null }))
    .filter((x) => x.entry);
  if (bundled.length === 0) return escapeHtmlForQTI(text);

  const textHtml = String(text || '').trim()
    ? `<p>${escapeXml(String(text).trim())}</p>`
    : '';
  const imgsHtml = bundled
    .map(({ ref, entry }) => {
      // Instructor caption doubles as alt text and a visible caption line.
      const caption = escapeXml(ref.caption || ref.alt || '');
      const captionHtml = caption ? `<p><em>${caption}</em></p>` : '';
      return `<p><img src="${entry.src}" alt="${caption}"></p>${captionHtml}`;
    })
    .join('');
  const html = `<div>${textHtml}${imgsHtml}</div>`;
  return escapeXml(html);
}

function createQTIExport(course, allQuestions, assessmentId, imageMap = new Map()) {
  const questions = filterQTIExportableQuestions(allQuestions);
  // Sanitize course name for title (Canvas is sensitive to special characters)
  const assessmentTitle = escapeXml(course || 'Quiz');

  let qti = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/ims_qtiasiv1p2 http://www.imsglobal.org/xsd/ims_qtiasiv1p2p1.xsd">
  <assessment ident="${assessmentId}" title="${assessmentTitle}">
    <qtimetadata>
      <qtimetadatafield>
        <fieldlabel>cc_maxattempts</fieldlabel>
        <fieldentry>1</fieldentry>
      </qtimetadatafield>
    </qtimetadata>
    <section ident="root_section">`;

  questions.forEach((q, index) => {
    qti += createQTIItem(q, index, imageMap);
  });

  qti += `
    </section>
  </assessment>
</questestinterop>`;

  return qti;
}

// Dispatch a single question to the appropriate Canvas QTI item builder.
function createQTIItem(q, index, imageMap) {
  const type = normalizeQuestionType(q);
  let questionText = getQuestionText(q);
  if (!questionText.trim()) {
    questionText = `Question ${index + 1}`;
  }
  // The question's stem text plus any bundled attached images, ready to drop
  // into the item's <mattext> body.
  const questionHtml = buildHtmlWithImages(questionText, stemImagesOf(q), imageMap);

  switch (type) {
    case QUESTION_TYPES.FILL_IN_THE_BLANK:
      return buildShortAnswerItem(q, questionHtml);
    case QUESTION_TYPES.OPEN_ENDED:
      return buildEssayItem(q, questionHtml);
    case QUESTION_TYPES.CALCULATION:
      // No QTI representation shipped; filtered out upstream. Guard against
      // direct calls so a calc question can never masquerade as another type.
      return '';
    case QUESTION_TYPES.MULTIPLE_CHOICE:
    default:
      return buildMultipleChoiceItem(q, index, questionHtml);
  }
}

// Shared <itemmetadata> block. `extraFields` lets a type add fields like
// original_answer_ids while keeping the common ones consistent.
function qtiItemMetadata(qtiType, assessmentQuestionId, extraFields = '') {
  return `
        <itemmetadata>
          <qtimetadata>
            <qtimetadatafield>
              <fieldlabel>question_type</fieldlabel>
              <fieldentry>${qtiType}</fieldentry>
            </qtimetadatafield>
            <qtimetadatafield>
              <fieldlabel>points_possible</fieldlabel>
              <fieldentry>1.0</fieldentry>
            </qtimetadatafield>${extraFields}
            <qtimetadatafield>
              <fieldlabel>assessment_question_identifierref</fieldlabel>
              <fieldentry>${assessmentQuestionId}</fieldentry>
            </qtimetadatafield>
          </qtimetadata>
        </itemmetadata>`;
}

function buildMultipleChoiceItem(q, index, questionHtml) {
  let optA = getOptionText(q, 'A') || 'Option A';
  let optB = getOptionText(q, 'B') || 'Option B';
  let optC = getOptionText(q, 'C') || 'Option C';
  let optD = getOptionText(q, 'D') || 'Option D';

  // Canvas requires non-empty options.
  if (!optA.trim()) optA = 'Option A';
  if (!optB.trim()) optB = 'Option B';
  if (!optC.trim()) optC = 'Option C';
  if (!optD.trim()) optD = 'Option D';

  // Canvas uses numeric string IDs (4+ digits) for answer choices.
  const generateNumericId = () => String(Math.floor(Math.random() * 9000) + 1000);
  const answerIds = [generateNumericId(), generateNumericId(), generateNumericId(), generateNumericId()];

  const correctAnswerId = answerIds[getCorrectAnswerIndex(q)];

  const questionId = generateCanvasId('g');
  const assessmentQuestionId = generateCanvasId('g');
  const responseId = `response${index + 1}`;
  const options = [optA, optB, optC, optD];

  const choices = answerIds
    .map(
      (id, i) => `
              <response_label ident="${id}">
                <material>
                  <mattext texttype="text/plain">${escapeXml(options[i])}</mattext>
                </material>
              </response_label>`
    )
    .join('');

  const extraFields = `
            <qtimetadatafield>
              <fieldlabel>original_answer_ids</fieldlabel>
              <fieldentry>${answerIds.join(',')}</fieldentry>
            </qtimetadatafield>`;

  return `
      <item ident="${questionId}" title="Question">${qtiItemMetadata('multiple_choice_question', assessmentQuestionId, extraFields)}
        <presentation>
          <material>
            <mattext texttype="text/html">${questionHtml}</mattext>
          </material>
          <response_lid ident="${responseId}" rcardinality="Single">
            <render_choice>${choices}
            </render_choice>
          </response_lid>
        </presentation>
        <resprocessing>
          <outcomes>
            <decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/>
          </outcomes>
          <respcondition continue="No">
            <conditionvar>
              <varequal respident="${responseId}">${correctAnswerId}</varequal>
            </conditionvar>
            <setvar action="Set" varname="SCORE">100</setvar>
          </respcondition>
        </resprocessing>
      </item>`;
}

// Fill-in-the-blank -> Canvas "short answer" question. Every acceptable answer
// becomes a case-insensitive varequal; matching any of them scores full marks.
function buildShortAnswerItem(q, questionHtml) {
  const questionId = generateCanvasId('g');
  const assessmentQuestionId = generateCanvasId('g');
  const responseId = 'response1';

  let answers = getAcceptableAnswers(q);
  if (answers.length === 0) answers = ['answer'];

  const conditions = answers
    .map((a) => `              <varequal respident="${responseId}" case="No">${escapeXml(a)}</varequal>`)
    .join('\n');

  return `
      <item ident="${questionId}" title="Question">${qtiItemMetadata('short_answer_question', assessmentQuestionId)}
        <presentation>
          <material>
            <mattext texttype="text/html">${questionHtml}</mattext>
          </material>
          <response_str ident="${responseId}" rcardinality="Single">
            <render_fib>
              <response_label ident="answer1"/>
            </render_fib>
          </response_str>
        </presentation>
        <resprocessing>
          <outcomes>
            <decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/>
          </outcomes>
          <respcondition continue="No">
            <conditionvar>
${conditions}
            </conditionvar>
            <setvar action="Set" varname="SCORE">100</setvar>
          </respcondition>
        </resprocessing>
      </item>`;
}

// Open-ended -> Canvas "essay" question (manually graded). Sample answer and
// grading criteria are attached as general feedback so instructors keep them.
function buildEssayItem(q, questionHtml) {
  const questionId = generateCanvasId('g');
  const assessmentQuestionId = generateCanvasId('g');
  const responseId = 'response1';

  const sample = String(q.openEndedSampleAnswer || '').trim();
  const criteria = String(q.openEndedGradingCriteria || '').trim();
  const feedbackParts = [];
  if (sample) feedbackParts.push(`Sample answer: ${sample}`);
  if (criteria) feedbackParts.push(`Grading criteria: ${criteria}`);
  const hasFeedback = feedbackParts.length > 0;

  const feedbackDisplay = hasFeedback
    ? `
            <displayfeedback feedbacktype="Response" linkrefid="general_fb"/>`
    : '';
  const feedbackBlock = hasFeedback
    ? `
        <itemfeedback ident="general_fb">
          <flow_mat>
            <material>
              <mattext texttype="text/html">${escapeHtmlForQTI(feedbackParts.join('\n\n'))}</mattext>
            </material>
          </flow_mat>
        </itemfeedback>`
    : '';

  return `
      <item ident="${questionId}" title="Question">${qtiItemMetadata('essay_question', assessmentQuestionId)}
        <presentation>
          <material>
            <mattext texttype="text/html">${questionHtml}</mattext>
          </material>
          <response_str ident="${responseId}" rcardinality="Single">
            <render_fib>
              <response_label ident="answer1"/>
            </render_fib>
          </response_str>
        </presentation>
        <resprocessing>
          <outcomes>
            <decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/>
          </outcomes>
          <respcondition continue="Yes">
            <conditionvar>
              <other/>
            </conditionvar>${feedbackDisplay}
          </respcondition>
        </resprocessing>${feedbackBlock}
      </item>`;
}

module.exports = {
  getQuestionsHandler,
  getQuestionByIdHandler,
  saveQuestionHandler,
  updateQuestionHandler,
  updateQuestionStatusHandler,
  deleteQuestionHandler,
  exportQuestionsHandler,
  // Exported for unit testing of the export logic.
  createCSVExport,
  createQTIExport,
  createQTIItem,
  buildObjectivesSummary,
  normalizeQuizMeta,
};
