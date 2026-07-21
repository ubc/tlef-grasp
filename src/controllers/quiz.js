const quizService = require("../services/quiz");
const quizScheduleService = require("../services/quiz-schedule");
const quizCalendarService = require("../services/quiz-calendar");
const sectionService = require("../services/course-section");
const questionService = require("../services/question");
const answerGradingService = require("../services/answer-grading");
const questionFlagService = require("../services/quiz-question-flag");
const CalculationQuestion = require('../models/questions/CalculationQuestion');
const { QUESTION_TYPES } = require("../constants/app-constants");
const { isUserInCourse } = require('../services/user-course');
const { isFaculty } = require('../utils/auth');
const { hasStaffAccessInCourse } = require('../utils/course-access');
const { assertCoInstructorPermission, PERMISSION_KEYS } = require('../utils/co-instructor-permissions');
const { assertTaPermission, TA_PERMISSION_KEYS } = require('../utils/ta-permissions');
const quizSessionService = require('../services/quiz-session');

function isBooleanIfPresent(value) {
  return value === undefined || typeof value === "boolean";
}

const FLAG_REASONS = new Set(["unclear", "incorrect", "inappropriate", "typo", "other"]);
const FLAG_STATUSES = new Set(["pending", "reviewed", "resolved", "dismissed"]);

const getRequestUserId = (req) => req.user?._id || req.user?.id;

async function canAccessCourse(req, courseId) {
  return (await isFaculty(req.user)) || (await isUserInCourse(getRequestUserId(req), courseId));
}

/**
 * Create or update the current learner's report for one quiz question.
 * Instructors using the student preview can submit a test report under their
 * own account; regular student reports retain the same data shape.
 */
