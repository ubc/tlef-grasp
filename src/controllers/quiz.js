const quizService = require("../services/quiz");
const questionService = require("../services/question");
const calculationQuestion = require("../services/calculation-question");
const { isFaculty } = require("../utils/auth");

/**
 * Get all quizzes for a course
 */
const getQuizzesByCourseHandler = async (req, res) => {
  try {
    const { courseId } = req.params;
    const quizzes = await quizService.getQuizzesByCourse(courseId);
    res.json({ success: true, quizzes });
  } catch (error) {
    console.error("Error fetching quizzes:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get a quiz by ID
 */
const getQuizByIdHandler = async (req, res) => {
  try {
    const { quizId } = req.params;
    const quiz = await quizService.getQuizById(quizId);
    
    if (!quiz) {
      return res.status(404).json({ success: false, error: "Quiz not found" });
    }
    
    res.json({ success: true, quiz });
  } catch (error) {
    console.error("Error fetching quiz:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Create a new quiz
 */
const createQuizHandler = async (req, res) => {
  try {
    const { courseId, name, description, releaseDate, expireDate } = req.body;
    
    if (!courseId || !name) {
      return res.status(400).json({
        success: false,
        error: "Course ID and quiz name are required",
      });
    }
    
    const quiz = await quizService.createQuiz(courseId, { 
      name, 
      description,
      releaseDate,
      expireDate
    });
    res.status(201).json({ success: true, quiz });
  } catch (error) {
    console.error("Error creating quiz:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Update a quiz
 */
const updateQuizHandler = async (req, res) => {
  try {
    const { quizId } = req.params;
    const { name, description, published, releaseDate, expireDate } = req.body;
    
    // Get existing quiz to check current values
    const existingQuiz = await quizService.getQuizById(quizId);
    if (!existingQuiz) {
      return res.status(404).json({ success: false, error: "Quiz not found" });
    }

    // Validation for publishing: a quiz must have a release date
    const finalPublished = published !== undefined ? published : existingQuiz.published;
    
    if (finalPublished === true) {
      // Check final state of releaseDate
      const finalReleaseDate = releaseDate !== undefined ? releaseDate : existingQuiz.releaseDate;

      if (!finalReleaseDate) {
        return res.status(400).json({ 
          success: false, 
          error: "A published quiz must have a release date." 
        });
      }
    }

    const result = await quizService.updateQuiz(quizId, { 
      name, 
      description, 
      published,
      releaseDate,
      expireDate
    });
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: "Quiz not found" });
    }
    
    res.json({ success: true, result });
  } catch (error) {
    console.error("Error updating quiz:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Delete a quiz
 */
const deleteQuizHandler = async (req, res) => {
  try {
    // Only faculty can delete quizzes
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({ 
        success: false, 
        error: "Only faculty can delete quizzes" 
      });
    }
    
    const { quizId } = req.params;
    const result = await quizService.deleteQuiz(quizId);
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: "Quiz not found" });
    }
    
    res.json({ success: true, result });
  } catch (error) {
    console.error("Error deleting quiz:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Add questions to a quiz
 */
const addQuizQuestionsHandler = async (req, res) => {
  try {
    const { quizId } = req.params;
    const { questions } = req.body;
    
    if (!questions || !Array.isArray(questions)) {
      return res.status(400).json({
        success: false,
        error: "Questions array is required",
      });
    }
    
    // First, save all questions to the database and get their IDs
    const courseId = req.body.courseId;
    if (!courseId) {
      return res.status(400).json({
        success: false,
        error: "Course ID is required",
      });
    }
    
    const savedQuestionIds = [];
    
    for (const questionData of questions) {
      try {
        // Save the question
        const questionResult = await questionService.saveQuestion(courseId, questionData);
        savedQuestionIds.push(questionResult.insertedId.toString());
      } catch (error) {
        console.error("Error saving question:", error);
        // Continue with other questions even if one fails
      }
    }
    
    if (savedQuestionIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No questions were saved successfully",
      });
    }
    
    // Add questions to quiz
    const result = await quizService.addQuestionsToQuiz(quizId, savedQuestionIds);
    
    res.json({
      success: true,
      result,
      questionsAdded: savedQuestionIds.length,
    });
  } catch (error) {
    console.error("Error adding questions to quiz:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function resolveQuestionType(q) {
  const t = String(q.questionType || q.type || "")
    .trim()
    .toLowerCase();
  if (t === "fill-in-the-blank") {
    return "fill-in-the-blank";
  }
  if (t === "calculation") {
    return "calculation";
  }
  if (t === "open-ended") {
    return "open-ended";
  }
  return "multiple-choice";
}

// Helper function to generate a shuffled order of option indices
function shuffleQuestionOptions(question) {
  const optionIndices = [0, 1, 2, 3];
  const shuffledIndices = shuffleArray(optionIndices);

  return {
    ...question,
    optionOrder: shuffledIndices
    // We intentionally leave correctAnswer and options alone here
    // as they will be cleansed before sending to the client.
  };
}

/**
 * Get all questions in a quiz
 */
const getQuizQuestionsHandler = async (req, res) => {
  try {
    const { quizId } = req.params;
    const { approvedOnly } = req.query;
    const approvedOnlyBool = approvedOnly === 'true' || approvedOnly === true;
    
    let questions;
    
    if (approvedOnlyBool) {
        // Students quiz view: use personalized selection logic
        const userId = req.user ? (req.user._id || req.user.id) : null;
        questions = await quizService.getQuizQuestionsForStudent(quizId, userId);
    } else {
        // Bank full questions view: return all questions for instructors
        questions = await quizService.getQuizQuestions(quizId, false);
    }
    
    const transformedQuestions = questions.map((q, index) => {
      const questionType = resolveQuestionType(q);
      const questionText = (q.title || q.stem || "").trim();

      if (questionType === "fill-in-the-blank") {
        const fibMainText = (q.stem || q.title || "").trim();
        const formattedQuestion = {
          ...q,
          id: q._id ? (q._id.toString ? q._id.toString() : String(q._id)) : String(q.id || index + 1),
          question: fibMainText || questionText || "Question text not available",
          questionType: "fill-in-the-blank",
          options: {},
        };
        let finalQuestion = formattedQuestion;
        if (approvedOnlyBool) {
          delete finalQuestion.correctAnswer;
          delete finalQuestion.acceptableAnswers;
          // Avoid duplicating the same stem under `question` and `stem` in the student UI
          delete finalQuestion.stem;
        }
        return finalQuestion;
      }

      if (questionType === "open-ended") {
        const fibMainText = (q.stem || q.title || "").trim();
        const qid = q._id ? (q._id.toString ? q._id.toString() : String(q._id)) : String(q.id || index + 1);
        const formattedQuestion = {
          ...q,
          id: qid,
          question: fibMainText || questionText || "Question text not available",
          questionType: "open-ended",
          options: {},
          learningObjectiveId: q.learningObjectiveId,
          granularObjectiveId: q.granularObjectiveId,
          bloom: q.bloom,
        };
        if (approvedOnlyBool) {
          delete formattedQuestion.openEndedSampleAnswer;
          delete formattedQuestion.openEndedGradingCriteria;
          delete formattedQuestion.stem;
        }
        return formattedQuestion;
      }

      if (questionType === "calculation") {
        const vars = q.calculationVariables;
        const template = calculationQuestion.resolveCalculationDisplayTemplate(
          q.stem,
          q.title,
          vars
        );
        const formula = (q.calculationFormula || "").trim();
        const answerDec =
          q.calculationAnswerDecimals !== undefined && q.calculationAnswerDecimals !== null
            ? Math.max(0, Math.min(12, parseInt(q.calculationAnswerDecimals, 10) || 2))
            : 2;
        const qid = q._id ? (q._id.toString ? q._id.toString() : String(q._id)) : String(q.id || index + 1);

        if (approvedOnlyBool) {
          const built = calculationQuestion.buildStudentCalculationInstance({
            template,
            formula,
            variableSpecs: vars,
            qid,
            answerDec,
          });
          if (built.ok) {
            return {
              id: qid,
              question: built.rendered,
              questionType: "calculation",
              calculationToken: built.token,
              answerDecimalPlaces: built.answerDecimalPlaces,
              options: {},
              learningObjectiveId: q.learningObjectiveId,
              granularObjectiveId: q.granularObjectiveId,
              bloom: q.bloom,
            };
          }
          console.error(
            "Calculation question instance failed:",
            qid,
            built.error && built.error.message
          );
          return {
            id: qid,
            question:
              template ||
              "This calculation question could not be loaded. Please contact your instructor.",
            questionType: "calculation",
            calculationToken: null,
            answerDecimalPlaces: answerDec,
            calculationLoadError: true,
            options: {},
            learningObjectiveId: q.learningObjectiveId,
            granularObjectiveId: q.granularObjectiveId,
            bloom: q.bloom,
          };
        }

        return {
          ...q,
          id: qid,
          question: template || "Question text not available",
          questionType: "calculation",
          options: {},
          calculationFormula: formula,
          calculationVariables: vars,
          calculationAnswerDecimals: answerDec,
        };
      }

      let optionsObj = {};
      if (q.options && typeof q.options === 'object') {
        if (!Array.isArray(q.options)) {
          optionsObj = {
            A: { ...(q.options.A || { text: "" }), index: 0 },
            B: { ...(q.options.B || { text: "" }), index: 1 },
            C: { ...(q.options.C || { text: "" }), index: 2 },
            D: { ...(q.options.D || { text: "" }), index: 3 }
          };
        } else {
          optionsObj = {
            A: { ...(q.options[0] || { text: "" }), index: 0 },
            B: { ...(q.options[1] || { text: "" }), index: 1 },
            C: { ...(q.options[2] || { text: "" }), index: 2 },
            D: { ...(q.options[3] || { text: "" }), index: 3 }
          };
        }
      }
      if (approvedOnlyBool) {
        ['A', 'B', 'C', 'D'].forEach(key => {
          if (optionsObj[key] && typeof optionsObj[key] === 'object') {
            delete optionsObj[key].feedback;
          }
        });
      }

      const formattedQuestion = {
        ...q,
        id: q._id ? (q._id.toString ? q._id.toString() : String(q._id)) : String(q.id || index + 1),
        question: questionText || "Question text not available",
        questionType: "multiple-choice",
        options: optionsObj,
        correctAnswer: (q.correctAnswer || "A").toString().toUpperCase()
      };

      let finalQuestion = approvedOnlyBool ? shuffleQuestionOptions(formattedQuestion) : formattedQuestion;

      if (approvedOnlyBool) {
        delete finalQuestion.correctAnswer;
      }

      return finalQuestion;
    });

    res.json({ success: true, questions: transformedQuestions });
  } catch (error) {
    console.error("Error fetching quiz questions:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Record student performance for a quiz question
 */
const recordPerformanceHandler = async (req, res) => {
    try {
        const { quizId } = req.params;
        const { questionId, learningObjectiveId, granularObjectiveId, bloom, isCorrect } = req.body;
        
        if (!questionId || !bloom || isCorrect === undefined) {
            return res.status(400).json({
                success: false,
                error: "questionId, bloom, and isCorrect are required",
            });
        }
        
        const result = await quizService.saveStudentPerformance({
            userId: req.user._id,
            quizId,
            questionId,
            learningObjectiveId,
            granularObjectiveId,
            bloom,
            isCorrect
        });
        
        res.json({ success: true, result });
    } catch (error) {
        console.error("Error recording student performance:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Check if a selected answer is correct and return the feedback securely
 */
const checkQuestionAnswerHandler = async (req, res) => {
  try {
    const { questionId } = req.params;
    const { selectedIndex, answerText } = req.body;

    const { getQuestion } = require('../services/question');
    const question = await getQuestion(questionId);
    
    if (!question) {
      return res.status(404).json({ success: false, error: "Question not found" });
    }

    const questionType = resolveQuestionType(question);
    const calculationToken =
      req.body.calculationToken && typeof req.body.calculationToken === "string"
        ? req.body.calculationToken
        : null;
    const hasCalculationFormula =
      typeof question.calculationFormula === "string" &&
      question.calculationFormula.trim().length > 0;

    const treatAsCalculation =
      questionType === "calculation" ||
      (calculationToken && hasCalculationFormula);

    if (treatAsCalculation) {
      const { answerText } = req.body;
      if (!calculationToken) {
        return res.status(400).json({
          success: false,
          error: "calculationToken is required for calculation questions",
        });
      }
      if (answerText === undefined || answerText === null || String(answerText).trim() === "") {
        return res.status(400).json({
          success: false,
          error: "answerText is required for calculation questions",
        });
      }
      const verified = calculationQuestion.verifyCalculationToken(calculationToken);
      if (!verified || String(verified.questionId) !== String(questionId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid or expired calculation token — try reloading the quiz",
        });
      }
      const formula = (question.calculationFormula || "").trim();
      const vars = question.calculationVariables;
      const answerDec =
        question.calculationAnswerDecimals !== undefined &&
        question.calculationAnswerDecimals !== null
          ? Math.max(0, Math.min(12, parseInt(question.calculationAnswerDecimals, 10) || 2))
          : 2;
      let expected;
      try {
        expected = calculationQuestion.evaluateCalculationFormula(formula, verified.values);
      } catch (e) {
        console.error("Calculation check evaluate failed:", e);
        const msg = e && e.message ? String(e.message) : "";
        const clientError =
          msg.startsWith("Formula ") ||
          msg.startsWith("Invalid formula") ||
          msg.includes("plain ASCII") ||
          msg.includes("unsupported characters") ||
          msg.includes("Reload the quiz") ||
          msg.includes("calculationVariables") ||
          msg.includes("this attempt's values");
        return res.status(clientError ? 400 : 500).json({
          success: false,
          error: clientError ? msg : "Could not grade this calculation question",
        });
      }
      const studentNum = calculationQuestion.parseStudentNumericAnswer(answerText);
      const isCorrect = calculationQuestion.numericAnswersMatch(studentNum, expected, answerDec);
      const displayCorrect = calculationQuestion.formatAnswerForDisplay(expected, answerDec);
      res.json({
        success: true,
        isCorrect,
        feedback: isCorrect ? "Correct." : "",
        correctAnswer: isCorrect ? displayCorrect : null,
        correctOptionText: displayCorrect,
      });
      return;
    }

    if (questionType === "open-ended") {
      if (answerText === undefined || answerText === null || String(answerText).trim() === "") {
        return res.status(400).json({
          success: false,
          error: "answerText is required for open-ended questions",
        });
      }
      const sample = String(question.openEndedSampleAnswer || "").trim();
      const criteria = String(question.openEndedGradingCriteria || "").trim();
      if (!sample) {
        return res.status(500).json({
          success: false,
          error: "This open-ended question is missing a sample answer. Ask your instructor to fix it in the question bank.",
        });
      }
      res.json({
        success: true,
        isCorrect: null,
        autoGraded: false,
        feedback: "",
        openEnded: true,
        sampleAnswer: sample,
        gradingCriteria: criteria || null,
        correctAnswer: null,
        correctOptionText: null,
      });
      return;
    }

    if (questionType === "fill-in-the-blank") {
      if (answerText === undefined || answerText === null) {
        return res.status(400).json({
          success: false,
          error: "answerText is required for fill-in-the-blank questions",
        });
      }
      // Always grade against canonical correctAnswer plus any acceptableAnswers.
      // Previously, a non-empty acceptableAnswers array replaced correctAnswer entirely,
      // so typing the canonical answer could incorrectly mark wrong.
      const normalizeFib = (s) =>
        String(s)
          .normalize("NFKC")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");
      const given = normalizeFib(answerText);
      const trimmedCanonical =
        question.correctAnswer != null ? String(question.correctAnswer).trim() : "";
      const variants = new Set();
      if (trimmedCanonical) variants.add(trimmedCanonical);
      if (Array.isArray(question.acceptableAnswers)) {
        for (const a of question.acceptableAnswers) {
          if (a == null) continue;
          const t = String(a).trim();
          if (t) variants.add(t);
        }
      }
      const normalizedAcceptable = [...variants].map((a) => normalizeFib(a)).filter(Boolean);
      const isCorrect = normalizedAcceptable.length > 0 && normalizedAcceptable.some((a) => a === given);
      const canonical = trimmedCanonical;
      res.json({
        success: true,
        isCorrect,
        feedback: isCorrect ? "Correct." : "",
        correctAnswer: isCorrect ? canonical : null,
        // Reveal canonical text when wrong so the client can show "The correct answer is …"
        correctOptionText: canonical || null,
      });
      return;
    }

    if (selectedIndex === undefined || selectedIndex === null) {
      return res.status(400).json({ success: false, error: "selectedIndex is required" });
    }

    const optionKeys = ['A', 'B', 'C', 'D'];
    const selectedKey = optionKeys[selectedIndex];

    if (!selectedKey) {
        return res.status(400).json({ success: false, error: "Invalid selectedIndex provided" });
    }

    let correctAnswerLetter = question.correctAnswer || 'A';
    if (typeof correctAnswerLetter === 'number') {
      correctAnswerLetter = optionKeys[correctAnswerLetter] || 'A';
    } else if (typeof correctAnswerLetter === 'string') {
      correctAnswerLetter = correctAnswerLetter.toUpperCase();
    }
    
    const isCorrect = selectedKey === correctAnswerLetter;

    const selectedOptionObj = question.options[selectedKey];
    const feedback = typeof selectedOptionObj === 'object' && selectedOptionObj !== null 
      ? (selectedOptionObj.feedback || "")
      : "";

    const correctOptionObj = question.options[correctAnswerLetter];
    const correctOptionText = typeof correctOptionObj === 'object' && correctOptionObj !== null 
      ? (correctOptionObj.text || "")
      : (correctOptionObj || "");

    res.json({
      success: true,
      isCorrect,
      feedback,
      correctAnswer: isCorrect ? correctAnswerLetter : null,
      correctOptionText: isCorrect ? correctOptionText : null
    });
  } catch (error) {
    console.error("Error checking question answer:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getQuizzesByCourseHandler,
  getQuizByIdHandler,
  createQuizHandler,
  updateQuizHandler,
  deleteQuizHandler,
  addQuizQuestionsHandler,
  getQuizQuestionsHandler,
  recordPerformanceHandler,
  checkQuestionAnswerHandler
};
