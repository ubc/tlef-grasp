const { getStudentCourses } = require('../services/user-course');
const quizService = require('../services/quiz');
const quizScheduleService = require('../services/quiz-schedule');
const { isStudent } = require('../utils/auth');
const CalculationQuestion = require('../models/questions/CalculationQuestion');
const achievementService = require('../services/achievement');
const { getCourseById } = require('../services/course');
const { ObjectId } = require('mongodb');
const { QUESTION_TYPES } = require('../constants/app-constants');
const databaseService = require('../services/database');

// A student who started a quiz inside its window keeps access to their
// in-progress attempt after the window closes: recorded answers exist (answers
// are only recordable while the quiz is open) but no final score has been
// saved yet. Lets them resume/submit so started-in-time progress is never lost.
const hasUnsubmittedAttempt = async (userId, quizId) => {
  const db = await databaseService.connect();
  const userIdObj = ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
  const quizIdObj = ObjectId.isValid(quizId) ? new ObjectId(quizId) : quizId;
  const existingScore = await db
    .collection("grasp_quiz_score")
    .findOne({ userId: userIdObj, quizId: quizIdObj });
  if (existingScore) return false;
  const attempt = await db
    .collection("grasp_student_attempt")
    .findOne({ userId: userIdObj, quizId: quizIdObj });
  return Boolean(attempt);
};

// Resolve whether a student may access a quiz right now, based on the
// release/expire window of the section(s) they belong to. Students with no
// section assignment, or whose section has no schedule for this quiz, are
// blocked. A quiz is open if ANY of the student's scheduled sections is open.
const resolveStudentQuizAccess = async (quiz, user) => {
  if (!quiz) return { success: false, status: 404, message: "Quiz not found" };
  if (!quiz.published) return { success: false, status: 403, message: "This quiz is not available. Only published quizzes can be accessed." };

  // Instructors (staff/faculty/admins) aren't enrolled in a section — let them
  // open any published quiz regardless of the per-section schedule.
  if (!(await isStudent(user))) return { success: true };

  const userId = user._id || user.id;
  const studentSectionIds = await quizScheduleService.getStudentSectionObjectIds(userId, quiz.courseId);
  if (studentSectionIds.length === 0) {
    return {
      success: false,
      status: 403,
      message: "This quiz is not available for your section. If you believe this is a mistake, contact your instructor.",
    };
  }

  const rows = await quizScheduleService.getSchedulesForQuiz(quiz._id.toString());
  const window = quizScheduleService.resolveWindow(rows, studentSectionIds, new Date());

  if (window.accessibleNow) return { success: true };

  if (window.reason === "not-yet") {
    return {
      success: false,
      status: 403,
      message: `This quiz is not yet available. It will be released on ${new Date(window.releaseDate).toLocaleString()}.`,
    };
  }
  if (window.reason === "expired") {
    // Grace path: the student started during the window but the quiz expired
    // before they finished — let them resume and submit their attempt (#37).
    if (await hasUnsubmittedAttempt(userId, quiz._id.toString())) {
      return { success: true, expiredGrace: true };
    }
    return { success: false, status: 403, message: "This quiz has expired and is no longer available." };
  }
  return { success: false, status: 403, message: "This quiz has not been scheduled for your section yet." };
};

const getStudentCoursesHandler = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User not authenticated"
      });
    }

    const courses = await getStudentCourses(userId);

    res.json({
      success: true,
      courses: courses,
    });
  } catch (error) {
    console.error("[Student API] Error fetching student courses:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch student courses",
    });
  }
};

const startQuizHandler = async (req, res) => {
  try {
    const { quizId } = req.params;

    const quiz = await quizService.getQuizById(quizId);

    const accessibility = await resolveStudentQuizAccess(quiz, req.user);
    if (!accessibility.success) {
      return res.status(accessibility.status).json({
        success: false,
        message: accessibility.message,
      });
    }

    // Verify quiz has approved questions
    const questions = await quizService.getQuizQuestions(quizId, true); // approvedOnly = true
    if (!questions || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: "This quiz has no approved questions available.",
      });
    }

    const sessionId = `session_${Date.now()}_${quizId}`;

    res.json({
      success: true,
      data: {
        quizId: quizId,
        sessionId: sessionId,
        message: "Quiz started successfully",
      },
    });
  } catch (error) {
    console.error("Error starting quiz:", error);
    res.status(500).json({
      success: false,
      message: "Failed to start quiz",
      error: error.message,
    });
  }
};


