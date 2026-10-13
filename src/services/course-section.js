const databaseService = require('./database');
const { ObjectId } = require('mongodb');

const toObjectId = (id) =>
  typeof id === 'string' && ObjectId.isValid(id) ? new ObjectId(id) : id;

// Where a section enrollment was last confirmed from. Legacy rows carry no
// source and count as academic-api.
const SECTION_ENROLLMENT_SOURCES = {
  ACADEMIC_API: 'academic-api',
  CANVAS: 'canvas',
};

// Why a section enrollment was soft-dropped. A dropped row keeps its history
// (and lets a later sync restore it) but grants nothing: every reader that
// decides access or visibility only considers active rows.
const DROPPED_REASONS = {
  LMS_ROSTER: 'lms-roster',
  REMOVED_FROM_COURSE: 'removed-from-course',
};

// Query fragment matching active (not soft-dropped) rows. `null` in a query
// matches a missing field as well as an explicit null.
const ACTIVE_ENROLLMENT = { droppedAt: null };

const upsertCourseSection = async (courseId, { sectionId, sectionNumber, academicPeriod, academicPeriodName, owner }) => {
  const db = await databaseService.connect();
  const updateData = { sectionNumber, academicPeriod, academicPeriodName };
  if (owner) updateData.owner = toObjectId(owner);
  
  await db.collection('grasp_course_section').updateOne(
    { courseId: toObjectId(courseId), sectionId },
    {
      $set: updateData,
      $setOnInsert: { courseId: toObjectId(courseId), sectionId, createdAt: new Date() },
    },
    { upsert: true }
  );
};

const getCourseSections = async (courseId) => {
  const db = await databaseService.connect();
  return db.collection('grasp_course_section')
    .find({ courseId: toObjectId(courseId) })
    .project({ 'lmsLink.linkedBy': 0, 'lmsLink.lastSync.by': 0 })
    .toArray();
};

/**
 * Record (or confirm) that a user is enrolled in a section. A roster sync is
 * authoritative, so this also restores a soft-dropped row — re-syncing re-adds
 * a student who was dropped or removed, as the Academic API sync always has.
 * @param {string|ObjectId} userId
 * @param {string|ObjectId} courseId
 * @param {string} sectionId
 * @param {Object} [options]
 * @param {string} [options.source] - One of SECTION_ENROLLMENT_SOURCES (default academic-api)
 * @param {Date} [options.now]
 */
const upsertUserCourseSection = async (userId, courseId, sectionId, options = {}) => {
  const { source = SECTION_ENROLLMENT_SOURCES.ACADEMIC_API, now = new Date() } = options;
  const db = await databaseService.connect();
  await db.collection('grasp_user_course_section').updateOne(
    { userId: toObjectId(userId), courseId: toObjectId(courseId), sectionId },
    {
      $set: { source, syncedAt: now },
      $unset: { droppedAt: '', droppedReason: '', droppedBy: '' },
      $setOnInsert: {
        userId: toObjectId(userId),
        courseId: toObjectId(courseId),
        sectionId,
        createdAt: now,
      },
    },
    { upsert: true }
  );
};

/**
 * Soft-drop one active section enrollment. Returns whether a row was dropped
 * (false when it was already dropped or does not exist).
 * @param {string|ObjectId} userId
 * @param {string|ObjectId} courseId
 * @param {string} sectionId
 * @param {{ reason: string, droppedBy?: string|ObjectId, now?: Date }} options
 */
const dropUserCourseSection = async (userId, courseId, sectionId, { reason, droppedBy, now = new Date() }) => {
  const db = await databaseService.connect();
  const result = await db.collection('grasp_user_course_section').updateOne(
    {
      userId: toObjectId(userId),
      courseId: toObjectId(courseId),
      sectionId,
      ...ACTIVE_ENROLLMENT,
    },
    {
      $set: {
        droppedAt: now,
        droppedReason: reason,
        ...(droppedBy ? { droppedBy: toObjectId(droppedBy) } : {}),
      },
    }
  );
  return result.modifiedCount === 1;
};

/**
 * Soft-drop every active section enrollment a user has in a course — used when
 * an instructor removes them from the course, so a leftover section row cannot
 * keep granting quiz access. Returns the number of rows dropped.
 * @param {string|ObjectId} userId
 * @param {string|ObjectId} courseId
 * @param {{ reason: string, droppedBy?: string|ObjectId, now?: Date }} options
 */
const dropUserCourseSections = async (userId, courseId, { reason, droppedBy, now = new Date() }) => {
  const db = await databaseService.connect();
  const result = await db.collection('grasp_user_course_section').updateMany(
    { userId: toObjectId(userId), courseId: toObjectId(courseId), ...ACTIVE_ENROLLMENT },
    {
      $set: {
        droppedAt: now,
        droppedReason: reason,
        ...(droppedBy ? { droppedBy: toObjectId(droppedBy) } : {}),
      },
    }
  );
  return result.modifiedCount || 0;
};

/** Number of active section enrollments a user has in a course. */
const countActiveUserCourseSections = async (userId, courseId) => {
  const db = await databaseService.connect();
  return db.collection('grasp_user_course_section').countDocuments({
    userId: toObjectId(userId),
    courseId: toObjectId(courseId),
    ...ACTIVE_ENROLLMENT,
  });
};

/** The user's active section enrollments in a course (dropped rows excluded). */
const getUserCourseSections = async (userId, courseId) => {
  const db = await databaseService.connect();
  return db.collection('grasp_user_course_section')
    .find({ userId: toObjectId(userId), courseId: toObjectId(courseId), ...ACTIVE_ENROLLMENT })
    .toArray();
};

