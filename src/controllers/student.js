const { getStudentCourses } = require('../services/user-course');
const quizService = require('../services/quiz');
const quizScheduleService = require('../services/quiz-schedule');
const { hasStaffAccessInCourse } = require('../utils/course-access');
const CalculationQuestion = require('../models/questions/CalculationQuestion');
const achievementService = require('../services/achievement');
const { getCourseById } = require('../services/course');
const { ObjectId } = require('mongodb');
const { QUESTION_TYPES } = require('../constants/app-constants');
const databaseService = require('../services/database');
const quizSessionService = require('../services/quiz-session');

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
  if (attempt) return true;

  // A timed session can expire before the student submits an answer. Keep it
  // reachable long enough for the client to perform its automatic zero-score
  // submission instead of silently abandoning that started attempt.
  const session = await quizSessionService.getSession(userId, quizId);
  return Boolean(session && !session.submittedAt);
};

// Resolve whether a student may access a quiz right now, based on the
// release/expire window of the section(s) they belong to. Students with no
// section assignment, or whose section has no schedule for this quiz, are
// blocked. A quiz is open if ANY of the student's scheduled sections is open.
const resolveStudentQuizAccess = async (quiz, user) => {
  if (!quiz) return { success: false, status: 404, message: "Quiz not found" };
  if (!quiz.published) return { success: false, status: 403, message: "This quiz is not available. Only published quizzes can be accessed." };

  // Instructors aren't enrolled in a section. Promoted TAs only receive this
  // preview bypass in their TA course; elsewhere they follow student windows.
  if (await hasStaffAccessInCourse(user, quiz.courseId)) {
    return { success: true, scheduledExpiresAt: null };
  }

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

  if (window.accessibleNow) {
    return { success: true, scheduledExpiresAt: window.expireDate || null };
  }

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
      return {
        success: true,
        expiredGrace: true,
        scheduledExpiresAt: window.expireDate || null,
      };
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
    const userId = req.user._id || req.user.id;
    const session = await quizSessionService.getOrCreateSession(userId, quiz, {
      scheduledExpiresAt: accessibility.scheduledExpiresAt,
    });

    res.json({
      success: true,
      data: {
        quizId: quizId,
        sessionId: sessionId,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
        timeLimitMinutes: session.timeLimitMinutes,
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
    // A questions request is also a valid start action (for bookmarked/direct
    // student URLs), but it never resets an existing session's deadline.
    const session = await quizSessionService.getOrCreateSession(userId, quiz, {
      scheduledExpiresAt: accessibility.scheduledExpiresAt,
    });
    const questions = await quizService.getQuizQuestionsForStudent(quizId, userId);

    if (questions && questions.length > 0) {
      try {
        await quizSessionService.recordQuestionCount(userId, quizId, questions.length);
      } catch (countErr) {
        console.error('[Student] Failed to record served question count:', countErr);
      }
    }

    if (!questions || questions.length === 0) {
      return res.json({
        success: true,
        data: {
          quizId: quizId,
          title: quiz.name || "Quiz",
          disablePreviousNavigation: quiz.disablePreviousNavigation === true,
          course: "",
          duration: 0,
          startedAt: session.startedAt,
          expiresAt: session.expiresAt,
          timeLimitMinutes: session.timeLimitMinutes,
          questions: [],
        },
        message: "No approved questions available for this quiz",
      });
    }

    const transformedQuestions = questions.map((q, index) => {
      const questionType = resolveQuestionType(q);
      const questionText = (q.title || q.stem || "").trim();
      // Fill-in-the-blank and open-ended store the actual prompt in `stem`;
      // `title` is only a short topic label, so prefer `stem` for those types.
      const stemFirstTypes =
        questionType === QUESTION_TYPES.FILL_IN_THE_BLANK ||
        questionType === QUESTION_TYPES.OPEN_ENDED;
      const fibMainText = stemFirstTypes
        ? (q.stem || q.title || "").trim()
        : questionText;

      if (questionType === QUESTION_TYPES.FILL_IN_THE_BLANK) {
        return {
          id: q._id ? (q._id.toString ? q._id.toString() : String(q._id)) : String(q.id || index + 1),
          question: fibMainText || questionText || "Question text not available",
          questionType: QUESTION_TYPES.FILL_IN_THE_BLANK,
          stemImages: q.stemImages || (q.stemImage ? [q.stemImage] : []),
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
          stemImages: q.stemImages || (q.stemImage ? [q.stemImage] : []),
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
            stemImages: q.stemImages || (q.stemImage ? [q.stemImage] : []),
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
          stemImages: q.stemImages || (q.stemImage ? [q.stemImage] : []),
          calculationToken: null,
          answerDecimalPlaces: answerDec,
          calculationLoadError: true,
          options: {},
          learningObjectiveId: q.learningObjectiveId,
          granularObjectiveId: q.granularObjectiveId,
          bloom: q.bloom,
        };
      }

      const optionText = (raw) =>
        (raw && typeof raw === "object" ? raw.text ?? "" : raw ?? "").toString();

      let optionsObj = {};
      if (q.options && typeof q.options === 'object') {
        if (!Array.isArray(q.options)) {
          optionsObj = {
            A: optionText(q.options.A),
            B: optionText(q.options.B),
            C: optionText(q.options.C),
            D: optionText(q.options.D)
          };
        } else {
          optionsObj = {
            A: optionText(q.options[0]),
            B: optionText(q.options[1]),
            C: optionText(q.options[2]),
            D: optionText(q.options[3])
          };
        }
      }

      return {
        id: q._id ? (q._id.toString ? q._id.toString() : String(q._id)) : String(q.id || index + 1),
        question: questionText || "Question text not available",
        questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
        stemImages: q.stemImages || (q.stemImage ? [q.stemImage] : []),
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
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
        timeLimitMinutes: session.timeLimitMinutes,
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
    const session = await quizSessionService.getSession(userId, quizId);
    const authoritativeTimeSpent = session?.startedAt
      ? Math.max(0, Date.now() - new Date(session.startedAt).getTime())
      : timeSpent;

    // Compute score from server-recorded attempts (recorded at /check time)
    const attempts = await db.collection("grasp_student_attempt").find({ userId: userIdObj, quizId: quizIdObj }).toArray();

    const gradedAttempts = attempts.filter(a => a.isCorrect !== null);
    // The denominator is the number of questions the student was served, not
    // just the ones they answered — a timed-out student who answered 6 of 10
    // scores out of 10. Sessions created before the count was recorded fall
    // back to the graded-attempt count.
    const servedCount = Number(session?.questionCount);
    const totalQuestions = Number.isInteger(servedCount) && servedCount > 0
      ? Math.max(servedCount, gradedAttempts.length)
      : gradedAttempts.length;
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
          timeSpent: authoritativeTimeSpent
        });
      }
      await quizSessionService.markSubmitted(userId, quizId);
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
        timeSpent: authoritativeTimeSpent,
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