function resolveQuestionType(q) {
  const t = String(q.questionType || q.type || "").trim().toLowerCase();
  const known = [QUESTION_TYPES.FILL_IN_THE_BLANK, QUESTION_TYPES.CALCULATION, QUESTION_TYPES.OPEN_ENDED];
  return known.includes(t) ? t : QUESTION_TYPES.MULTIPLE_CHOICE;
}


const getQuizQuestionsHandler = async (req, res) => {
  try {
    const { quizId } = req.params;

    // First, verify the quiz exists and is accessible for this student's section
    const quiz = await quizService.getQuizById(quizId);
    const accessibility = await resolveStudentQuizAccess(quiz, req.user);
    if (!accessibility.success) {
      return res.status(accessibility.status).json({
        success: false,
        message: accessibility.message,
      });
    }

    // Get personalized questions for the student
    const userId = req.user._id || req.user.id;
    const questions = await quizService.getQuizQuestionsForStudent(quizId, userId);

    if (!questions || questions.length === 0) {
      return res.json({
        success: true,
        data: {
          quizId: quizId,
          title: quiz.name || "Quiz",
          disablePreviousNavigation: quiz.disablePreviousNavigation === true,
          course: "",
          duration: 0,
          questions: [],
        },
        message: "No approved questions available for this quiz",
      });
    }

    const transformedQuestions = questions.map((q, index) => {
      const questionType = resolveQuestionType(q);
      const questionText = (q.title || q.stem || "").trim();
      const fibMainText =
        questionType === QUESTION_TYPES.FILL_IN_THE_BLANK
          ? (q.stem || q.title || "").trim()
          : questionText;

      if (questionType === QUESTION_TYPES.FILL_IN_THE_BLANK) {
        return {
          id: q._id ? (q._id.toString ? q._id.toString() : String(q._id)) : String(q.id || index + 1),
          question: fibMainText || questionText || "Question text not available",
          questionType: QUESTION_TYPES.FILL_IN_THE_BLANK,
          options: {},
          learningObjectiveId: q.learningObjectiveId,
          granularObjectiveId: q.granularObjectiveId,
          bloom: q.bloom,
        };
      }

      if (questionType === QUESTION_TYPES.OPEN_ENDED) {
        return {
          id: q._id ? (q._id.toString ? q._id.toString() : String(q._id)) : String(q.id || index + 1),
          question: fibMainText || questionText || "Question text not available",
          questionType: QUESTION_TYPES.OPEN_ENDED,
          options: {},
          learningObjectiveId: q.learningObjectiveId,
          granularObjectiveId: q.granularObjectiveId,
          bloom: q.bloom,
        };
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

      let optionsObj = {};
      if (q.options && typeof q.options === 'object') {
        if (!Array.isArray(q.options)) {
          optionsObj = {
            A: (q.options.A?.text || q.options.A || "").toString(),
            B: (q.options.B?.text || q.options.B || "").toString(),
            C: (q.options.C?.text || q.options.C || "").toString(),
            D: (q.options.D?.text || q.options.D || "").toString()
          };
        } else {
          optionsObj = {
            A: (q.options[0]?.text || q.options[0] || "").toString(),
            B: (q.options[1]?.text || q.options[1] || "").toString(),
            C: (q.options[2]?.text || q.options[2] || "").toString(),
            D: (q.options[3]?.text || q.options[3] || "").toString()
          };
        }
      }

      return {
        id: q._id ? (q._id.toString ? q._id.toString() : String(q._id)) : String(q.id || index + 1),
        question: questionText || "Question text not available",
        questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
        options: optionsObj,
        learningObjectiveId: q.learningObjectiveId,
        granularObjectiveId: q.granularObjectiveId,
        bloom: q.bloom
      };
    });

    let courseName = "";
    if (quiz.courseId) {
      try {
        const course = await getCourseById(quiz.courseId.toString());
        if (course) {
          courseName = course.courseName || "";
        }
      } catch (courseError) {
        console.error("Error fetching course name:", courseError);
      }
    }

    // Load previously recorded answers for first-attempt resumption
    let previousAnswers = {};
    try {
      const db = await databaseService.connect();
      const userIdObj = ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
      const quizIdObj = ObjectId.isValid(quizId) ? new ObjectId(quizId) : quizId;
      const existingScore = await db.collection("grasp_quiz_score").findOne({ userId: userIdObj, quizId: quizIdObj });
      if (!existingScore) {
        const attempts = await db.collection("grasp_student_attempt").find({ userId: userIdObj, quizId: quizIdObj }).toArray();
        const optionKeys = ['A', 'B', 'C', 'D'];
        attempts.forEach(attempt => {
          const entry = {
            questionType: attempt.questionType,
            selectedAnswer: attempt.selectedAnswer,
            isCorrect: attempt.isCorrect,
            correctAnswer: attempt.correctAnswer,
            correctOptionText: attempt.correctOptionText,
            sampleAnswer: attempt.sampleAnswer,
            gradingCriteria: attempt.gradingCriteria,
            feedbackText: attempt.feedbackText,
            aiGraded: !!attempt.aiGraded,
            aiCriteria: Array.isArray(attempt.aiCriteria) ? attempt.aiCriteria : null,
          };
          if (attempt.questionType === QUESTION_TYPES.MULTIPLE_CHOICE && attempt.selectedAnswer) {
            entry.selectedIndex = optionKeys.indexOf(attempt.selectedAnswer);
          }
          previousAnswers[attempt.questionId.toString()] = entry;
        });
      }
    } catch (prevErr) {
      console.error('[Student] Failed to load previous answers:', prevErr);
    }

    res.json({
      success: true,
      data: {
        quizId: quizId,
        title: quiz.name || "Quiz",
        course: courseName,
        disablePreviousNavigation: quiz.disablePreviousNavigation === true,
        duration: 0,
        questions: transformedQuestions,
        previousAnswers,
      },
      message: "Quiz questions retrieved successfully",
    });
  } catch (error) {
    console.error("Error fetching quiz questions:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch quiz questions",
      error: error.message,
    });
  }
};

