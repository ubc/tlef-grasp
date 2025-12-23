const express = require("express");
const router = express.Router();
const { saveQuestion, updateQuestion, deleteQuestion, getQuestions } = require('../services/question');
const { isUserInCourse } = require('../services/user-course');
const { getQuestionCourseId, getQuestion } = require('../services/question');

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

    if (!status) {
      return res.status(400).json({ error: "Status is required" });
    }

    const question = await getQuestion(questionId);

    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    await updateQuestion(
      {
        ...question,
        status: status,
      }
    );

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
  let qti = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/ims_qtiasiv1p2 http://www.imsglobal.org/xsd/ims_qtiasiv1p2p1.xsd">
  <assessment ident="GRASP_QUESTIONS" title="${course} Questions">
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
    
    qti += `
    <section ident="section_${index + 1}">
      <item ident="item_${q.id}">
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
            <mattext texttype="text/html">${q.text || q.title || q.stem || ''}</mattext>
          </material>
          <response_lid ident="response_${q.id}">
            <render_choice>
              <response_label ident="A">
                <material>
                  <mattext texttype="text/html">${optA}</mattext>
                </material>
              </response_label>
              <response_label ident="B">
                <material>
                  <mattext texttype="text/html">${optB}</mattext>
                </material>
              </response_label>
              <response_label ident="C">
                <material>
                  <mattext texttype="text/html">${optC}</mattext>
                </material>
              </response_label>
              <response_label ident="D">
                <material>
                  <mattext texttype="text/html">${optD}</mattext>
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
              <varequal respident="response_${q.id}">${correctAnswerLetter}</varequal>
            </conditionvar>
            <setvar action="Set" varname="SCORE">100</setvar>
          </respcondition>
        </resprocessing>
      </item>
    </section>`;
  });

  qti += `
  </assessment>
</questestinterop>`;

  return qti;
}

module.exports = router;
