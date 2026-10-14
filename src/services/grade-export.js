// Gathers what the grade CSV (issue #126, src/utils/grade-csv.js) needs for one
// section: the published quizzes scheduled on it, its students, and their
// recorded scores. Makes no Canvas calls; a Canvas user id is only included
// when a roster sync already stored one.

const { ObjectId } = require('mongodb');
const databaseService = require('./database');
const quizScheduleService = require('./quiz-schedule');
const { resolveCourseRole } = require('../utils/course-access');
const { isFaculty } = require('../utils/auth');
const { currentLmsInstance } = require('../lms/instance');
const { buildGradeCsv } = require('../utils/grade-csv');

const toObjectId = (id) =>
  typeof id === 'string' && ObjectId.isValid(id) ? new ObjectId(id) : id;

// Membership and score documents have stored ids both as ObjectIds and as
// strings over time; match either.
const eitherForm = (ids) => {
  const all = [];
  for (const id of ids) {
    all.push(String(id));
    if (ObjectId.isValid(String(id))) all.push(new ObjectId(String(id)));
  }
  return all;
};

/**
 * A quiz's state for a section at `now`.
 * @returns {'closed'|'open'|'upcoming'}
 */
function quizStatus(schedule, now) {
  if (now < new Date(schedule.releaseDate)) return 'upcoming';
  if (now > new Date(schedule.expireDate)) return 'closed';
  return 'open';
}

/**
 * Published quizzes scheduled on the section, in release order.
 * @param {string} courseId
 * @param {Object} section - grasp_course_section document
 * @param {Date} [now]
 * @returns {Promise<Array<{id: string, name: string, status: string, releaseDate: Date, expireDate: Date}>>}
 */
async function getSectionQuizzes(courseId, section, now = new Date()) {
  const schedules = await quizScheduleService.getSchedulesForSection(section._id);
  if (schedules.length === 0) return [];
  const scheduleByQuiz = new Map(schedules.map((row) => [row.quizId, row]));

  const db = await databaseService.connect();
  const quizzes = await db
    .collection('grasp_quiz')
    .find({
      _id: { $in: schedules.map((row) => toObjectId(row.quizId)) },
      courseId: toObjectId(courseId),
      published: true,
    })
    .project({ name: 1, createdAt: 1 })
    .toArray();

  return quizzes
    .map((quiz) => {
      const schedule = scheduleByQuiz.get(quiz._id.toString());
      return {
        id: quiz._id.toString(),
        name: quiz.name || 'Untitled quiz',
        status: quizStatus(schedule, now),
        releaseDate: schedule.releaseDate,
        expireDate: schedule.expireDate,
        createdAt: quiz.createdAt,
      };
    })
    .sort(
      (a, b) =>
        new Date(a.releaseDate) - new Date(b.releaseDate) ||
        new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
    )
    .map(({ createdAt, ...quiz }) => quiz);
}

/**
 * Recorded scores of the given students on the given quizzes.
 * @returns {Promise<Map<string, Map<string, {score: number, correctAnswers: number,
 *   totalQuestions: number}>>>} userId -> quizId -> score
 */
async function getScores(quizIds, userIds) {
  const byUser = new Map();
  if (quizIds.length === 0 || userIds.length === 0) return byUser;
  const db = await databaseService.connect();
  const rows = await db
    .collection('grasp_quiz_score')
    .find({ quizId: { $in: eitherForm(quizIds) }, userId: { $in: eitherForm(userIds) } })
    .project({ quizId: 1, userId: 1, score: 1, correctAnswers: 1, totalQuestions: 1 })
    .toArray();
  for (const row of rows) {
    const userId = String(row.userId);
    if (!byUser.has(userId)) byUser.set(userId, new Map());
    byUser.get(userId).set(String(row.quizId), {
      score: Number(row.score),
      correctAnswers: Number(row.correctAnswers),
      totalQuestions: Number(row.totalQuestions),
    });
  }
  return byUser;
}

/**
 * AI grades the students disputed that no instructor has settled yet, per quiz
 * (the "Needs review" flag on Quiz Scores, issue #76).
 * @returns {Promise<Map<string, number>>} quizId -> count
 */
