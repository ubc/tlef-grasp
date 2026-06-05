const quizService = require("../services/quiz");
const questionService = require("../services/question");
const CalculationQuestion = require('../models/questions/CalculationQuestion');
const { isFaculty } = require("../utils/auth");
const { QUESTION_TYPES } = require("../constants/app-constants");

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
    const { courseId, name, description, releaseDate, expireDate, deliveryFormat, questionIds, newQuestions } = req.body;

    if (!courseId || !name || !releaseDate || !expireDate || !deliveryFormat) {
      return res.status(400).json({
        success: false,
        error: "Course ID, name, releaseDate, expireDate, and deliveryFormat are required",
      });
    }

    if (deliveryFormat !== "all-approved" && deliveryFormat !== "spaced-3phase") {
      return res.status(400).json({
        success: false,
        error: "Invalid deliveryFormat. Must be 'all-approved' or 'spaced-3phase'.",
      });
    }

    const quiz = await quizService.createQuiz(courseId, {
      name,
      description,
      releaseDate,
      expireDate,
      deliveryFormat
    });
    
    const quizId = quiz._id.toString();
    const finalQuestionIds = [];

    // Attach existing questions
    if (questionIds && Array.isArray(questionIds)) {
      finalQuestionIds.push(...questionIds);
    }

    // Create and attach new questions
    if (newQuestions && Array.isArray(newQuestions)) {
      for (const questionData of newQuestions) {
        try {
          const questionResult = await questionService.saveQuestion(courseId, questionData);
          finalQuestionIds.push(questionResult.insertedId.toString());
        } catch (error) {
          console.error("Error saving new question during quiz creation:", error);
        }
      }
    }

    if (finalQuestionIds.length > 0) {
      await quizService.addQuestionsToQuiz(quizId, finalQuestionIds);
    }

    res.status(201).json({ success: true, quiz, questionsAdded: finalQuestionIds.length });
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
    const { name, description, published, releaseDate, expireDate, deliveryFormat } = req.body;

    if (deliveryFormat !== undefined && deliveryFormat !== "all-approved" && deliveryFormat !== "spaced-3phase") {
      return res.status(400).json({
        success: false,
        error: "Invalid deliveryFormat. Must be 'all-approved' or 'spaced-3phase'."
      });
    }
    
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
      expireDate,
      deliveryFormat
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