const saveStudentQuestionFlagHandler = async (req, res) => {
  try {
    const { quizId } = req.params;
    const { questionId, reason, comment = "", questionText = "" } = req.body || {};

    if (!questionId || !FLAG_REASONS.has(reason)) {
      return res.status(400).json({
        success: false,
        error: "questionId and a valid flag reason are required",
      });
    }
    if (typeof comment !== "string" || comment.length > 2000) {
      return res.status(400).json({ success: false, error: "comment must be at most 2000 characters" });
    }
    if (typeof questionText !== "string" || questionText.length > 10000) {
      return res.status(400).json({ success: false, error: "questionText must be at most 10000 characters" });
    }

    const quiz = await quizService.getQuizById(quizId);
    if (!quiz) return res.status(404).json({ success: false, error: "Quiz not found" });
    if (!(await canAccessCourse(req, quiz.courseId))) {
      return res.status(403).json({ success: false, error: "You are not a member of this course" });
    }
    if (!(await questionFlagService.questionBelongsToQuiz(quizId, questionId))) {
      return res.status(400).json({ success: false, error: "Question does not belong to this quiz" });
    }

    const flag = await questionFlagService.saveStudentFlag({
      courseId: quiz.courseId,
      quizId,
      questionId,
      studentId: getRequestUserId(req),
      reason,
      comment: comment.trim(),
      questionText: questionText.trim(),
    });
    res.status(201).json({ success: true, flag });
  } catch (error) {
    console.error("Error saving student question flag:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getMyQuestionFlagsHandler = async (req, res) => {
  try {
    const { courseId } = req.query;
    if (!courseId) return res.status(400).json({ success: false, error: "courseId is required" });
    if (!(await canAccessCourse(req, courseId))) {
      return res.status(403).json({ success: false, error: "You are not a member of this course" });
    }
    const flags = await questionFlagService.getStudentFlags(courseId, getRequestUserId(req));
    res.json({ success: true, flags });
  } catch (error) {
    console.error("Error fetching student question flags:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getCourseQuestionFlagsHandler = async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({ success: false, error: "Staff access is not granted in this course" });
    }
    if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.QUESTION_FLAGS))) return;
    const flags = await questionFlagService.getCourseFlags(courseId);
    res.json({ success: true, flags });
  } catch (error) {
    console.error("Error fetching course question flags:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateQuestionFlagStatusHandler = async (req, res) => {
  try {
    const { flagId } = req.params;
    const { status } = req.body || {};
    if (!FLAG_STATUSES.has(status)) {
      return res.status(400).json({ success: false, error: "Invalid flag status" });
    }
    const flag = await questionFlagService.getFlagById(flagId);
    if (!flag) return res.status(404).json({ success: false, error: "Flag not found" });
    if (!(await hasStaffAccessInCourse(req.user, flag.courseId))) {
      return res.status(403).json({ success: false, error: "Staff access is not granted in this course" });
    }
    if (!(await assertTaPermission(req, res, flag.courseId, TA_PERMISSION_KEYS.QUESTION_FLAGS))) return;
    const updatedFlag = await questionFlagService.updateFlagStatus(
      flagId,
      status,
      getRequestUserId(req)
    );
    res.json({ success: true, flag: updatedFlag });
  } catch (error) {
    console.error("Error updating question flag status:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get all quizzes for a course
 */
const getQuizzesByCourseHandler = async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!(await canAccessCourse(req, courseId))) {
      return res.status(403).json({ success: false, error: "You are not a member of this course" });
    }
    const allQuizzes = await quizService.getQuizzesByCourse(courseId);
    const quizzes = await hasStaffAccessInCourse(req.user, courseId)
      ? allQuizzes
      : allQuizzes.filter((quiz) => quiz.published === true);
    res.json({ success: true, quizzes });
  } catch (error) {
    console.error("Error fetching quizzes:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get all quizzes for a course with their questions (instructor view).
 * Single round trip replacing one questions request per quiz.
 */
const getQuizzesByCourseWithQuestionsHandler = async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({ success: false, error: "Staff access is not granted in this course" });
    }
    if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.QUIZZES))) return;
    const quizzes = await quizService.getQuizzesByCourseWithQuestions(courseId);
    res.json({ success: true, quizzes });
  } catch (error) {
    console.error("Error fetching quizzes with questions:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Student quiz overview: published, currently-open quizzes with this
 * student's personalized question counts (no question content or answers).
 */
const getStudentQuizOverviewHandler = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user ? (req.user._id || req.user.id) : null;

    const published = (await quizService.getQuizzesByCourse(courseId))
      .filter((quiz) => quiz.published === true);

    let active;
    if (await hasStaffAccessInCourse(req.user, courseId)) {
      // Instructors (staff/faculty/admins) aren't enrolled in a section — let
      // them preview every published quiz regardless of the per-section schedule.
      active = published;
    } else {
      // Per-section scheduling: a quiz is only visible to a student through the
      // section(s) they belong to. Students with no section assignment see nothing.
      const studentCourseSectionIds = await quizScheduleService.getStudentSectionObjectIds(userId, courseId);
      if (studentCourseSectionIds.length === 0) {
        return res.json({ success: true, quizzes: [] });
      }

      const now = new Date();
      const schedulesByQuiz = await quizScheduleService.getSchedulesForQuizzes(
        published.map((q) => q._id.toString()),
        studentCourseSectionIds
      );

      active = [];
      for (const quiz of published) {
        const window = quizScheduleService.resolveWindow(
          schedulesByQuiz.get(quiz._id.toString()) || [],
          studentCourseSectionIds,
          now
        );
        if (window.accessibleNow) {
          active.push({ ...quiz, releaseDate: window.releaseDate, expireDate: window.expireDate });
        }
      }
    }

    // The overview only needs counts. For all-approved quizzes (the default
    // delivery format) the count is the same for every student, so it comes
    // from two batched queries instead of loading full question documents per
    // quiz. Only spaced-3phase quizzes run the personalized selection, whose
    // per-phase counts genuinely differ per student.
    const allApprovedIds = active
      .filter((quiz) => quiz.deliveryFormat !== "spaced-3phase")
      .map((quiz) => quiz._id.toString());
    const approvedCounts = await quizService.getApprovedQuestionCountsForQuizzes(allApprovedIds);

    const overview = await Promise.all(
      active.map(async (quiz) => {
        if (quiz.deliveryFormat !== "spaced-3phase") {
          return {
            ...quiz,
            questionCount: approvedCounts.get(quiz._id.toString()) || 0,
            phase1Count: 0,
            phase2Count: 0,
            phase3Count: 0,
          };
        }
        let questions = [];
        try {
          questions = await quizService.getQuizQuestionsForStudent(quiz._id.toString(), userId);
        } catch (err) {
          console.error(`Error selecting questions for quiz ${quiz._id}:`, err);
        }
        return {
          ...quiz,
          questionCount: questions.length,
          phase1Count: questions.filter((q) => q.phase === 1).length,
          phase2Count: questions.filter((q) => q.phase === 2).length,
          phase3Count: questions.filter((q) => q.phase === 3).length,
        };
      })
    );

    res.json({ success: true, quizzes: overview });
  } catch (error) {
    console.error("Error building student quiz overview:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Role-aware quiz calendar. Students receive only published windows for their
 * enrolled sections; instructors receive schedules for sections they own.
 */
const getQuizCalendarHandler = async (req, res) => {
  try {
    const { courseId } = req.params;
    const range = quizCalendarService.parseCalendarRange(req.query.from, req.query.to);
    if (range.error) {
      return res.status(400).json({ success: false, error: range.error });
    }
    if (!(await canAccessCourse(req, courseId))) {
      return res.status(403).json({ success: false, error: "You are not a member of this course" });
    }

    const userId = getRequestUserId(req);
    const studentAudience = !(await hasStaffAccessInCourse(req.user, courseId));
    const allQuizzes = await quizService.getQuizzesByCourse(courseId);
    const quizzes = studentAudience
      ? allQuizzes.filter((quiz) => quiz.published === true)
      : allQuizzes;

    const sections = studentAudience
      ? await sectionService.getCourseSections(courseId)
      : await sectionService.getSectionsOwnedByUser(courseId, userId);
    const sectionIds = studentAudience
      ? await quizScheduleService.getStudentSectionObjectIds(userId, courseId)
      : sections.map((section) => section._id.toString());

    if (sectionIds.length === 0 || quizzes.length === 0) {
      const unscheduledQuizzes = studentAudience
        ? []
        : quizzes.filter((quiz) => quiz.published === true).map((quiz) => ({
            id: String(quiz._id || quiz.id),
            name: quiz.name || "Unnamed Quiz",
          }));
      return res.json({
        success: true,
        audience: studentAudience ? "student" : "instructor",
        events: [],
        unscheduledQuizzes,
      });
    }

    const quizIds = quizzes.map((quiz) => String(quiz._id || quiz.id));
    const schedulesByQuiz = await quizScheduleService.getSchedulesForQuizzes(quizIds, sectionIds);
    const completedQuizIds = studentAudience
      ? await quizService.getUserScoresForCourse(userId, courseId)
      : [];
    const sectionsById = new Map(sections.map((section) => [section._id.toString(), section]));
    const events = quizCalendarService.buildCalendarEvents({
      quizzes,
      schedulesByQuiz,
      sectionsById,
      completedQuizIds,
      audience: studentAudience ? "student" : "instructor",
      from: range.from,
      to: range.to,
    });

    const scheduledQuizIds = new Set(schedulesByQuiz.keys());
    const unscheduledQuizzes = studentAudience
      ? []
      : quizzes
          .filter((quiz) => quiz.published === true)
          .filter((quiz) => !scheduledQuizIds.has(String(quiz._id || quiz.id)))
          .map((quiz) => ({ id: String(quiz._id || quiz.id), name: quiz.name || "Unnamed Quiz" }));

    res.json({
      success: true,
      audience: studentAudience ? "student" : "instructor",
      events,
      unscheduledQuizzes,
    });
  } catch (error) {
    console.error("Error fetching quiz calendar:", error);
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
    const {
      courseId,
      name,
      description,
      deliveryFormat,
      disablePreviousNavigation,
      timeLimitMinutes,
      questionIds,
      newQuestions
    } = req.body;

    if (!courseId || !name || !deliveryFormat) {
      return res.status(400).json({
        success: false,
        error: "Course ID, name, and deliveryFormat are required",
      });
    }

    if (deliveryFormat !== "all-approved" && deliveryFormat !== "spaced-3phase") {
      return res.status(400).json({
        success: false,
        error: "Invalid deliveryFormat. Must be 'all-approved' or 'spaced-3phase'.",
      });
    }

    if (!isBooleanIfPresent(disablePreviousNavigation)) {
      return res.status(400).json({
        success: false,
        error: "disablePreviousNavigation must be a boolean.",
      });
    }

    if (timeLimitMinutes !== undefined && (!Number.isInteger(Number(timeLimitMinutes)) || Number(timeLimitMinutes) <= 0)) {
      return res.status(400).json({
        success: false,
        error: "timeLimitMinutes must be a positive whole number.",
      });
    }

    if (!await isFaculty(req.user) && !await isUserInCourse(req.user._id || req.user.id, courseId)) {
      return res.status(403).json({ success: false, error: "You are not a member of this course" });
    }
    if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.CREATE_QUIZ))) return;

    const quiz = await quizService.createQuiz(courseId, {
      name,
      description,
      deliveryFormat,
      disablePreviousNavigation,
      timeLimitMinutes: timeLimitMinutes === undefined ? undefined : Number(timeLimitMinutes)
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
    const { name, description, published, deliveryFormat, disablePreviousNavigation, timeLimitMinutes } = req.body;

    if (deliveryFormat !== undefined && deliveryFormat !== "all-approved" && deliveryFormat !== "spaced-3phase") {
      return res.status(400).json({
        success: false,
        error: "Invalid deliveryFormat. Must be 'all-approved' or 'spaced-3phase'."
      });
    }

    if (!isBooleanIfPresent(disablePreviousNavigation)) {
      return res.status(400).json({
        success: false,
        error: "disablePreviousNavigation must be a boolean."
      });
    }

    if (timeLimitMinutes !== undefined && (!Number.isInteger(Number(timeLimitMinutes)) || Number(timeLimitMinutes) <= 0)) {
      return res.status(400).json({ success: false, error: "timeLimitMinutes must be a positive whole number." });
    }

    // Get existing quiz to check current values
    const existingQuiz = await quizService.getQuizById(quizId);
    if (!existingQuiz) {
      return res.status(404).json({ success: false, error: "Quiz not found" });
    }

    if (!await isFaculty(req.user) && !await isUserInCourse(req.user._id || req.user.id, existingQuiz.courseId)) {
      return res.status(403).json({ success: false, error: "You are not a member of this course" });
    }

    const result = await quizService.updateQuiz(quizId, {
      name,
      description,
      published,
      deliveryFormat,
      disablePreviousNavigation,
      timeLimitMinutes: timeLimitMinutes === undefined ? undefined : Number(timeLimitMinutes)
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
    const { quizId } = req.params;
    const quizToDelete = await quizService.getQuizById(quizId);
    if (!quizToDelete) {
      return res.status(404).json({ success: false, error: "Quiz not found" });
    }

    if (!await isFaculty(req.user) && !await isUserInCourse(req.user._id || req.user.id, quizToDelete.courseId)) {
      return res.status(403).json({ success: false, error: "You are not a member of this course" });
    }

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
      return res.status(400).json({ success: false, error: "Course ID is required" });
    }

    if (!await isFaculty(req.user) && !await isUserInCourse(req.user._id || req.user.id, courseId)) {
      return res.status(403).json({ success: false, error: "You are not a member of this course" });
    }
    if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.CREATE_QUIZ))) return;

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
    // Practice rounds re-attempt previously-wrong questions for learning only:
    // they are graded for feedback but never persisted, so they can't affect
    // the score, mastery, or achievements, and aren't bound by the deadline.
    // Only honored after the graded attempt is complete — otherwise a student
    // could send practice checks during the graded attempt to probe for the
    // revealed correct answer without recording anything.
    const practice =
      req.body.practice === true &&
      !!userId &&
      (await quizService.hasCompletedQuiz(userId, quizId));

    // The UI submits automatically at expiry, but this server-side check is
    // authoritative and prevents delayed requests from recording new answers.
    if (userId && !practice) {
      const session = await quizSessionService.getSession(userId, quizId);
      if (quizSessionService.isExpired(session)) {
        return res.status(409).json({
          success: false,
          code: "QUIZ_TIME_EXPIRED",
          error: "The time limit for this quiz has expired. Your saved answers are being submitted.",
        });
      }
    }

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
      if (userId && quizId && !practice) {
        // Awaited: if the attempt can't be persisted, fail the request so the
        // client retries instead of showing a verdict that was never recorded.
        await quizService.saveStudentPerformance({
          userId: String(userId), quizId: String(quizId), questionId: String(questionId),
          learningObjectiveId: question.learningObjectiveId,
          granularObjectiveId: question.granularObjectiveId,
          bloom: question.bloom,
          questionType: QUESTION_TYPES.CALCULATION,
          isCorrect,
          selectedAnswer: String(answerText).trim(),
          correctAnswer: displayCorrect,
          correctOptionText: displayCorrect,
        });
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

      // LLM judge: rubric + sample → { pass, overallFeedback, per-criterion }.
      // On failure the attempt degrades to the pre-LLM behavior — saved
      // ungraded (isCorrect: null) for manual grading in the review modal.
      let grading = null;
      try {
        const quiz = await quizService.getQuizById(quizId);
        grading = await answerGradingService.gradeOpenEndedAnswer({
          courseId: quiz ? quiz.courseId : null,
          question: String(question.question || question.stem || ""),
          studentAnswer: String(answerText).trim(),
          sampleAnswer: sample,
          gradingCriteria: criteria,
        });
      } catch (e) {
        console.error('[check] Open-ended LLM grading failed — leaving attempt for manual grading:', e);
      }

      if (userId && quizId && !practice) {
        await quizService.saveStudentPerformance({
          userId: String(userId), quizId: String(quizId), questionId: String(questionId),
          learningObjectiveId: question.learningObjectiveId,
          granularObjectiveId: question.granularObjectiveId,
          bloom: question.bloom,
          questionType: QUESTION_TYPES.OPEN_ENDED,
          isCorrect: grading ? grading.pass : null,
          selectedAnswer: String(answerText).trim(),
          sampleAnswer: sample,
          gradingCriteria: criteria || null,
          feedbackText: grading ? grading.overallFeedback : null,
          aiGraded: !!grading,
          aiCriteria: grading ? grading.criteria : null,
        });
      }
      res.json({
        success: true,
        isCorrect: grading ? grading.pass : null,
        autoGraded: !!grading,
        feedback: grading ? grading.overallFeedback : "",
        criteria: grading ? grading.criteria : null,
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
      let isCorrect = normalizedAcceptable.length > 0 && normalizedAcceptable.some((a) => a === given);
      const canonical = trimmedCanonical;

      // LLM fallback (rescue only): an exact match never reaches the LLM and is
      // never downgraded. On mismatch the judge may flip the answer to correct
      // (equivalent meaning/notation) and always returns student-facing
      // feedback. On LLM failure the exact-match verdict stands.
      let feedback = isCorrect ? "Correct." : "";
      let aiGraded = false;
      if (!isCorrect && given && normalizedAcceptable.length > 0) {
        try {
          const quiz = await quizService.getQuizById(quizId);
          const rescue = await answerGradingService.gradeFillInTheBlankAnswer({
            courseId: quiz ? quiz.courseId : null,
            question: String(question.question || question.stem || ""),
            studentAnswer: String(answerText).trim(),
            correctAnswer: canonical,
            acceptableAnswers: Array.isArray(question.acceptableAnswers) ? question.acceptableAnswers : [],
          });
          aiGraded = true;
          if (rescue.correct) isCorrect = true;
          if (rescue.feedback) feedback = rescue.feedback;
        } catch (e) {
          console.error('[check] Fill-in-the-blank LLM fallback failed — keeping exact-match result:', e);
        }
      }

      if (userId && quizId && !practice) {
        await quizService.saveStudentPerformance({
          userId: String(userId), quizId: String(quizId), questionId: String(questionId),
          learningObjectiveId: question.learningObjectiveId,
          granularObjectiveId: question.granularObjectiveId,
          bloom: question.bloom,
          questionType: QUESTION_TYPES.FILL_IN_THE_BLANK,
          isCorrect,
          selectedAnswer: String(answerText).trim(),
          correctAnswer: isCorrect ? canonical : null,
          correctOptionText: canonical || null,
          feedbackText: aiGraded ? feedback : null,
          aiGraded,
        });
      }
      res.json({
        success: true,
        isCorrect,
        feedback,
        aiGraded,
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

    if (userId && quizId && !practice) {
      await quizService.saveStudentPerformance({
        userId: String(userId), quizId: String(quizId), questionId: String(questionId),
        learningObjectiveId: question.learningObjectiveId,
        granularObjectiveId: question.granularObjectiveId,
        bloom: question.bloom,
        questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
        isCorrect,
        selectedAnswer: selectedKey,
        correctAnswer: correctAnswerLetter,
        correctOptionText,
        feedbackText: feedback,
      });
    }
    res.json({
      success: true,
      isCorrect,
      feedback,
      correctAnswer: correctAnswerLetter,
      correctOptionText
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

    const quiz = await quizService.getQuizById(quizId);
    if (!quiz) return res.status(404).json({ success: false, error: "Quiz not found" });

    if (!(await hasStaffAccessInCourse(req.user, quiz.courseId))) {
      return res.status(403).json({ success: false, error: "Staff access is not granted in this course" });
    }
    if (!(await assertTaPermission(req, res, quiz.courseId, TA_PERMISSION_KEYS.QUIZ_SCORES))) return;

    let scores = await quizService.getQuizScores(quizId);
    if (!scores) {
      return res.status(404).json({ success: false, error: "Scores not found" });
    }

    // Scope to the sections this viewer may see: the course owner and app
    // administrators see all; any other instructor sees only their own sections.
    const { seeAll, sections } = await sectionService.getSectionsForViewer(quiz.courseId, req.user);
    if (!seeAll) {
      const visible = new Set(sections.map((s) => s.sectionId));
      scores = scores.filter(
        (row) => Array.isArray(row.sections) && row.sections.some((id) => visible.has(id))
      );
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

    const quiz = await quizService.getQuizById(quizId);
    if (!quiz) return res.status(404).json({ success: false, error: "Quiz not found" });

    if (!(await hasStaffAccessInCourse(req.user, quiz.courseId))) {
      return res.status(403).json({ success: false, error: "Staff access is not granted in this course" });
    }
    if (!(await assertTaPermission(req, res, quiz.courseId, TA_PERMISSION_KEYS.QUIZ_SCORES))) return;

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
 * Grade/override an open-ended or AI-graded fill-in-the-blank attempt for a
 * specific student (Faculty only).
 */
const gradeAttemptHandler = async (req, res) => {
  try {
    const { quizId, userId } = req.params;
    const { questionId, isCorrect } = req.body;

    if (typeof isCorrect !== 'boolean') {
      return res.status(400).json({ success: false, error: 'isCorrect must be a boolean' });
    }
    if (!questionId) {
      return res.status(400).json({ success: false, error: 'questionId is required' });
    }

    const result = await quizService.gradeAttempt(userId, quizId, questionId, isCorrect);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error grading attempt:', error);
    const status = error.message === 'Attempt not found' ? 404
      : error.message === 'Attempt has already been graded' ? 409
      : 500;
    res.status(status).json({ success: false, error: error.message });
  }
};

/**
 * Record the current student's accept/deny reaction to the AI grade on one of
 * their own attempts (issue #76). The userId always comes from the session —
 * never a param — so a student can only mark their own answers.
 */
const recordGradeReviewHandler = async (req, res) => {
  try {
    const { quizId, questionId } = req.params;
    const { review } = req.body;
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (review !== 'accept' && review !== 'deny') {
      return res.status(400).json({ success: false, error: "review must be 'accept' or 'deny'" });
    }

    const result = await quizService.recordStudentGradeReview(userId, quizId, questionId, review);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error recording student grade review:', error);
    const status = error.message === 'Attempt not found' ? 404
      : error.message === 'Attempt is not AI-graded' ? 400
      : error.message === 'Grade already finalized' ? 409
      : error.message === 'Invalid grade review' ? 400
      : 500;
    res.status(status).json({ success: false, error: error.message });
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

/**
 * Get the per-section release/expire schedule for a quiz (instructor editor).
 */
const getQuizSchedulesHandler = async (req, res) => {
  try {
    const { quizId } = req.params;
    const quiz = await quizService.getQuizById(quizId);
    if (!quiz) {
      return res.status(404).json({ success: false, error: "Quiz not found" });
    }
    if (!await isFaculty(req.user) && !await isUserInCourse(req.user._id || req.user.id, quiz.courseId)) {
      return res.status(403).json({ success: false, error: "You are not a member of this course" });
    }
    const schedules = await quizScheduleService.getSchedulesForQuiz(quizId);
    res.json({ success: true, schedules });
  } catch (error) {
    console.error("Error fetching quiz schedules:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Replace a quiz's per-section release/expire schedule (instructor editor).
 */
const updateQuizSchedulesHandler = async (req, res) => {
  try {
    const { quizId } = req.params;
    const { schedules } = req.body;

    if (!Array.isArray(schedules)) {
      return res.status(400).json({ success: false, error: "schedules must be an array" });
    }

    const quiz = await quizService.getQuizById(quizId);
    if (!quiz) {
      return res.status(404).json({ success: false, error: "Quiz not found" });
    }
    if (!await isFaculty(req.user) && !await isUserInCourse(req.user._id || req.user.id, quiz.courseId)) {
      return res.status(403).json({ success: false, error: "You are not a member of this course" });
    }

    for (const row of schedules) {
      if (row && row.releaseDate && row.expireDate && new Date(row.expireDate) <= new Date(row.releaseDate)) {
        return res.status(400).json({
          success: false,
          error: "Each section's expire date must be after its release date.",
        });
      }
    }

    // Instructors (the course owner included) may only schedule the sections they
    // own. Reject any section outside that set, and scope the update so other
    // instructors' schedules are preserved.
    const ownedSections = await sectionService.getSectionsOwnedByUser(
      quiz.courseId,
      req.user._id || req.user.id
    );
    const ownedSectionIds = ownedSections.map((s) => s._id.toString());
    const ownedSet = new Set(ownedSectionIds);
    const unauthorized = schedules.some(
      (row) => row && row.courseSectionId && !ownedSet.has(row.courseSectionId.toString())
    );
    if (unauthorized) {
      return res.status(403).json({
        success: false,
        error: "You can only schedule quizzes for sections you own.",
      });
    }

    const updated = await quizScheduleService.setSchedules(quizId, schedules, {
      restrictToSectionIds: ownedSectionIds,
    });
    res.json({ success: true, schedules: updated });
  } catch (error) {
    console.error("Error updating quiz schedules:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getQuizzesByCourseHandler,
  getQuizzesByCourseWithQuestionsHandler,
  getStudentQuizOverviewHandler,
  getQuizCalendarHandler,
  saveStudentQuestionFlagHandler,
  getMyQuestionFlagsHandler,
  getCourseQuestionFlagsHandler,
  updateQuestionFlagStatusHandler,
  getQuizSchedulesHandler,
  updateQuizSchedulesHandler,
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
  getStudentQuizAttemptHandler,
  gradeAttemptHandler,
  recordGradeReviewHandler
};
