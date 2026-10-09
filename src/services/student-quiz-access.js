const quizScheduleService = require('./quiz-schedule');
const quizSessionService = require('./quiz-session');
const { hasStaffAccessInCourse } = require('../utils/course-access');

// A student who started a quiz inside its window keeps access to their
// in-progress attempt after the window closes or is shifted later: recorded
// answers exist (answers are only recordable while the quiz is open) but no
// final score has been saved yet. Lets them resume/submit so started-in-time
// progress is never lost.
const hasUnsubmittedAttempt = async (userId, quizId) =>
  (await quizSessionService.getUnsubmittedQuizIds(userId, [quizId])).has(quizId);

// Resolve whether a student may access a quiz right now, based on the
// release/expire window of the section(s) they belong to. Students with no
// section assignment, or whose section has no schedule for this quiz, are
// blocked. A quiz is open if ANY of the student's scheduled sections is open.
// Shared by the student quiz page and the answer check (issue #168).
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
    // Grace path: the quiz was shifted later after the student started.
    if (await hasUnsubmittedAttempt(userId, quiz._id.toString())) {
      return { success: true, scheduledExpiresAt: window.expireDate || null };
    }
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

module.exports = {
  resolveStudentQuizAccess,
};
