const { ObjectId } = require("mongodb");
const analyticsService = require("../services/analytics");
const quizService = require("../services/quiz");
const { hasStaffAccessInCourse } = require("../utils/course-access");
const { isFaculty } = require("../utils/auth");
const { CSV_BUILDERS } = require("../utils/analytics-csv");

/**
 * Analytics are faculty-only: staff and TAs are refused outright (this is not
 * one of the instructor-configurable TA permissions). The /api/analytics mount
 * already requires faculty; the check is repeated here so the controller does
 * not depend on how it is mounted. Sends the error response and returns false
 * when access is denied.
 */
async function assertAnalyticsAccess(req, res, courseId) {
  if (!ObjectId.isValid(courseId)) {
    res.status(400).json({ success: false, error: "Invalid course id" });
    return false;
  }
  if (!(await isFaculty(req.user))) {
    res.status(403).json({ success: false, error: "Analytics are available to faculty only" });
    return false;
  }
  if (!(await hasStaffAccessInCourse(req.user, courseId))) {
    res.status(403).json({ success: false, error: "Staff access is not granted in this course" });
    return false;
  }
  return true;
}

/**
 * Resolves the optional quizId / sectionId filters. Sends the error response
 * and returns null when a filter is invalid or out of the viewer's reach.
 */
async function resolveFilters(req, res, courseId) {
  const quizId = req.query.quizId ? String(req.query.quizId) : null;
  const sectionId = req.query.sectionId ? String(req.query.sectionId) : null;

  let quiz = null;
  if (quizId) {
    quiz = ObjectId.isValid(quizId) ? await quizService.getQuizById(quizId) : null;
    if (!quiz || String(quiz.courseId) !== String(courseId)) {
      res.status(404).json({ success: false, error: "Quiz not found in this course" });
      return null;
    }
  }

  if (sectionId && !(await analyticsService.canViewSection(courseId, req.user, sectionId))) {
    res.status(403).json({ success: false, error: "You cannot view analytics for this section" });
    return null;
  }

  return { quizId, sectionId, quiz };
}

/**
 * How each analytics view gathers its data: which cohort shape it needs and
 * which service call summarizes it.
 */
const VIEWS = {
  questions: {
    label: "question",
    load: async (courseId, user, { quizId, sectionId }) => {
      const studentIds = await analyticsService.getCohortStudentIds(courseId, user, { sectionId });
      const data = await analyticsService.getQuestionAnalytics(courseId, { quizId, studentIds });
      return { ...data, cohortSize: studentIds.length };
    },
  },
  quizzes: {
    label: "quiz",
    load: async (courseId, user, { quizId, sectionId }) => {
      const students = await analyticsService.getCohortStudents(courseId, user, { sectionId });
      const data = await analyticsService.getQuizAnalytics(courseId, { quizId, students });
      return { ...data, cohortSize: students.length };
    },
  },
  objectives: {
    label: "objective",
    load: async (courseId, user, { quizId, sectionId }) => {
      const studentIds = await analyticsService.getCohortStudentIds(courseId, user, { sectionId });
      const data = await analyticsService.getObjectiveAnalytics(courseId, { quizId, studentIds });
      return { ...data, cohortSize: studentIds.length };
    },
  },
};

/**
 * Access check, filters, then the view's data. Sends the error response and
 * returns null when the request cannot be served.
 */
async function loadView(viewName, req, res) {
  const { courseId } = req.params;
  if (!(await assertAnalyticsAccess(req, res, courseId))) return null;

  const filters = await resolveFilters(req, res, courseId);
  if (!filters) return null;

  const data = await VIEWS[viewName].load(courseId, req.user, filters);
  return { data, filters };
}

const viewHandler = (viewName) => async (req, res) => {
  try {
    const loaded = await loadView(viewName, req, res);
    if (!loaded) return;
    res.json({ success: true, data: loaded.data });
  } catch (error) {
    console.error(`Error fetching ${VIEWS[viewName].label} analytics:`, error);
    res.status(500).json({ success: false, error: `Failed to load ${VIEWS[viewName].label} analytics` });
  }
};

/**
 * GET /api/analytics/course/:courseId/questions?quizId=&sectionId=
 * Class-level difficulty and most-missed statistics per question.
 */
const getQuestionAnalyticsHandler = viewHandler("questions");

/**
 * GET /api/analytics/course/:courseId/quizzes?quizId=&sectionId=
 * Class-level completion and score distribution per quiz.
 */
const getQuizAnalyticsHandler = viewHandler("quizzes");

/**
 * GET /api/analytics/course/:courseId/objectives?quizId=&sectionId=
 * Class-level correctness, mastery and remediation per learning objective.
 */
const getObjectiveAnalyticsHandler = viewHandler("objectives");

const slug = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/**
 * GET /api/analytics/course/:courseId/export/:view?quizId=&sectionId=
 * The same view as a CSV download: the same figures, withheld the same way.
 */
const exportAnalyticsHandler = async (req, res) => {
  const viewName = req.params.view;
  if (!Object.prototype.hasOwnProperty.call(VIEWS, viewName)) {
    return res.status(404).json({ success: false, error: "Unknown analytics view" });
  }
  try {
    const loaded = await loadView(viewName, req, res);
    if (!loaded) return;

    const { quiz, sectionId } = loaded.filters;
    const filename = [
      "analytics",
      viewName,
      quiz && `quiz-${slug(quiz.name) || "untitled"}`,
      sectionId && `section-${slug(sectionId)}`,
      new Date().toISOString().slice(0, 10),
    ].filter(Boolean).join("-");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    res.send(CSV_BUILDERS[viewName](loaded.data));
  } catch (error) {
    console.error(`Error exporting ${viewName} analytics:`, error);
    res.status(500).json({ success: false, error: "Failed to export analytics" });
  }
};

module.exports = {
  assertAnalyticsAccess,
  getQuestionAnalyticsHandler,
  getQuizAnalyticsHandler,
  getObjectiveAnalyticsHandler,
  exportAnalyticsHandler,
};