const submitQuizHandler = async (req, res) => {
  try {
    const { quizId } = req.params;
    const { timeSpent, sessionId } = req.body;

    const quiz = await quizService.getQuizById(quizId);
    const accessibility = await resolveStudentQuizAccess(quiz, req.user);
    if (!accessibility.success) {
      return res.status(accessibility.status).json({ success: false, message: accessibility.message });
    }

    const userId = req.user._id || req.user.id;
    const courseId = quiz.courseId;
    const quizName = quiz.name || "Quiz";

    const db = await databaseService.connect();
    const userIdObj = ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
    const quizIdObj = ObjectId.isValid(quizId) ? new ObjectId(quizId) : quizId;

    // Compute score from server-recorded attempts (recorded at /check time)
    const attempts = await db.collection("grasp_student_attempt").find({ userId: userIdObj, quizId: quizIdObj }).toArray();

    if (attempts.length === 0) {
      return res.status(400).json({ success: false, message: "No answers recorded for this quiz." });
    }

    const gradedAttempts = attempts.filter(a => a.isCorrect !== null);
    const totalQuestions = gradedAttempts.length;
    const correctAnswers = gradedAttempts.filter(a => a.isCorrect === true).length;
    const score = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : null;

    let newAchievements = [];
    try {
      if (userId && courseId) {
        newAchievements = await achievementService.awardQuizAchievements(
          userId.toString(), courseId.toString(), quizId, quizName, score ?? 0
        );
      }
      if (userId && quizId) {
        await quizService.saveQuizScore({
          userId: userId.toString(),
          quizId,
          courseId: courseId ? courseId.toString() : null,
          score: score ?? 0,
          correctAnswers,
          totalQuestions,
          timeSpent
        });
      }
    } catch (performanceError) {
      console.error("Error recording score or awarding achievements:", performanceError);
    }

    res.json({
      success: true,
      data: {
        quizId,
        sessionId,
        score,
        correctAnswers,
        totalQuestions,
        timeSpent,
        submittedAt: new Date().toISOString(),
        newAchievements,
      },
      message: "Quiz submitted successfully",
    });
  } catch (error) {
    console.error("Error submitting quiz:", error);
    res.status(500).json({ success: false, message: "Failed to submit quiz", error: error.message });
  }
};

const getQuizResultsHandler = async (req, res) => {
  res.status(501).json({
    success: false,
    message: "Quiz history not implemented yet"
  });
};



module.exports = {
  getStudentCoursesHandler,
  startQuizHandler,
  getQuizQuestionsHandler,
  submitQuizHandler,
  getQuizResultsHandler
};
