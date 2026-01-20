const express = require("express");
const router = express.Router();
const archiver = require('archiver');
const { saveQuestion, updateQuestion, deleteQuestion, getQuestions } = require('../services/question');
const { isUserInCourse } = require('../services/user-course');
const { getQuestionCourseId, getQuestion } = require('../services/question');
const { isFaculty } = require('../utils/auth');
const quizService = require('../services/quiz');
const { ObjectId } = require('mongodb');

// Get questions for a course
router.get("/", async (req, res) => {
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
});

// Get a single question by ID
router.get("/:questionId", async (req, res) => {
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
});

// Save questions to question bank
router.post("/save", express.json(), async (req, res) => {
  try {
    const { question, courseId } = req.body;

    if (!isUserInCourse(req.user.id, courseId)) {
      return res.status(403).json({ error: "User is not in course" });
    }

    if (!question) {
      return res.status(400).json({ error: "No question provided to save" });
    }

    await saveQuestion(courseId, question);

    res.json({
      success: true,
      message: "Question saved successfully",
      question: question,
    });
  } catch (error) {
    console.error("Error saving question:", error);
    res.status(500).json({ error: "Failed to save question" });
  }
});

// Update question
router.put("/:questionId", express.json(), async (req, res) => {
  try {
    const { questionId } = req.params;
    const updateData = req.body;

    const courseId = await getQuestionCourseId(questionId);

    if (!isUserInCourse(req.user.id, courseId)) {
      return res.status(403).json({ error: "User is not in course" });
    }

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
});

// Update question status
router.put("/:questionId/status", express.json(), async (req, res) => {
  try {
    const { questionId } = req.params;
    const { status } = req.body;

    const courseId = await getQuestionCourseId(questionId);

    if (!isUserInCourse(req.user.id, courseId)) {
      return res.status(403).json({ error: "User is not in course" });
    }

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
});

// Delete question
router.delete("/:questionId", async (req, res) => {
  try {
    const { questionId } = req.params;

    const courseId = await getQuestionCourseId(questionId);

    if (!isUserInCourse(req.user.id, courseId)) {
      return res.status(403).json({ error: "User is not in course" });
    }

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
});

// Export questions in various formats
router.post("/export", express.json(), async (req, res) => {
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
      default:
        // Canvas requires QTI in ZIP format
        return createQTIZipExport(res, course, questions, quizName, quizDescription);
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(exportData);

  } catch (error) {
    console.error("Export error:", error);
    res.status(500).json({ error: "Export failed" });
  }
});

function createCSVExport(course, questions) {
  let csv = 'Question,Option A,Option B,Option C,Option D,Correct Answer,Bloom Level,Difficulty\n';
  questions.forEach(q => {
    // Options are always objects with keys A, B, C, D
    const getOption = (key) => {
      if (!q.options || typeof q.options !== 'object') return '';
      const opt = q.options[key];
      return typeof opt === 'string' ? opt : (opt?.text || opt || '');
    };
    
    const optA = getOption('A');
    const optB = getOption('B');
    const optC = getOption('C');
    const optD = getOption('D');
    
    // Handle correctAnswer as letter (A, B, C, D) or number (0, 1, 2, 3)
    let correctAnswerLetter = q.correctAnswer;
    if (typeof q.correctAnswer === 'number') {
      correctAnswerLetter = ['A', 'B', 'C', 'D'][q.correctAnswer] || 'A';
    }
    if (typeof correctAnswerLetter === 'string') {
      correctAnswerLetter = correctAnswerLetter.toUpperCase();
    }
    const correctOpt = getOption(correctAnswerLetter);
    
    csv += `"${q.text || q.title || q.stem || ''}","${optA}","${optB}","${optC}","${optD}","${correctOpt}","${q.bloomLevel || q.bloom || ''}","${q.difficulty || ''}"\n`;
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
  const escapeXml = (text) => {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };
  
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
  const escapeXml = (text) => {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };
  
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

function createQTIExport(course, questions, assessmentId) {
  // Helper function to escape XML content (for attributes and plain text)
  const escapeXml = (text) => {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

  // Helper function to escape HTML content for Canvas QTI
  // Canvas expects HTML to be escaped, and wraps plain text in div/p tags
  const escapeHtmlForQTI = (text) => {
    if (!text) return '';
    const textStr = String(text).trim();
    
    // If content already contains HTML tags, just escape it
    if (/<[^>]+>/.test(textStr)) {
      return escapeXml(textStr);
    }
    
    // For plain text, wrap in div/p tags like Canvas does
    return escapeXml(`<div><p>${textStr}</p></div>`);
  };

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
    // Options are always objects with keys A, B, C, D
    const getOption = (key) => {
      if (!q.options || typeof q.options !== 'object') return '';
      const opt = q.options[key];
      return typeof opt === 'string' ? opt : (opt?.text || opt || '');
    };
    
    let optA = getOption('A') || 'Option A';
    let optB = getOption('B') || 'Option B';
    let optC = getOption('C') || 'Option C';
    let optD = getOption('D') || 'Option D';
    
    // Ensure all options have content (Canvas requires non-empty options)
    if (!optA.trim()) optA = 'Option A';
    if (!optB.trim()) optB = 'Option B';
    if (!optC.trim()) optC = 'Option C';
    if (!optD.trim()) optD = 'Option D';
    
    // Generate numeric IDs for response labels (Canvas uses numeric strings, not Canvas IDs)
    // Canvas uses numeric IDs (can be 4+ digits) for answer choices
    // Generate unique IDs for each answer to avoid conflicts
    const generateNumericId = () => {
      return String(Math.floor(Math.random() * 9000) + 1000);
    };
    const answerIdA = generateNumericId();
    const answerIdB = generateNumericId();
    const answerIdC = generateNumericId();
    const answerIdD = generateNumericId();
    const answerIds = [answerIdA, answerIdB, answerIdC, answerIdD];
    
    // Handle correctAnswer as letter (A, B, C, D) or number (0, 1, 2, 3)
    let correctAnswerIndex = 0;
    if (typeof q.correctAnswer === 'number') {
      correctAnswerIndex = q.correctAnswer >= 0 && q.correctAnswer < 4 ? q.correctAnswer : 0;
    } else if (typeof q.correctAnswer === 'string') {
      const upper = q.correctAnswer.toUpperCase();
      correctAnswerIndex = ['A', 'B', 'C', 'D'].indexOf(upper);
      if (correctAnswerIndex === -1) correctAnswerIndex = 0;
    }
    const correctAnswerId = answerIds[correctAnswerIndex];
    
    let questionText = q.text || q.title || q.stem || '';
    // Ensure question has text (Canvas requires non-empty question text)
    if (!questionText.trim()) {
      questionText = `Question ${index + 1}`;
    }
    
    // Generate Canvas-compatible IDs
    const questionId = generateCanvasId('g');
    const assessmentQuestionId = generateCanvasId('g');
    const responseId = `response${index + 1}`;
    
    qti += `
      <item ident="${questionId}" title="Question">
        <itemmetadata>
          <qtimetadata>
            <qtimetadatafield>
              <fieldlabel>question_type</fieldlabel>
              <fieldentry>multiple_choice_question</fieldentry>
            </qtimetadatafield>
            <qtimetadatafield>
              <fieldlabel>points_possible</fieldlabel>
              <fieldentry>1.0</fieldentry>
            </qtimetadatafield>
            <qtimetadatafield>
              <fieldlabel>original_answer_ids</fieldlabel>
              <fieldentry>${answerIds.join(',')}</fieldentry>
            </qtimetadatafield>
            <qtimetadatafield>
              <fieldlabel>assessment_question_identifierref</fieldlabel>
              <fieldentry>${assessmentQuestionId}</fieldentry>
            </qtimetadatafield>
          </qtimetadata>
        </itemmetadata>
        <presentation>
          <material>
            <mattext texttype="text/html">${escapeHtmlForQTI(questionText)}</mattext>
          </material>
          <response_lid ident="${responseId}" rcardinality="Single">
            <render_choice>
              <response_label ident="${answerIdA}">
                <material>
                  <mattext texttype="text/plain">${escapeXml(optA)}</mattext>
                </material>
              </response_label>
              <response_label ident="${answerIdB}">
                <material>
                  <mattext texttype="text/plain">${escapeXml(optB)}</mattext>
                </material>
              </response_label>
              <response_label ident="${answerIdC}">
                <material>
                  <mattext texttype="text/plain">${escapeXml(optC)}</mattext>
                </material>
              </response_label>
              <response_label ident="${answerIdD}">
                <material>
                  <mattext texttype="text/plain">${escapeXml(optD)}</mattext>
                </material>
              </response_label>
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
  });

  qti += `
    </section>
  </assessment>
</questestinterop>`;

  return qti;
}

module.exports = router;