function resolveQuestionType(q) {
  const t = String(q.questionType || q.type || "")
    .trim()
    .toLowerCase();
  if (t === QUESTION_TYPES.FILL_IN_THE_BLANK) {
    return QUESTION_TYPES.FILL_IN_THE_BLANK;
  }
  if (t === QUESTION_TYPES.CALCULATION) {
    return QUESTION_TYPES.CALCULATION;
  }
  if (t === QUESTION_TYPES.OPEN_ENDED) {
    return QUESTION_TYPES.OPEN_ENDED;
  }
  return QUESTION_TYPES.MULTIPLE_CHOICE;
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

      if (questionType === QUESTION_TYPES.FILL_IN_THE_BLANK) {
        const fibMainText = (q.stem || q.title || "").trim();
        const formattedQuestion = {
          ...q,
          id: q._id ? (q._id.toString ? q._id.toString() : String(q._id)) : String(q.id || index + 1),
          question: fibMainText || questionText || "Question text not available",
          questionType: QUESTION_TYPES.FILL_IN_THE_BLANK,
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

      if (questionType === QUESTION_TYPES.OPEN_ENDED) {
        const fibMainText = (q.stem || q.title || "").trim();
        const qid = q._id ? (q._id.toString ? q._id.toString() : String(q._id)) : String(q.id || index + 1);
        const formattedQuestion = {
          ...q,
          id: qid,
          question: fibMainText || questionText || "Question text not available",
          questionType: QUESTION_TYPES.OPEN_ENDED,
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

      if (questionType === QUESTION_TYPES.CALCULATION) {
        const vars = q.calculationVariables;
        const template = CalculationQuestion.resolveCalculationDisplayTemplate(
          q.stem,
          q.title,
          vars
        );
        const formula = (q.calculationFormula || "").trim();
        const answerDec =
          q.calculationAnswerDecimals !== undefined && q.calculationAnswerDecimals !== null
            ? Math.max(0, Math.min(12, parseInt(q.calculationAnswerDecimals, 10) || 2))
            : 2;
        const tolerancePercent =
          q.calculationAnswerTolerancePercent != null &&
          Number.isFinite(Number(q.calculationAnswerTolerancePercent))
            ? Number(q.calculationAnswerTolerancePercent)
            : null;
        const qid = q._id ? (q._id.toString ? q._id.toString() : String(q._id)) : String(q.id || index + 1);

        if (approvedOnlyBool) {
          const built = CalculationQuestion.buildStudentCalculationInstance({
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
              questionType: QUESTION_TYPES.CALCULATION,
              calculationToken: built.token,
              answerDecimalPlaces: built.answerDecimalPlaces,
              calculationAnswerTolerancePercent: tolerancePercent,
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
            questionType: QUESTION_TYPES.CALCULATION,
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
          questionType: QUESTION_TYPES.CALCULATION,
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
        questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
        options: optionsObj,
        correctAnswer: (q.correctAnswer || "A").toString().toUpperCase()
      };

      const finalQuestion = formattedQuestion;

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
    const { quizId, questionId } = req.params;
    const { selectedIndex, answerText } = req.body;
    const userId = req.user?._id || req.user?.id;

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
      questionType === QUESTION_TYPES.CALCULATION ||
      (calculationToken && hasCalculationFormula);

    if (treatAsCalculation) {
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
      const verified = CalculationQuestion.verifyCalculationToken(calculationToken);
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
      const tolerancePercent =
        question.calculationAnswerTolerancePercent != null &&
        Number.isFinite(Number(question.calculationAnswerTolerancePercent))
          ? Number(question.calculationAnswerTolerancePercent)
          : null;
      let expected;
      try {
        expected = CalculationQuestion.evaluateCalculationFormula(formula, verified.values);
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
      const studentNum = CalculationQuestion.parseStudentNumericAnswer(answerText);
      const isCorrect = CalculationQuestion.numericAnswersMatch(studentNum, expected, answerDec, tolerancePercent);
      const displayCorrect = CalculationQuestion.formatAnswerForDisplay(expected, answerDec);
      if (userId && quizId) {
        quizService.saveStudentPerformance({
          userId: String(userId), quizId: String(quizId), questionId: String(questionId),
          learningObjectiveId: question.learningObjectiveId,
          granularObjectiveId: question.granularObjectiveId,
          bloom: question.bloom,
          questionType: QUESTION_TYPES.CALCULATION,
          isCorrect,
          selectedAnswer: String(answerText).trim(),
          correctAnswer: displayCorrect,
          correctOptionText: displayCorrect,
        }).catch(e => console.error('[check] Failed to record attempt:', e));
      }
      res.json({
        success: true,
        isCorrect,
        feedback: isCorrect ? "Correct." : "",
        correctAnswer: isCorrect ? displayCorrect : null,
        correctOptionText: displayCorrect,
      });
      return;
    }

    if (questionType === QUESTION_TYPES.OPEN_ENDED) {
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
      if (userId && quizId) {
        quizService.saveStudentPerformance({
          userId: String(userId), quizId: String(quizId), questionId: String(questionId),
          learningObjectiveId: question.learningObjectiveId,
          granularObjectiveId: question.granularObjectiveId,
          bloom: question.bloom,
          questionType: QUESTION_TYPES.OPEN_ENDED,
          isCorrect: null,
          selectedAnswer: String(answerText).trim(),
          sampleAnswer: sample,
          gradingCriteria: criteria || null,
        }).catch(e => console.error('[check] Failed to record attempt:', e));
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

    if (questionType === QUESTION_TYPES.FILL_IN_THE_BLANK) {
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
      if (userId && quizId) {
        quizService.saveStudentPerformance({
          userId: String(userId), quizId: String(quizId), questionId: String(questionId),
          learningObjectiveId: question.learningObjectiveId,
          granularObjectiveId: question.granularObjectiveId,
          bloom: question.bloom,
          questionType: QUESTION_TYPES.FILL_IN_THE_BLANK,
          isCorrect,
          selectedAnswer: String(answerText).trim(),
          correctAnswer: isCorrect ? canonical : null,
          correctOptionText: canonical || null,
        }).catch(e => console.error('[check] Failed to record attempt:', e));
      }
      res.json({
        success: true,
        isCorrect,
        feedback: isCorrect ? "Correct." : "",
        correctAnswer: isCorrect ? canonical : null,
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

    if (userId && quizId) {
      quizService.saveStudentPerformance({
        userId: String(userId), quizId: String(quizId), questionId: String(questionId),
        learningObjectiveId: question.learningObjectiveId,
        granularObjectiveId: question.granularObjectiveId,
        bloom: question.bloom,
        questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
        isCorrect,
        selectedAnswer: selectedKey,
        correctAnswer: isCorrect ? correctAnswerLetter : null,
        correctOptionText: isCorrect ? correctOptionText : null,
        feedbackText: feedback,
      }).catch(e => console.error('[check] Failed to record attempt:', e));
    }
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

/**
 * Get scores for a quiz with student data (Instructors only)
 */
const getQuizScoresHandler = async (req, res) => {
  try {
    const { quizId } = req.params;
    const scores = await quizService.getQuizScores(quizId);
    
    if (!scores) {
      return res.status(404).json({ success: false, error: "Scores not found" });
    }
    
    res.json({ success: true, data: scores });
  } catch (error) {
    console.error("Error fetching quiz scores:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get detailed student attempt answers for a specific quiz (Instructors only)
 */
const getStudentQuizAttemptHandler = async (req, res) => {
  try {
    const { quizId, userId } = req.params;
    const attempts = await quizService.getStudentQuizAttempt(quizId, userId);
    
    if (!attempts) {
      return res.status(404).json({ success: false, error: "Attempts not found" });
    }
    
    res.json({ success: true, data: attempts });
  } catch (error) {
    console.error("Error fetching student quiz attempts:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get all completed quiz IDs for the current student in a course
 */
const getMyScoresHandler = async (req, res) => {
  try {
    const { courseId } = req.query;
    const userId = req.user._id || req.user.id;

    if (!courseId) {
      return res.status(400).json({ success: false, error: "courseId is required" });
    }

    const completedQuizIds = await quizService.getUserScoresForCourse(userId, courseId);
    res.json({ success: true, completedQuizIds });
  } catch (error) {
    console.error("Error fetching my scores:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getQuizzesByCourseHandler,
  getMyScoresHandler,
  getQuizByIdHandler,
  createQuizHandler,
  updateQuizHandler,
  deleteQuizHandler,
  addQuizQuestionsHandler,
  getQuizQuestionsHandler,
  recordPerformanceHandler,
  checkQuestionAnswerHandler,
  getQuizScoresHandler,
  getStudentQuizAttemptHandler
};
