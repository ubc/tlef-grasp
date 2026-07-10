const { ObjectId } = require("mongodb");
const databaseService = require("./database");

const COLLECTION = "grasp_quiz_question_flag";

const asId = (value) =>
  typeof value === "string" && ObjectId.isValid(value) ? new ObjectId(value) : value;

const asString = (value) => (value == null ? value : value.toString());

function serializeFlag(flag, quizzesById = new Map(), usersById = new Map()) {
  return {
    ...flag,
    _id: asString(flag._id),
    courseId: asString(flag.courseId),
    quizId: asString(flag.quizId),
    questionId: asString(flag.questionId),
    studentId: asString(flag.studentId),
    reviewedBy: asString(flag.reviewedBy),
    quizName: quizzesById.get(asString(flag.quizId)) || "Quiz",
    studentName: usersById.get(asString(flag.studentId)) || undefined,
  };
}

async function enrichFlags(flags, { includeStudents = false } = {}) {
  if (flags.length === 0) return [];

  const db = await databaseService.connect();
  const quizIds = [...new Map(flags.map((flag) => [asString(flag.quizId), flag.quizId])).values()];
  const quizzes = await db
    .collection("grasp_quiz")
    .find({ _id: { $in: quizIds } })
    .project({ name: 1 })
    .toArray();
  const quizzesById = new Map(quizzes.map((quiz) => [asString(quiz._id), quiz.name || "Quiz"]));

  let usersById = new Map();
  if (includeStudents) {
    const studentIds = [
      ...new Map(flags.map((flag) => [asString(flag.studentId), flag.studentId])).values(),
    ];
    const users = await db
      .collection("grasp_user")
      .find({ _id: { $in: studentIds } })
      .project({ displayName: 1, email: 1, puid: 1 })
      .toArray();
    usersById = new Map(
      users.map((user) => [
        asString(user._id),
        user.displayName || user.email || user.puid || "Unknown student",
      ])
    );
  }

  return flags.map((flag) => serializeFlag(flag, quizzesById, usersById));
}

async function questionBelongsToQuiz(quizId, questionId) {
  const db = await databaseService.connect();
  const mapping = await db.collection("grasp_quiz_question").findOne({
    quizId: asId(quizId),
    questionId: asId(questionId),
  });
  return Boolean(mapping);
}

async function saveStudentFlag({
  courseId,
  quizId,
  questionId,
  studentId,
  reason,
  comment,
  questionText,
}) {
  const db = await databaseService.connect();
  const now = new Date();
  const filter = {
    courseId: asId(courseId),
    quizId: asId(quizId),
    questionId: asId(questionId),
    studentId: asId(studentId),
  };

  // A later submission intentionally reopens the report: a student may add
  // detail after an instructor has already reviewed an earlier version.
  await db.collection(COLLECTION).updateOne(
    filter,
    {
      $set: {
        reason,
        comment,
        questionText,
        status: "pending",
        updatedAt: now,
        reviewedAt: null,
        reviewedBy: null,
      },
      $setOnInsert: { ...filter, createdAt: now },
    },
    { upsert: true }
  );

  return db.collection(COLLECTION).findOne(filter);
}

async function getStudentFlags(courseId, studentId) {
  const db = await databaseService.connect();
  const flags = await db
    .collection(COLLECTION)
    .find({ courseId: asId(courseId), studentId: asId(studentId) })
    .sort({ updatedAt: -1 })
    .toArray();
  return enrichFlags(flags);
}

async function getCourseFlags(courseId) {
  const db = await databaseService.connect();
  const flags = await db
    .collection(COLLECTION)
    .find({ courseId: asId(courseId) })
    .sort({ status: 1, updatedAt: -1 })
    .toArray();
  return enrichFlags(flags, { includeStudents: true });
}

async function getFlagById(flagId) {
  const db = await databaseService.connect();
  return db.collection(COLLECTION).findOne({ _id: asId(flagId) });
}

async function updateFlagStatus(flagId, status, reviewerId) {
  const db = await databaseService.connect();
  const filter = { _id: asId(flagId) };
  await db.collection(COLLECTION).updateOne(filter, {
    $set: {
      status,
      reviewedAt: new Date(),
      reviewedBy: asId(reviewerId),
      updatedAt: new Date(),
    },
  });
  return db.collection(COLLECTION).findOne(filter);
}

module.exports = {
  questionBelongsToQuiz,
  saveStudentFlag,
  getStudentFlags,
  getCourseFlags,
  getFlagById,
  updateFlagStatus,
};
