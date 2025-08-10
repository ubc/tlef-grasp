const express = require("express");
const router = express.Router();

// Mock question generation function (replace with actual AI integration)
async function generateQuestions(content, options = {}) {
  const {
    numQuestions = 10,
    questionTypes = ["multiple-choice", "short-answer"],
    difficulty = "medium",
    course = "General",
  } = options;

  // Simulate AI processing time
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const questions = [];
  const questionTypes = [
    "multiple-choice",
    "short-answer",
    "true-false",
    "fill-in-blank",
  ];

  for (let i = 0; i < numQuestions; i++) {
    const questionType =
      questionTypes[Math.floor(Math.random() * questionTypes.length)];

    let question = {
      id: `q_${Date.now()}_${i}`,
      type: questionType,
      difficulty: difficulty,
      course: course,
      content: `Generated question ${i + 1} based on the provided content.`,
      timestamp: new Date().toISOString(),
      status: "generated",
    };

    // Add type-specific properties
    switch (questionType) {
      case "multiple-choice":
        question.options = ["Option A", "Option B", "Option C", "Option D"];
        question.correctAnswer = Math.floor(Math.random() * 4);
        question.explanation = "This is the correct answer because...";
        break;

      case "short-answer":
        question.expectedLength = "2-3 sentences";
        question.sampleAnswer = "A sample answer would be...";
        break;

      case "true-false":
        question.correctAnswer = Math.random() > 0.5;
        question.explanation = "This statement is true/false because...";
        break;

      case "fill-in-blank":
        question.blanks = ["blank1", "blank2"];
        question.correctAnswers = ["answer1", "answer2"];
        question.explanation = "The correct answers are...";
        break;
    }

    questions.push(question);
  }

  return questions;
}

// Generate questions from uploaded content
router.post("/generate", express.json(), async (req, res) => {
  try {
    const { content, contentType, course, title, options = {} } = req.body;

    if (
      !content &&
      !req.session?.uploadedFiles &&
      !req.session?.textContent &&
      !req.session?.urlContent
    ) {
      return res
        .status(400)
        .json({ error: "No content provided for question generation" });
    }

    // Determine content to process
    let processedContent = content;
    if (!processedContent) {
      if (req.session?.uploadedFiles) {
        processedContent = `Files: ${req.session.uploadedFiles
          .map((f) => f.originalName)
          .join(", ")}`;
      } else if (req.session?.textContent) {
        processedContent = req.session.textContent.content;
      } else if (req.session?.urlContent) {
        processedContent = `URL: ${req.session.urlContent.url}`;
      }
    }

    // Generate questions
    const questions = await generateQuestions(processedContent, {
      ...options,
      course: course || "General",
    });

    // Store generated questions in session
    if (req.session) {
      req.session.generatedQuestions = questions;
    }

    res.json({
      success: true,
      message: `${questions.length} questions generated successfully`,
      questions: questions,
      metadata: {
        contentType,
        course,
        title,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Question generation error:", error);
    res.status(500).json({ error: "Question generation failed" });
  }
});

// Get generated questions
router.get("/generated", (req, res) => {
  try {
    const questions = req.session?.generatedQuestions || [];
    res.json({ questions });
  } catch (error) {
    console.error("Error getting generated questions:", error);
    res.status(500).json({ error: "Failed to retrieve questions" });
  }
});

// Save questions to question bank
router.post("/save", express.json(), async (req, res) => {
  try {
    const { questions, course, title, description } = req.body;

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: "No questions provided to save" });
    }

    // Here you would typically save to a database
    // For now, we'll just store in session
    const questionSet = {
      id: `qs_${Date.now()}`,
      title: title || "Untitled Question Set",
      description: description || "",
      course: course || "General",
      questions: questions,
      createdAt: new Date().toISOString(),
      status: "saved",
    };

    if (req.session) {
      if (!req.session.questionBank) {
        req.session.questionBank = [];
      }
      req.session.questionBank.push(questionSet);
    }

    res.json({
      success: true,
      message: "Questions saved successfully",
      questionSet: questionSet,
    });
  } catch (error) {
    console.error("Error saving questions:", error);
    res.status(500).json({ error: "Failed to save questions" });
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

// Delete question set
router.delete("/:setId", async (req, res) => {
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

module.exports = router;