/** Active students of one section (dropped rows excluded). */
const getSectionStudents = async (courseId, sectionId) => {
  const db = await databaseService.connect();
  return db.collection('grasp_user_course_section').aggregate([
    { $match: { courseId: toObjectId(courseId), sectionId, ...ACTIVE_ENROLLMENT } },
    {
      $lookup: {
        from: 'grasp_user',
        let: { uid: '$userId' },
        pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$uid'] } } }],
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        userId: 1,
        sectionId: 1,
        puid: '$user.puid',
        displayName: '$user.displayName',
        legalName: '$user.legalName',
        email: '$user.email',
      },
    },
  ]).toArray();
};

/**
 * Resolve which sections of a course a given viewer may see:
 * - the course owner and app administrators see every section;
 * - any other instructor sees only the sections they own.
 * Returns { seeAll, sections }.
 */
const getSectionsForViewer = async (courseId, user) => {
  const { isAppAdministrator } = require('../utils/auth');
  const { getCourseById } = require('./course');

  const sections = await getCourseSections(courseId);
  const userId = String(user._id || user.id);
  const course = await getCourseById(courseId);

  const isOwner = !!(course && course.owner && course.owner.toString() === userId);
  const seeAll = isOwner || (await isAppAdministrator(user));

  if (seeAll) return { seeAll: true, sections };
  return {
    seeAll: false,
    sections: sections.filter((s) => s.owner && s.owner.toString() === userId),
  };
};

/**
 * Sections of a course owned by a specific user. A section with no explicit
 * owner is attributed to the course owner (legacy sections), matching the
 * "My Sections" view. Used to limit quiz scheduling to one's own sections —
 * the course owner is held to the same rule (only the sections they own).
 */
const getSectionsOwnedByUser = async (courseId, userId) => {
  const { getCourseById } = require('./course');
  const sections = await getCourseSections(courseId);
  const course = await getCourseById(courseId);
  const courseOwnerId = course && course.owner ? course.owner.toString() : null;
  const uid = String(userId);
  return sections.filter((s) => {
    const sectionOwnerId = s.owner ? s.owner.toString() : courseOwnerId;
    return sectionOwnerId === uid;
  });
};

const getSectionsByOwner = async (ownerId) => {
  const db = await databaseService.connect();
  return db.collection('grasp_course_section').aggregate([
    { $match: { owner: toObjectId(ownerId) } },
    {
      $lookup: {
        from: 'grasp_course',
        localField: 'courseId',
        foreignField: '_id',
        as: 'course',
      },
    },
    { $unwind: { path: '$course', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        courseId: 1,
        sectionId: 1,
        sectionNumber: 1,
        academicPeriod: 1,
        academicPeriodName: 1,
        courseName: '$course.courseName',
        courseCode: '$course.courseCode'
      },
    },
  ]).toArray();
};

const recycleSection = async (courseId, sectionId) => {
  const db = await databaseService.connect();
  const cId = toObjectId(courseId);

  // Users actively enrolled in this section before deleting. A soft-dropped
  // row already grants nothing, so recycling its section must not change that
  // user's course membership.
  const userCourseSections = await db.collection('grasp_user_course_section').find({
    courseId: cId,
    sectionId: sectionId,
    ...ACTIVE_ENROLLMENT,
  }).toArray();
  const userIds = [...new Set(userCourseSections.map(doc => doc.userId.toString()))];

  // Detach all users from this section (dropped rows included)
  await db.collection('grasp_user_course_section').deleteMany({
    courseId: cId,
    sectionId: sectionId
  });

  // Check remaining sections for each detached user
  if (userIds.length > 0) {
    const course = await db.collection('grasp_course').findOne({ _id: cId });
    const ownerIdStr = course && course.owner ? course.owner.toString() : null;

    for (const userIdStr of userIds) {
      if (userIdStr === ownerIdStr) continue; // never remove course owner
      
      const uId = toObjectId(userIdStr);
      const remaining = await db.collection('grasp_user_course_section').countDocuments({
        courseId: cId,
        userId: uId,
        ...ACTIVE_ENROLLMENT,
      });

      if (remaining === 0) {
        await db.collection('grasp_user_course').deleteMany({
          courseId: cId,
          userId: uId
        });
      }
    }
  }

  // Remove any per-section quiz schedules pointing at this section. Lazy-require
  // to avoid a circular dependency (quiz-schedule depends on this module).
  const sectionDoc = await db.collection('grasp_course_section').findOne({ courseId: cId, sectionId });
  if (sectionDoc) {
    const quizScheduleService = require('./quiz-schedule');
    await quizScheduleService.removeSchedulesForSection(sectionDoc._id);
    // GRASP's record of the section's LMS assignments; the assignments
    // themselves stay in the LMS (issue #125).
    const quizLmsAssignmentService = require('./quiz-lms-assignment');
    await quizLmsAssignmentService.removeForSection(sectionDoc._id);
  }

  // Delete the section itself
  return db.collection('grasp_course_section').deleteOne({
    courseId: cId,
    sectionId: sectionId
  });
};

module.exports = {
  SECTION_ENROLLMENT_SOURCES,
  DROPPED_REASONS,
  upsertCourseSection,
  getCourseSections,
  upsertUserCourseSection,
  dropUserCourseSection,
  dropUserCourseSections,
  countActiveUserCourseSections,
  getUserCourseSections,
  getSectionStudents,
  getSectionsByOwner,
  getSectionsOwnedByUser,
  getSectionsForViewer,
  recycleSection,
};
