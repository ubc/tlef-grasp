const express = require("express");
const router = express.Router();
const { saveQuestion, updateQuestion, deleteQuestion } = require('../services/question');

// Save questions to question bank
router.post("/save", express.json(), async (req, res) => {
  try {
    const { question, course } = req.body;

    if (!question) {
      return res.status(400).json({ error: "No question provided to save" });
    }

    await saveQuestion(course, question);

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

// Get question bank
router.get("/bank", (req, res) => {
  try {
    const questionBank = req.session?.questionBank || [];
    res.json({ questionBank });
  } catch (error) {
    console.error("Error getting question bank:", error);
    res.status(500).json({ error: "Failed to retrieve question bank" });
  }
});

// Update question
router.put("/:questionId", express.json(), async (req, res) => {
  try {
    const { questionId } = req.params;
    const updateData = req.body;

    if (!updateData) {
      return res.status(400).json({ error: "No update data provided" });
    }

    const result = await updateQuestion(questionId, updateData);

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Question not found" });
    }

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

    if (!status) {
      return res.status(400).json({ error: "Status is required" });
    }

    // Find and update the question
    let questionUpdated = false;
    if (req.session?.generatedQuestions) {
      const question = req.session.generatedQuestions.find(
        (q) => q.id === questionId
      );
      if (question) {
        question.status = status;
        questionUpdated = true;
      }
    }

    if (req.session?.questionBank) {
      for (const set of req.session.questionBank) {
        const question = set.questions.find((q) => q.id === questionId);
        if (question) {
          question.status = status;
          questionUpdated = true;
          break;
        }
      }
    }

    if (!questionUpdated) {
      return res.status(404).json({ error: "Question not found" });
    }

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

    const result = await deleteQuestion(questionId);

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Question not found" });
    }

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

// Delete question set
router.delete("/set/:setId", async (req, res) => {
  try {
    const { setId } = req.params;

    if (req.session?.questionBank) {
      const initialLength = req.session.questionBank.length;
      req.session.questionBank = req.session.questionBank.filter(
        (set) => set.id !== setId
      );

      if (req.session.questionBank.length < initialLength) {
        return res.json({
          success: true,
          message: "Question set deleted successfully",
        });
      }
    }

    res.status(404).json({ error: "Question set not found" });
  } catch (error) {
    console.error("Error deleting question set:", error);
    res.status(500).json({ error: "Failed to delete question set" });
  }
});

// Summarize content
router.post("/summarize", express.json(), async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "No content provided for summarization" });
    }

    // Simulate AI processing time
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Mock summary generation
    const summary = `This is a comprehensive summary of the provided content. The material covers fundamental concepts that would be suitable for creating educational questions. Key topics include theoretical foundations, practical applications, and critical analysis points.`;

    res.json({
      success: true,
      summary: summary,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Summarization error:", error);
    res.status(500).json({ error: "Summarization failed" });
  }
});

// Generate questions from summary and objectives
router.post("/generate-questions", express.json(), async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "No content provided for question generation" });
    }

    // Simulate AI processing time
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Mock question generation
    const questions = [
      {
        id: 1,
        text: "What is the primary function of a catalyst in a chemical reaction?",
        type: "multiple-choice",
        options: [
          "To increase the activation energy",
          "To decrease the activation energy",
          "To change the equilibrium constant",
          "To increase the temperature"
        ],
        correctAnswer: 1,
        bloomLevel: "Understand",
        difficulty: "Medium"
      },
      {
        id: 2,
        text: "Which of the following best describes an exothermic reaction?",
        type: "multiple-choice",
        options: [
          "A reaction that absorbs heat from the surroundings",
          "A reaction that releases heat to the surroundings",
          "A reaction that requires continuous heating",
          "A reaction that occurs only at high temperatures"
        ],
        correctAnswer: 1,
        bloomLevel: "Remember",
        difficulty: "Easy"
      },
      {
        id: 3,
        text: "How does temperature affect the rate of a chemical reaction?",
        type: "multiple-choice",
        options: [
          "Higher temperature always decreases reaction rate",
          "Higher temperature increases reaction rate by providing more energy",
          "Temperature has no effect on reaction rate",
          "Lower temperature always increases reaction rate"
        ],
        correctAnswer: 1,
        bloomLevel: "Apply",
        difficulty: "Medium"
      }
    ];

    res.json({
      success: true,
      questions: questions,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Question generation error:", error);
    res.status(500).json({ error: "Question generation failed" });
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
    csv += `"${q.text}","${q.options[0]}","${q.options[1]}","${q.options[2]}","${q.options[3]}","${q.options[q.correctAnswer]}","${q.bloomLevel}","${q.difficulty}"\n`;
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
            <mattext texttype="text/html">${q.text}</mattext>
          </material>
          <response_lid ident="response_${q.id}">
            <render_choice>
              <response_label ident="A">
                <material>
                  <mattext texttype="text/html">${q.options[0]}</mattext>
                </material>
              </response_label>
              <response_label ident="B">
                <material>
                  <mattext texttype="text/html">${q.options[1]}</mattext>
                </material>
              </response_label>
              <response_label ident="C">
                <material>
                  <mattext texttype="text/html">${q.options[2]}</mattext>
                </material>
              </response_label>
              <response_label ident="D">
                <material>
                  <mattext texttype="text/html">${q.options[3]}</mattext>
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
              <varequal respident="response_${q.id}">${String.fromCharCode(65 + q.correctAnswer)}</varequal>
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
