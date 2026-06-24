const databaseService = require('./database');
const sectionService = require('./course-section');
const { ObjectId } = require('mongodb');

const COLLECTION = 'grasp_quiz_section_schedule';

const toObjectId = (id) =>
  typeof id === 'string' && ObjectId.isValid(id) ? new ObjectId(id) : id;

const toDateOrNull = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * All per-section schedule rows for a quiz (instructor editor view).
 * @returns {Promise<Array<{courseSectionId: string, releaseDate: Date, expireDate: Date}>>}
 */
const getSchedulesForQuiz = async (quizId) => {
  const db = await databaseService.connect();
  const rows = await db
    .collection(COLLECTION)
    .find({ quizId: toObjectId(quizId) })
    .toArray();
  return rows.map((r) => ({
    courseSectionId: r.courseSectionId.toString(),
    releaseDate: r.releaseDate,
    expireDate: r.expireDate,
  }));
};

/**
 * Replace a quiz's per-section schedule with the supplied rows. Rows with both a
 * release and expire date are upserted; any existing row for a section NOT
 * present (or missing a date) in the payload is removed — so clearing a
 * section's dates makes the quiz unavailable to that section.
 *
 * @param {string} quizId
 * @param {Array<{courseSectionId: string, releaseDate: string|Date, expireDate: string|Date}>} rows
 */
const setSchedules = async (quizId, rows = []) => {
  const db = await databaseService.connect();
  const collection = db.collection(COLLECTION);
  const qid = toObjectId(quizId);

  const keep = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const courseSectionId = row && row.courseSectionId;
    const releaseDate = toDateOrNull(row && row.releaseDate);
    const expireDate = toDateOrNull(row && row.expireDate);
    if (!courseSectionId || !releaseDate || !expireDate) continue;

    const sid = toObjectId(courseSectionId);
    keep.push(sid);
    await collection.updateOne(
      { quizId: qid, courseSectionId: sid },
      {
        $set: { releaseDate, expireDate, updatedAt: new Date() },
        $setOnInsert: { quizId: qid, courseSectionId: sid, createdAt: new Date() },
      },
      { upsert: true }
    );
  }

  // Drop rows for sections the instructor cleared / omitted.
  await collection.deleteMany({
    quizId: qid,
    courseSectionId: { $nin: keep },
  });

  return getSchedulesForQuiz(quizId);
};

/**
 * Schedule rows for a set of quizzes, limited to the given section ids, grouped
 * by quizId (student overview path).
 * @returns {Promise<Map<string, Array<{courseSectionId: string, releaseDate: Date, expireDate: Date}>>>}
 */
const getSchedulesForQuizzes = async (quizIds = [], courseSectionIds = []) => {
  if (!quizIds.length || !courseSectionIds.length) return new Map();
  const db = await databaseService.connect();
  const rows = await db
    .collection(COLLECTION)
    .find({
      quizId: { $in: quizIds.map(toObjectId) },
      courseSectionId: { $in: courseSectionIds.map(toObjectId) },
    })
    .toArray();

  const byQuiz = new Map();
  for (const r of rows) {
    const key = r.quizId.toString();
    if (!byQuiz.has(key)) byQuiz.set(key, []);
    byQuiz.get(key).push({
      courseSectionId: r.courseSectionId.toString(),
      releaseDate: r.releaseDate,
      expireDate: r.expireDate,
    });
  }
  return byQuiz;
};

/**
 * Translate the section(s) a student belongs to in a course (stored by the
 * `sectionId` string in grasp_user_course_section) into the section document
 * `_id`s that schedule rows key on. Returns `[]` if the student has no section.
 */
const getStudentSectionObjectIds = async (userId, courseId) => {
  if (!userId || !courseId) return [];
  const memberships = await sectionService.getUserCourseSections(userId, courseId);
  const mySectionIds = new Set(memberships.map((m) => m.sectionId));
  if (mySectionIds.size === 0) return [];
  const sections = await sectionService.getCourseSections(courseId);
  return sections
    .filter((s) => mySectionIds.has(s.sectionId))
    .map((s) => s._id.toString());
};

/** Remove all schedule rows pointing at a section (recycle cleanup). */
const removeSchedulesForSection = async (courseSectionId) => {
  const db = await databaseService.connect();
  return db.collection(COLLECTION).deleteMany({ courseSectionId: toObjectId(courseSectionId) });
};

/** Remove all schedule rows for a quiz (quiz-delete cleanup). */
const removeSchedulesForQuiz = async (quizId) => {
  const db = await databaseService.connect();
  return db.collection(COLLECTION).deleteMany({ quizId: toObjectId(quizId) });
};

/**
 * Resolve a student's effective availability window for one quiz from the
 * supplied schedule rows and the section ids the student belongs to.
 *
 * @param {Array<{courseSectionId: string, releaseDate: Date, expireDate: Date}>} rows
 * @param {string[]} studentCourseSectionIds
 * @param {Date} [now]
 * @returns {{accessibleNow: boolean, releaseDate: Date|null, expireDate: Date|null, reason: 'open'|'not-scheduled'|'not-yet'|'expired'}}
 */
const resolveWindow = (rows = [], studentCourseSectionIds = [], now = new Date()) => {
  const mine = new Set(studentCourseSectionIds.map((id) => id.toString()));
  const relevant = rows.filter((r) => mine.has(r.courseSectionId.toString()));

  if (relevant.length === 0) {
    return { accessibleNow: false, releaseDate: null, expireDate: null, reason: 'not-scheduled' };
  }

  // Open if any of the student's sections is currently within its window.
  const open = relevant.filter(
    (r) => new Date(r.releaseDate) <= now && now <= new Date(r.expireDate)
  );
  if (open.length > 0) {
    // Surface the window that stays open the longest.
    const governing = open.reduce((a, b) =>
      new Date(a.expireDate) >= new Date(b.expireDate) ? a : b
    );
    return {
      accessibleNow: true,
      releaseDate: governing.releaseDate,
      expireDate: governing.expireDate,
      reason: 'open',
    };
  }

  // Not open: prefer the soonest upcoming window, else the most recent expired one.
  const upcoming = relevant
    .filter((r) => new Date(r.releaseDate) > now)
    .sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));
  if (upcoming.length > 0) {
    return {
      accessibleNow: false,
      releaseDate: upcoming[0].releaseDate,
      expireDate: upcoming[0].expireDate,
      reason: 'not-yet',
    };
  }

  const expired = relevant.sort((a, b) => new Date(b.expireDate) - new Date(a.expireDate));
  return {
    accessibleNow: false,
    releaseDate: expired[0].releaseDate,
    expireDate: expired[0].expireDate,
    reason: 'expired',
  };
};

module.exports = {
  getSchedulesForQuiz,
  setSchedules,
  getSchedulesForQuizzes,
  getStudentSectionObjectIds,
  removeSchedulesForSection,
  removeSchedulesForQuiz,
  resolveWindow,
};
