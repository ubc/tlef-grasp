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
 * When `restrictToSectionIds` is given, the call may only create/update/remove
 * rows for those sections — schedules for any other section (e.g. another
 * instructor's) are left untouched. Rows in the payload outside that set are
 * ignored. This scopes scheduling to the sections an instructor owns.
 *
 * @param {string} quizId
 * @param {Array<{courseSectionId: string, releaseDate: string|Date, expireDate: string|Date}>} rows
 * @param {{restrictToSectionIds?: string[]}} [options]
 */
const setSchedules = async (quizId, rows = [], { restrictToSectionIds = null } = {}) => {
  const db = await databaseService.connect();
  const collection = db.collection(COLLECTION);
  const qid = toObjectId(quizId);

  const allowed = restrictToSectionIds
    ? new Set(restrictToSectionIds.map((id) => id.toString()))
    : null;

  const keep = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const courseSectionId = row && row.courseSectionId;
    const releaseDate = toDateOrNull(row && row.releaseDate);
    const expireDate = toDateOrNull(row && row.expireDate);
    if (!courseSectionId || !releaseDate || !expireDate) continue;
    // Ignore sections outside the permitted set.
    if (allowed && !allowed.has(courseSectionId.toString())) continue;

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

  // Drop rows for sections the instructor cleared / omitted — but only within
  // the permitted set, so other instructors' schedules are preserved.
  const deleteFilter = { quizId: qid, courseSectionId: { $nin: keep } };
  if (allowed) {
    deleteFilter.courseSectionId = {
      $nin: keep,
      $in: [...allowed].map(toObjectId),
    };
  }
  await collection.deleteMany(deleteFilter);

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

// Offset of `timeZone` from UTC at instant `date`, in ms.
const tzOffsetMs = (date, timeZone) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(date).map((p) => [p.type, Number(p.value)])
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
};

const isValidTimeZone = (timeZone) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
};

/**
 * Shift an instant by whole days in wall-clock terms for `timeZone` (a 23:59
 * deadline stays 23:59 across a DST change), then by `minutes` in absolute time.
 */
const shiftDate = (date, { days = 0, minutes = 0 }, timeZone = 'UTC') => {
  const start = new Date(date);
  const naive = start.getTime() + days * 86400000;
  let result = naive;
  if (days) {
    // Correct by the change in UTC offset; a second pass settles results that
    // land on the far side of the DST boundary.
    const base = tzOffsetMs(start, timeZone);
    for (let i = 0; i < 2; i++) result = naive + base - tzOffsetMs(new Date(result), timeZone);
  }
  return new Date(result + minutes * 60000);
};

/**
 * Compute the shifted windows for `rows` without writing anything. Each entry
 * is flagged when the new window has already closed (`expired`), would open
 * immediately although it was upcoming (`opens-now`), or starts at the exact
 * moment as another quiz in the same section (`collision`).
 *
 * @param {Array<{_id, quizId, courseSectionId, releaseDate, expireDate}>} rows - Rows being shifted.
 * @param {Array<{quizId, courseSectionId, releaseDate}>} otherRows - Unshifted rows in the same sections.
 */
const planShift = (rows, offset, { timeZone = 'UTC', otherRows = [], now = new Date() } = {}) => {
  const planned = rows.map((r) => ({
    _id: r._id,
    quizId: r.quizId.toString(),
    courseSectionId: r.courseSectionId.toString(),
    oldReleaseDate: new Date(r.releaseDate),
    oldExpireDate: new Date(r.expireDate),
    releaseDate: shiftDate(r.releaseDate, offset, timeZone),
    expireDate: shiftDate(r.expireDate, offset, timeZone),
  }));

  const startsBySection = new Map();
  const addStart = (sectionId, quizId, time) => {
    const key = `${sectionId}|${time}`;
    if (!startsBySection.has(key)) startsBySection.set(key, new Set());
    startsBySection.get(key).add(quizId);
  };
  for (const r of otherRows) addStart(r.courseSectionId.toString(), r.quizId.toString(), new Date(r.releaseDate).getTime());
  for (const p of planned) addStart(p.courseSectionId, p.quizId, p.releaseDate.getTime());

  return planned.map((p) => {
    const flags = [];
    if (p.expireDate <= now) flags.push('expired');
    else if (p.releaseDate <= now && p.oldReleaseDate > now) flags.push('opens-now');
    if (startsBySection.get(`${p.courseSectionId}|${p.releaseDate.getTime()}`).size > 1) flags.push('collision');
    return { ...p, flags };
  });
};

