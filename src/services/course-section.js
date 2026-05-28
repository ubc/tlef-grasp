const databaseService = require('./database');
const { ObjectId } = require('mongodb');

const toObjectId = (id) =>
  typeof id === 'string' && ObjectId.isValid(id) ? new ObjectId(id) : id;

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
    .toArray();
};

const upsertUserCourseSection = async (userId, courseId, sectionId) => {
  const db = await databaseService.connect();
  await db.collection('grasp_user_course_section').updateOne(
    { userId: toObjectId(userId), courseId: toObjectId(courseId), sectionId },
    { $setOnInsert: { userId: toObjectId(userId), courseId: toObjectId(courseId), sectionId } },
    { upsert: true }
  );
};

const getUserCourseSections = async (userId, courseId) => {
  const db = await databaseService.connect();
  return db.collection('grasp_user_course_section')
    .find({ userId: toObjectId(userId), courseId: toObjectId(courseId) })
    .toArray();
};

const getSectionStudents = async (courseId, sectionId) => {
  const db = await databaseService.connect();
  return db.collection('grasp_user_course_section').aggregate([
    { $match: { courseId: toObjectId(courseId), sectionId } },
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
        email: '$user.email',
      },
    },
  ]).toArray();
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

  // Get all users in this section before deleting
  const userCourseSections = await db.collection('grasp_user_course_section').find({
    courseId: cId,
    sectionId: sectionId
  }).toArray();
  const userIds = [...new Set(userCourseSections.map(doc => doc.userId.toString()))];

  // Detach all users from this section
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
        userId: uId
      });

      if (remaining === 0) {
        await db.collection('grasp_user_course').deleteMany({
          courseId: cId,
          userId: uId
        });
      }
    }
  }

  // Delete the section itself
  return db.collection('grasp_course_section').deleteOne({
    courseId: cId,
    sectionId: sectionId
  });
};

module.exports = {
  upsertCourseSection,
  getCourseSections,
  upsertUserCourseSection,
  getUserCourseSections,
  getSectionStudents,
  getSectionsByOwner,
  recycleSection,
};
