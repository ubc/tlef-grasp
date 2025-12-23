const express = require("express");
const router = express.Router();
const { saveQuestion, updateQuestion, deleteQuestion, getQuestions } = require('../services/question');
const { isUserInCourse } = require('../services/user-course');
const { getQuestionCourseId, getQuestion } = require('../services/question');

// Helper function to check if user is faculty
const isFaculty = (user) => {
  if (!user || !user.affiliation) return false;
  // affiliation can be a string (comma-separated) or an array
  const affiliations = Array.isArray(user.affiliation) 
    ? user.affiliation 
    : String(user.affiliation).split(',').map(a => a.trim());
  return affiliations.includes('faculty');
};

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
    if (!isFaculty(req.user)) {
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

    // Check if question is approved - staff cannot delete approved questions
    const question = await getQuestion(questionId);
    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    if (!isFaculty(req.user) && question.status === "Approved") {
      return res.status(403).json({ 
        error: "Staff cannot delete approved questions" 
      });
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
    const { course, summary, objectives, questions } = req.body;
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
        exportData = createQTIExport(course, questions);
        contentType = 'application/xml';
        filename = `questions-${course}-${Date.now()}.xml`;
        break;
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

function createQTIExport(course, questions) {
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
  // Canvas supports HTML in mattext, but we need to escape XML special chars
  // while preserving HTML structure. Use CDATA for complex HTML content.
  const escapeHtmlForQTI = (text) => {
    if (!text) return '';
    const textStr = String(text);
    
    // If content contains HTML tags, use CDATA
    if (/<[^>]+>/.test(textStr)) {
      // Escape any existing CDATA sections
      const escaped = textStr.replace(/]]>/g, ']]&gt;');
      return `<![CDATA[${escaped}]]>`;
    }
    
    // For plain text, escape XML special characters
    return escapeXml(textStr);
  };

  // Helper function to create safe XML identifiers
  const safeIdent = (id) => {
    if (!id) return `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return String(id).replace(/[^a-zA-Z0-9_]/g, '_');
  };

  let qti = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/ims_qtiasiv1p2 http://www.imsglobal.org/xsd/ims_qtiasiv1p2p1.xsd">
  <assessment ident="${safeIdent(course)}_${Date.now()}" title="${escapeXml(course)} Questions">
    <qtimetadata>
      <qtimetadatafield>
        <fieldlabel>qmd_timelimit</fieldlabel>
        <fieldentry>PT30M</fieldentry>
      </qtimetadatafield>
    </qtimetadata>`;

  questions.forEach((q, index) => {
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
    
    const questionText = q.text || q.title || q.stem || '';
    const questionId = safeIdent(q.id || `q${index + 1}`);
    const responseId = `response_${questionId}`;
    
    qti += `
    <section ident="section_${index + 1}">
      <item ident="${questionId}">
        <itemmetadata>
          <qtimetadata>
            <qtimetadatafield>
              <fieldlabel>qmd_itemtype</fieldlabel>
              <fieldentry>Multiple Choice</fieldentry>
            </qtimetadatafield>
            <qtimetadatafield>
              <fieldlabel>qmd_status</fieldlabel>
              <fieldentry>Normal</fieldentry>
            </qtimetadatafield>
          </qtimetadata>
        </itemmetadata>
        <presentation>
          <material>
            <mattext texttype="text/html">${escapeHtmlForQTI(questionText)}</mattext>
          </material>
          <response_lid ident="${responseId}">
            <render_choice>
              <response_label ident="A">
                <material>
                  <mattext texttype="text/html">${escapeHtmlForQTI(optA)}</mattext>
                </material>
              </response_label>
              <response_label ident="B">
                <material>
                  <mattext texttype="text/html">${escapeHtmlForQTI(optB)}</mattext>
                </material>
              </response_label>
              <response_label ident="C">
                <material>
                  <mattext texttype="text/html">${escapeHtmlForQTI(optC)}</mattext>
                </material>
              </response_label>
              <response_label ident="D">
                <material>
                  <mattext texttype="text/html">${escapeHtmlForQTI(optD)}</mattext>
                </material>
              </response_label>
            </render_choice>
          </response_lid>
        </presentation>
        <resprocessing>
          <outcomes>
            <decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal" defaultval="0"/>
          </outcomes>
          <respcondition continue="No">
            <conditionvar>
              <varequal respident="${responseId}">${correctAnswerLetter}</varequal>
            </conditionvar>
            <setvar action="Set" varname="SCORE">100</setvar>
          </respcondition>
        </resprocessing>
        ${q.explanation ? `
        <itemfeedback ident="general_fb">
          <flow_mat>
            <material>
              <mattext texttype="text/html">${escapeHtmlForQTI(q.explanation)}</mattext>
            </material>
          </flow_mat>
        </itemfeedback>` : ''}
      </item>
    </section>`;
  });

  qti += `
  </assessment>
</questestinterop>`;

  return qti;
}

module.exports = router;
