const { getStudentCourses } = require('../services/user-course');
const quizService = require('../services/quiz');
const CalculationQuestion = require('../models/questions/CalculationQuestion');
const achievementService = require('../services/achievement');
const { getCourseById } = require('../services/course');
const { ObjectId } = require('mongodb');
const { QUESTION_TYPES } = require('../constants/app-constants');
const { MC_OPTION_KEYS, optionKeysOf, optionAt, optionTextOf } = require('../utils/mc-options');
const databaseService = require('../services/database');
const quizSessionService = require('../services/quiz-session');
const { resolveStudentQuizAccess } = require('../services/student-quiz-access');
const studentQuizDelivery = require('../services/student-quiz-delivery');

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
    // A spaced-3phase graded attempt keeps its pick on the session, so a
    // reload serves the same questions (issue #168).
    const questions = await studentQuizDelivery.getStudentQuestions(quiz, userId);

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
        const { answerDec, tolerance, tolerancePercent } = CalculationQuestion.readGradingSettings(q);
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
            // The rule the student is graded by, minus a range's bounds.
            calculationTolerance: CalculationQuestion.toleranceForStudent(tolerance),
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

      // Only the option text goes to the student; feedback and the answer stay
      // on the server. Whatever letters the question has (two to eight). An
      // option with an image (issue #146) is sent as { text, image } with just
      // the file id and the alt text: the stored filename could name the answer.
      const optionsObj = {};
      optionKeysOf(q.options).forEach((key) => {
        const raw = optionAt(q.options, key);
        const text = optionTextOf(raw);
        const image = raw && typeof raw === 'object' ? raw.image : null;
        optionsObj[key] = image?.fileId
          ? { text, image: { fileId: String(image.fileId), caption: image.caption || '' } }
          : text;
      });

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

    // Load previously recorded answers for first-attempt resumption. A student
    // who already has a recorded score has completed their graded attempt, so
    // any further run is practice (the client renders it ungraded).
    let previousAnswers = {};
    let alreadyCompleted = false;
    try {
      const db = await databaseService.connect();
      const userIdObj = ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
      const quizIdObj = ObjectId.isValid(quizId) ? new ObjectId(quizId) : quizId;
      const existingScore = await db.collection("grasp_quiz_score").findOne({ userId: userIdObj, quizId: quizIdObj });
      alreadyCompleted = !!existingScore;
      if (!existingScore) {
        const attempts = await db.collection("grasp_student_attempt").find({ userId: userIdObj, quizId: quizIdObj }).toArray();
        attempts.forEach(attempt => {
          // A resumed wrong multiple-choice or calculation answer must not
          // reveal the correct one (issue #128): the student keeps retrying
          // until they find it. Fill-in-the-blank and open-ended answers are
          // submitted once and already showed their answer, so they come back
          // as recorded.
          const answerShownOnSubmit =
            attempt.questionType === QUESTION_TYPES.FILL_IN_THE_BLANK ||
            attempt.questionType === QUESTION_TYPES.OPEN_ENDED;
          const hideAnswer = attempt.isCorrect !== true && !answerShownOnSubmit;
          const entry = {
            questionType: attempt.questionType,
            selectedAnswer: attempt.selectedAnswer,
            isCorrect: attempt.isCorrect,
            correctAnswer: hideAnswer ? null : attempt.correctAnswer,
            correctOptionText: hideAnswer ? null : attempt.correctOptionText,
            sampleAnswer: attempt.sampleAnswer,
            gradingCriteria: attempt.gradingCriteria,
            feedbackText: attempt.feedbackText,
            aiGraded: !!attempt.aiGraded,
            aiCriteria: Array.isArray(attempt.aiCriteria) ? attempt.aiCriteria : null,
            // Preserve the student's accept/deny reaction across reloads (issue
            // #76); without it a restored attempt reverts to the default accept.
            studentGradeReview: attempt.studentGradeReview || null,
          };
          if (attempt.questionType === QUESTION_TYPES.MULTIPLE_CHOICE && attempt.selectedAnswer) {
            entry.selectedIndex = MC_OPTION_KEYS.indexOf(attempt.selectedAnswer);
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
        alreadyCompleted,
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
    // scores out of 10. A spaced-3phase attempt that kept its pick (issue
    // #168) is scored on exactly that pick: its questions still served, plus
    // any the student answered that have since been removed. Older sessions
    // use the count recorded at the first load, and sessions from before that
    // the graded-attempt count.
    const scored = await studentQuizDelivery.scoredQuestionIds(quiz, userId, session, attempts);
    let totalQuestions;
    let correctAnswers;
    if (scored) {
      totalQuestions = scored.size;
      correctAnswers = gradedAttempts.filter(
        a => a.isCorrect === true && scored.has(String(a.questionId))
      ).length;
    } else {
      const servedCount = Number(session?.questionCount);
      totalQuestions = Number.isInteger(servedCount) && servedCount > 0
        ? Math.max(servedCount, gradedAttempts.length)
        : gradedAttempts.length;
      correctAnswers = gradedAttempts.filter(a => a.isCorrect === true).length;
    }
    const score = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : null;

    // Achievements are decoration: a failure awarding them must not cost the
    // student their score, so they get their own catch.
    let newAchievements = [];
    try {
      if (userId && courseId) {
        newAchievements = await achievementService.awardQuizAchievements(
          userId.toString(), courseId.toString(), quizId, quizName, score ?? 0
        );
      }
    } catch (achievementError) {
      console.error("Error awarding quiz achievements:", achievementError);
    }

    // Recording the score is the point of this request. It used to share the
    // catch above, so a failed write still answered success:true — the student
    // saw a score that was never stored, the instructor's roster showed them as
    // not having taken the quiz, and nothing prompted a retry. saveQuizScore
    // treats a duplicate as a no-op, so retrying is safe.
    try {
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
    } catch (scoreError) {
      console.error("Error recording quiz score:", scoreError);
      return res.status(500).json({
        success: false,
        code: "SCORE_NOT_RECORDED",
        message: "Your answers were saved, but your score could not be recorded. Please try submitting again.",
      });
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
