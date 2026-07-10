const archiver = require('archiver');
const { saveQuestion, updateQuestion, deleteQuestion, getQuestions } = require('../services/question');
const { isUserInCourse } = require('../services/user-course');
const { getQuestionCourseId, getQuestion } = require('../services/question');
const { isFaculty } = require('../utils/auth');
const { assertCoInstructorPermission, PERMISSION_KEYS } = require('../utils/co-instructor-permissions');
const quizService = require('../services/quiz');
const { ObjectId } = require('mongodb');
const { QUESTION_TYPES } = require('../constants/app-constants');
const CalculationQuestion = require('../models/questions/CalculationQuestion');

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

// Resolve a question's internal type, defaulting to multiple-choice for legacy rows.
function normalizeQuestionType(q) {
  const t = String(q.questionType || q.type || '').toLowerCase().trim();
  if (Object.values(QUESTION_TYPES).includes(t)) return t;
  return QUESTION_TYPES.MULTIPLE_CHOICE;
}

// The student-facing question text. Multiple-choice keeps the prompt in `title`
// (its `stem` is a generic "Select the best answer:"); the other types keep the
// real prompt in `stem`.
function getQuestionText(q) {
  if (normalizeQuestionType(q) === QUESTION_TYPES.MULTIPLE_CHOICE) {
    return String(q.title || q.stem || q.text || q.question || '').trim();
  }
  return String(q.stem || q.question || q.text || q.title || '').trim();
}

// Options are stored as an object keyed A-D; values are strings or { text, feedback }.
function getOptionText(q, key) {
  if (!q.options || typeof q.options !== 'object') return '';
  const opt = q.options[key];
  if (typeof opt === 'string') return opt;
  return (opt && (opt.text || '')) || '';
}

// Calculation questions are excluded from QTI export until the
// calculated_question output is verified against a live Canvas import
// (issue #46). The builder (buildCalculationItem) is complete and unit-tested —
// re-enable by removing this filter. CSV and JSON exports still include them.
function filterQTIExportableQuestions(questions) {
  return questions.filter(
    (q) => normalizeQuestionType(q) !== QUESTION_TYPES.CALCULATION
  );
}

// Acceptable answers for fill-in-the-blank, canonical answer first, de-duplicated.
function getAcceptableAnswers(q) {
  const answers = (Array.isArray(q.acceptableAnswers) ? q.acceptableAnswers : [])
    .map((a) => String(a).trim())
    .filter(Boolean);
  const canonical = String(q.correctAnswer || '').trim();
  if (canonical && !answers.some((a) => a.toLowerCase() === canonical.toLowerCase())) {
    answers.unshift(canonical);
  }
  return answers;
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
    if (!isUserInCourse(req.user.id, courseId)) {
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

    if (!isUserInCourse(req.user.id, courseId)) {
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

    if (!isUserInCourse(req.user.id, courseId)) {
      return res.status(403).json({ error: "User is not in course" });
    }
    if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_GENERATION))) return;

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

    if (!isUserInCourse(req.user.id, courseId)) {
      return res.status(403).json({ error: "User is not in course" });
    }
    if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_BANK))) return;

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
    res.status(500).json({ error: "Failed to update question" });
  }
};

// Update question status
const updateQuestionStatusHandler = async (req, res) => {
  try {
    const { questionId } = req.params;
    const { status } = req.body;

    const courseId = await getQuestionCourseId(questionId);

    if (!isUserInCourse(req.user.id, courseId)) {
      return res.status(403).json({ error: "User is not in course" });
    }
    if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_BANK))) return;

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
    res.status(500).json({ error: "Failed to update question status" });
  }
};