async function countGradesAwaitingReview(quizIds, userIds) {
  if (quizIds.length === 0 || userIds.length === 0) return new Map();
  const db = await databaseService.connect();
  const rows = await db
    .collection('grasp_student_attempt')
    .aggregate([
      {
        $match: {
          quizId: { $in: eitherForm(quizIds) },
          userId: { $in: eitherForm(userIds) },
          studentGradeReview: 'deny',
          gradedAt: { $exists: false },
          isFirstAttempt: { $ne: false },
        },
      },
      { $group: { _id: '$quizId', count: { $sum: 1 } } },
    ])
    .toArray();
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

/**
 * The section's students, with the identifiers the CSV carries. A member whose
 * role in the course is not student (a TA, an instructor) is left out unless
 * they have a score on one of the quizzes: as on Quiz Scores, a recorded score
 * is never dropped because role resolution misread a work-learn student.
 * @returns {Promise<Array<{userId: string, name: string, puid: string,
 *   canvasUserId: string, loginId: string}>>}
 */
async function getSectionStudents(courseId, section, quizIds) {
  const db = await databaseService.connect();
  const enrollments = await db
    .collection('grasp_user_course_section')
    .find({ courseId: toObjectId(courseId), sectionId: section.sectionId, droppedAt: null })
    .project({ userId: 1 })
    .toArray();
  const userIds = [...new Set(enrollments.map((row) => String(row.userId)))];
  if (userIds.length === 0) return [];

  const [users, memberships, scores] = await Promise.all([
    db
      .collection('grasp_user')
      .find({ _id: { $in: userIds.map(toObjectId) } })
      .project({
        puid: 1,
        legalName: 1,
        displayName: 1,
        email: 1,
        affiliation: 1,
        staffViaTaPromotion: 1,
        lmsAccounts: 1,
      })
      .toArray(),
    db
      .collection('grasp_user_course')
      .find({ courseId: { $in: eitherForm([courseId]) }, userId: { $in: eitherForm(userIds) } })
      .project({ userId: 1, courseRole: 1 })
      .toArray(),
    getScores(quizIds, userIds),
  ]);
  const membershipByUser = new Map(memberships.map((m) => [String(m.userId), m]));

  // The Canvas account that belongs to this section: the linked section's
  // deployment, else the one GRASP is configured for.
  const instance =
    (section.lmsLink?.provider === 'canvas' && section.lmsLink.instance) ||
    currentLmsInstance('canvas');

  const students = [];
  for (const user of users) {
    const userId = user._id.toString();
    const membership = membershipByUser.get(userId) || null;
    const role = resolveCourseRole(user, membership, await isFaculty(user));
    if (role !== 'student' && !scores.has(userId)) continue;

    const canvas = (user.lmsAccounts || []).find(
      (account) => account.provider === 'canvas' && instance && account.instance === instance
    );
    students.push({
      userId,
      name: user.legalName || user.displayName || user.email || user.puid || 'Unknown Student',
      puid: user.puid || '',
      canvasUserId: canvas?.externalUserId || '',
      loginId: canvas?.loginId || '',
      scores: scores.get(userId) || new Map(),
    });
  }
  return students.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What the download dialog shows for a section: its quizzes with their state
 * and how many disputed AI grades each still has.
 */
async function getSectionGradeOverview(courseId, section, now = new Date()) {
  const quizzes = await getSectionQuizzes(courseId, section, now);
  const quizIds = quizzes.map((quiz) => quiz.id);
  const students = await getSectionStudents(courseId, section, quizIds);
  const awaiting = await countGradesAwaitingReview(
    quizIds,
    students.map((student) => student.userId)
  );
  return {
    studentCount: students.length,
    quizzes: quizzes.map((quiz) => ({ ...quiz, gradesAwaitingReview: awaiting.get(quiz.id) || 0 })),
  };
}

/**
 * The CSV for the chosen quizzes of a section. Ids that aren't published
 * quizzes scheduled on the section are ignored.
 * @param {Object} [options]
 * @param {boolean} [options.includeQuestionsCorrect] - Add each quiz's "4 of 5" column
 * @param {Date} [options.now]
 * @returns {Promise<{csv: string, quizCount: number, studentCount: number}>}
 */
async function buildSectionGradeCsv(
  courseId,
  section,
  quizIds,
  { includeQuestionsCorrect = false, now = new Date() } = {}
) {
  const wanted = new Set(quizIds.map(String));
  const quizzes = (await getSectionQuizzes(courseId, section, now)).filter((quiz) =>
    wanted.has(quiz.id)
  );
  const students = await getSectionStudents(
    courseId,
    section,
    quizzes.map((quiz) => quiz.id)
  );
  const sectionLabel = section.sectionNumber || section.sectionId;
  const csv = buildGradeCsv({
    quizzes,
    students: students.map((student) => ({ ...student, section: sectionLabel })),
    includeQuestionsCorrect,
  });
  return { csv, quizCount: quizzes.length, studentCount: students.length };
}

module.exports = {
  buildSectionGradeCsv,
  getSectionGradeOverview,
  getSectionQuizzes,
  getSectionStudents,
  quizStatus,
};