/**
 * Shift every schedule row of `quizIds` (limited to `restrictToSectionIds`) by
 * `offset`. Running quiz sessions are deliberately untouched: a student
 * mid-attempt keeps the deadline they started with.
 *
 * All-or-nothing: rows are written with their old dates as a guard, and if any
 * write fails or finds its row changed underneath it, the rows already moved
 * are written back. (No multi-document transactions — deployments may run a
 * standalone mongod.)
 *
 * @returns {Promise<Array>} The plan (see `planShift`), applied unless `dryRun`.
 */
const shiftSchedules = async (
  quizIds,
  offset,
  { restrictToSectionIds, timeZone = 'UTC', dryRun = false, now = new Date() } = {}
) => {
  if (!quizIds.length || !restrictToSectionIds.length) return [];
  const db = await databaseService.connect();
  const collection = db.collection(COLLECTION);
  const sectionFilter = { $in: restrictToSectionIds.map(toObjectId) };
  const quizFilter = quizIds.map(toObjectId);

  const [rows, otherRows] = await Promise.all([
    collection.find({ quizId: { $in: quizFilter }, courseSectionId: sectionFilter }).toArray(),
    collection.find({ quizId: { $nin: quizFilter }, courseSectionId: sectionFilter }).toArray(),
  ]);
  const plan = planShift(rows, offset, { timeZone, otherRows, now });

  for (const p of plan) {
    if (!(p.expireDate > p.releaseDate)) {
      throw Object.assign(new Error("A shifted expire date would not be after its release date."), { status: 400 });
    }
  }
  if (dryRun || plan.length === 0) return plan;

  const applied = [];
  try {
    for (const p of plan) {
      const res = await collection.updateOne(
        { _id: p._id, releaseDate: p.oldReleaseDate, expireDate: p.oldExpireDate },
        { $set: { releaseDate: p.releaseDate, expireDate: p.expireDate, updatedAt: new Date() } }
      );
      if (res.matchedCount !== 1) {
        throw Object.assign(new Error("A schedule changed while shifting; nothing was moved. Please retry."), { status: 409 });
      }
      applied.push(p);
    }
  } catch (error) {
    for (const p of applied) {
      await collection.updateOne(
        { _id: p._id, releaseDate: p.releaseDate, expireDate: p.expireDate },
        { $set: { releaseDate: p.oldReleaseDate, expireDate: p.oldExpireDate, updatedAt: new Date() } }
      );
    }
    throw error;
  }
  return plan;
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
 * Order a course's quizzes the way one student actually experiences them.
 *
 * Availability is per section, so document creation order is not teaching
 * order — two sections running at different paces receive the same quizzes in
 * different sequences. The sort key is the earliest release date across the
 * student's sections (earliest, not `resolveWindow`'s governing window, so the
 * ordering is stable rather than shifting as `now` moves). Quizzes with no row
 * for any of the student's sections keep their relative creation order and sort
 * ahead of scheduled ones, matching the pre-scheduling behaviour.
 *
 * @param {Array<{_id: any, createdAt: Date}>} quizzes - Course quizzes, already in createdAt order.
 * @param {Map<string, Array<{courseSectionId: string, releaseDate: Date}>>} schedulesByQuiz
 * @param {string[]} studentCourseSectionIds
 * @returns {Array} The same quiz objects, ordered for this student.
 */
const orderQuizzesForStudent = (quizzes = [], schedulesByQuiz = new Map(), studentCourseSectionIds = []) => {
  const mine = new Set(studentCourseSectionIds.map((id) => id.toString()));
  if (mine.size === 0) return [...quizzes];

  const releaseFor = (quiz) => {
    const rows = schedulesByQuiz.get(quiz._id.toString()) || [];
    const times = rows
      .filter((r) => mine.has(r.courseSectionId.toString()))
      .map((r) => new Date(r.releaseDate).getTime())
      .filter((t) => !Number.isNaN(t));
    return times.length ? Math.min(...times) : null;
  };

  return quizzes
    .map((quiz, index) => ({ quiz, index, release: releaseFor(quiz) }))
    .sort((a, b) => {
      if (a.release === null && b.release === null) return a.index - b.index;
      if (a.release === null) return -1;
      if (b.release === null) return 1;
      // Same release date (or a tie from equal timestamps): fall back to the
      // incoming createdAt order so the result stays deterministic.
      return a.release - b.release || a.index - b.index;
    })
    .map((entry) => entry.quiz);
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
  shiftDate,
  isValidTimeZone,
  planShift,
  shiftSchedules,
  getStudentSectionObjectIds,
  removeSchedulesForSection,
  removeSchedulesForQuiz,
  resolveWindow,
  orderQuizzesForStudent,
};