// Delete question
const deleteQuestionHandler = async (req, res) => {
  try {
    const { questionId } = req.params;

    const courseId = await getQuestionCourseId(questionId);

    if (!isUserInCourse(req.user.id, courseId)) {
      return res.status(403).json({ error: "User is not in course" });
    }
    if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_BANK))) return;

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
    const { course, summary, objectives, questions, quizName, quizDescription } = req.body;
    const format = req.query.format || 'qti';

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: "No questions provided for export" });
    }

    let exportData;
    let contentType;
    let filename;

    switch (format) {
      case 'csv':
        exportData = createCSVExport(course, questions);
        contentType = 'text/csv';
        filename = `questions-${course}-${Date.now()}.csv`;
        break;
      case 'json':
        exportData = JSON.stringify({
          course,
          summary,
          objectives,
          questions,
          exportedAt: new Date().toISOString()
        }, null, 2);
        contentType = 'application/json';
        filename = `questions-${course}-${Date.now()}.json`;
        break;
      case 'qti':
      default: {
        // Canvas requires QTI in ZIP format
        const qtiQuestions = filterQTIExportableQuestions(questions);
        if (qtiQuestions.length === 0) {
          return res.status(400).json({
            error: "This quiz only contains calculation questions, which are not yet supported in Canvas (QTI) export. Use CSV or JSON instead."
          });
        }
        return createQTIZipExport(res, course, qtiQuestions, quizName, quizDescription);
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
 * Create QTI export as ZIP file (Canvas requires ZIP format with specific structure)
 */
function createQTIZipExport(res, course, questions, quizName, quizDescription) {
  const timestamp = Date.now();
  const filename = `questions-${course}-${timestamp}.zip`;
  
  // Generate Canvas-compatible IDs
  const assessmentId = generateCanvasId('g');
  
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
  const qtiXml = createQTIExport(title, questions, assessmentId);
  
  // Create manifest (Canvas Common Cartridge format)
  const { manifest, metaId } = createIMSManifest(course, assessmentId, timestamp);
  
  // Create assessment_meta.xml (Canvas requires this)
  const assessmentMeta = createAssessmentMeta(title, quizDescription, assessmentId, metaId, questions.length);
  
  // Add files in Canvas structure:
  // - imsmanifest.xml at root
  // - {assessmentId}/{assessmentId}.xml (the QTI assessment)
  // - {assessmentId}/assessment_meta.xml (metadata)
  archive.append(manifest, { name: 'imsmanifest.xml' });
  archive.append(qtiXml, { name: `${assessmentId}/${assessmentId}.xml` });
  archive.append(assessmentMeta, { name: `${assessmentId}/assessment_meta.xml` });
  
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
function createIMSManifest(course, assessmentId, timestamp) {
  const safeCourse = escapeXml(course || 'Quiz');
  const manifestId = generateCanvasId('g');
  const metaId = generateCanvasId('g');
  
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
      <dependency identifierref="${metaId}"/>
    </resource>
    <resource identifier="${metaId}" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="${assessmentId}/assessment_meta.xml">
      <file href="${assessmentId}/assessment_meta.xml"/>
    </resource>
  </resources>
</manifest>`,
    metaId: metaId
  };
}

function createQTIExport(course, allQuestions, assessmentId) {
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
    qti += createQTIItem(q, index);
  });

  qti += `
    </section>
  </assessment>
</questestinterop>`;

  return qti;
}

// Dispatch a single question to the appropriate Canvas QTI item builder.
function createQTIItem(q, index) {
  const type = normalizeQuestionType(q);
  let questionText = getQuestionText(q);
  if (!questionText.trim()) {
    questionText = `Question ${index + 1}`;
  }

  switch (type) {
    case QUESTION_TYPES.FILL_IN_THE_BLANK:
      return buildShortAnswerItem(q, questionText);
    case QUESTION_TYPES.OPEN_ENDED:
      return buildEssayItem(q, questionText);
    case QUESTION_TYPES.CALCULATION:
      return buildCalculationItem(q, questionText);
    case QUESTION_TYPES.MULTIPLE_CHOICE:
    default:
      return buildMultipleChoiceItem(q, index, questionText);
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

function buildMultipleChoiceItem(q, index, questionText) {
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

  // correctAnswer may be a letter (A-D) or a numeric index (0-3).
  let correctAnswerIndex = 0;
  if (typeof q.correctAnswer === 'number') {
    correctAnswerIndex = q.correctAnswer >= 0 && q.correctAnswer < 4 ? q.correctAnswer : 0;
  } else if (typeof q.correctAnswer === 'string') {
    correctAnswerIndex = ['A', 'B', 'C', 'D'].indexOf(q.correctAnswer.toUpperCase());
    if (correctAnswerIndex === -1) correctAnswerIndex = 0;
  }
  const correctAnswerId = answerIds[correctAnswerIndex];

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
            <mattext texttype="text/html">${escapeHtmlForQTI(questionText)}</mattext>
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
function buildShortAnswerItem(q, questionText) {
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
            <mattext texttype="text/html">${escapeHtmlForQTI(questionText)}</mattext>
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
function buildEssayItem(q, questionText) {
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
            <mattext texttype="text/html">${escapeHtmlForQTI(questionText)}</mattext>
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

// Calculation -> Canvas "Formula" question (calculated_question). Canvas's
// parameterized model matches ours: variable ranges + formula + tolerance, plus
// a pool of pre-generated value sets (<var_sets>) that Canvas draws from per
// student attempt. We generate that pool with the same sampling/evaluation code
// GRASP uses to grade, so Canvas grades identically. The XML shape mirrors what
// Canvas itself emits for Classic Quizzes (lib/cc/qti/qti_items.rb) and what
// its QTI importer parses back (qti_exporter/lib/qti/calculated_interaction.rb).
const CALCULATION_EXPORT_VAR_SETS = 20;

function buildCalculationItem(q, questionText) {
  const specs = (Array.isArray(q.calculationVariables) ? q.calculationVariables : [])
    .filter((s) => CalculationQuestion.sanitizeVariableName(s));
  const formula = String(q.calculationFormula || '');
  const template = String(q.stem || q.title || questionText || '');
  let decimals = parseInt(q.calculationAnswerDecimals, 10);
  if (!Number.isFinite(decimals)) decimals = 2;
  decimals = Math.max(0, Math.min(12, decimals));
  const tol = Number(q.calculationAnswerTolerancePercent);

  const varSets = generateCalculationVarSets({ specs, formula, decimals });
  if (varSets.length === 0) {
    // Sampling failed (bad formula/variables) — degrade to an essay item that
    // still shows the problem so the instructor can fix it in Canvas.
    const specDesc = specs.map((v) => `${v.name} ∈ [${v.min}, ${v.max}]`).join(', ');
    const fallbackText = `${questionText}${formula ? `\n\nFormula: ${formula}` : ''}${specDesc ? `\nVariables: ${specDesc}` : ''}`;
    return buildEssayItem(
      { openEndedSampleAnswer: '', openEndedGradingCriteria: '' },
      fallbackText
    );
  }

  // Canvas formula questions write placeholders as [x]; ours are {{x}}.
  const canvasText = CalculationQuestion.normalizePlaceholders(template, specs)
    .replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, '[$1]');

  // Percent tolerance maps directly ("2%"). With no tolerance configured GRASP
  // grades by rounding to the displayed decimals; an absolute margin of half an
  // ulp at that precision reproduces that behaviour in Canvas.
  const answerTolerance = Number.isFinite(tol) && tol > 0
    ? `${tol}%`
    : String(0.5 * Math.pow(10, -decimals));

  const questionId = generateCanvasId('g');
  const assessmentQuestionId = generateCanvasId('g');
  const responseId = 'response1';

  const varsXml = specs
    .map((spec) => {
      const name = escapeXml(CalculationQuestion.sanitizeVariableName(spec));
      const scale = spec.integerOnly === true
        ? 0
        : Math.max(0, Math.min(8, parseInt(spec.decimals, 10) || 0));
      return `
              <var name="${name}" scale="${scale}">
                <min>${escapeXml(spec.min)}</min>
                <max>${escapeXml(spec.max)}</max>
              </var>`;
    })
    .join('');

  const specByName = {};
  specs.forEach((s) => { specByName[CalculationQuestion.sanitizeVariableName(s)] = s; });

  const varSetsXml = varSets
    .map(({ values, answer }) => {
      const valueNodes = Object.entries(values)
        .map(([name, value]) => `
                <var name="${escapeXml(name)}">${escapeXml(CalculationQuestion.formatVariableForTemplate(value, specByName[name]))}</var>`)
        .join('');
      const ident = String(Math.floor(Math.random() * 90000) + 10000);
      return `
              <var_set ident="${ident}">${valueNodes}
                <answer>${escapeXml(answer)}</answer>
              </var_set>`;
    })
    .join('');

  return `
      <item ident="${questionId}" title="Question">${qtiItemMetadata('calculated_question', assessmentQuestionId)}
        <presentation>
          <material>
            <mattext texttype="text/html">${escapeHtmlForQTI(canvasText)}</mattext>
          </material>
          <response_str ident="${responseId}" rcardinality="Single">
            <render_fib fibtype="Decimal">
              <response_label ident="answer1"/>
            </render_fib>
          </response_str>
        </presentation>
        <resprocessing>
          <outcomes>
            <decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/>
          </outcomes>
          <respcondition title="correct">
            <conditionvar>
              <other/>
            </conditionvar>
            <setvar action="Set" varname="SCORE">100</setvar>
          </respcondition>
          <respcondition title="incorrect">
            <conditionvar>
              <not>
                <other/>
              </not>
            </conditionvar>
            <setvar action="Set" varname="SCORE">0</setvar>
          </respcondition>
        </resprocessing>
        <itemproc_extension>
          <calculated>
            <answer_tolerance>${escapeXml(answerTolerance)}</answer_tolerance>
            <formulas decimal_places="${decimals}">
              <formula>${escapeXml(toCanvasFormula(formula))}</formula>
            </formulas>
            <vars>${varsXml}
            </vars>
            <var_sets>${varSetsXml}
            </var_sets>
          </calculated>
        </itemproc_extension>
      </item>`;
}

// Canvas's formula engine uses lowercase pi/e for its math constants; expr-eval
// canonicalizes them to PI/E. Variables can't be named pi/e (reserved), so a
// bare word-boundary rewrite is safe.
function toCanvasFormula(formula) {
  return String(formula || '')
    .replace(/\bPI\b/g, 'pi')
    .replace(/\bE\b/g, 'e');
}

// Pre-generate the pool of {values -> answer} sets Canvas draws from. Answers
// are computed by the same evaluator that grades student attempts in GRASP.
// De-duplicates identical draws; small discrete ranges simply yield fewer sets.
function generateCalculationVarSets({ specs, formula, decimals }) {
  if (!Array.isArray(specs) || specs.length === 0 || !String(formula).trim()) {
    return [];
  }
  const sets = [];
  const seen = new Set();
  const maxAttempts = CALCULATION_EXPORT_VAR_SETS * 10;
  for (let i = 0; i < maxAttempts && sets.length < CALCULATION_EXPORT_VAR_SETS; i++) {
    try {
      const values = CalculationQuestion.generateVariableValues(specs);
      const key = JSON.stringify(values);
      if (seen.has(key)) continue;
      const answer = CalculationQuestion.evaluateCalculationFormula(formula, values);
      seen.add(key);
      sets.push({ values, answer: CalculationQuestion.roundToDecimals(answer, decimals) });
    } catch (e) {
      // Singular draw (e.g. division by zero) — try another; anything else
      // (bad formula) won't improve with retries.
      if (CalculationQuestion.isRetryableCalculationDrawError(e)) continue;
      break;
    }
  }
  return sets;
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
};
