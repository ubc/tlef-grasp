const { ObjectId } = require("mongodb");
const databaseService = require("./database");

const DEFAULT_TIME_LIMIT_MINUTES = 60;

function quizTimeLimitMinutes(quiz) {
  const value = Number(quiz?.timeLimitMinutes);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_TIME_LIMIT_MINUTES;
}

const toId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : id);

function ids(userId, quizId) {
  return { userId: toId(userId), quizId: toId(quizId) };
}

// The first start is immutable: refreshing, reopening, or calling this again
// returns the original deadline rather than granting another full time limit.
async function getOrCreateSession(userId, quiz, { scheduledExpiresAt = null } = {}) {
  const db = await databaseService.connect();
  const collection = db.collection("grasp_quiz_session");
  const { userId: userIdObj, quizId } = ids(userId, quiz._id);
  const existing = await collection.findOne({ userId: userIdObj, quizId });
  if (existing) return existing;

  const startedAt = new Date();
  const timeLimitMinutes = quizTimeLimitMinutes(quiz);
  const durationExpiresAt = new Date(startedAt.getTime() + timeLimitMinutes * 60 * 1000);
  const scheduleDeadline = scheduledExpiresAt ? new Date(scheduledExpiresAt) : null;
  const hasValidScheduleDeadline = scheduleDeadline && !Number.isNaN(scheduleDeadline.getTime());
  const expiresAt = hasValidScheduleDeadline && scheduleDeadline < durationExpiresAt
    ? scheduleDeadline
    : durationExpiresAt;
  const session = {
    userId: userIdObj,
    quizId,
    startedAt,
    expiresAt,
    timeLimitMinutes,
    scheduledExpiresAt: hasValidScheduleDeadline ? scheduleDeadline : null,
  };

  try {
    await collection.insertOne(session);
    return session;
  } catch (error) {
    // A concurrent reload can race the insert; use the already-created session.
    if (error?.code === 11000) return collection.findOne({ userId: userIdObj, quizId });
    throw error;
  }
}

async function getSession(userId, quizId) {
  const db = await databaseService.connect();
  const { userId: userIdObj, quizId: quizIdObj } = ids(userId, quizId);
  return db.collection("grasp_quiz_session").findOne({ userId: userIdObj, quizId: quizIdObj });
}

// Locks in how many questions the student was served. Only the first
// recording counts: personalized (spaced-3phase) selections can differ on
// re-fetch, but the score denominator must match the quiz as first delivered.
async function recordQuestionCount(userId, quizId, questionCount) {
  const count = Number(questionCount);
  if (!Number.isInteger(count) || count <= 0) return;
  const db = await databaseService.connect();
  const { userId: userIdObj, quizId: quizIdObj } = ids(userId, quizId);
  await db.collection("grasp_quiz_session").updateOne(
    { userId: userIdObj, quizId: quizIdObj, questionCount: { $exists: false } },
    { $set: { questionCount: count } }
  );
}

async function markSubmitted(userId, quizId) {
  const db = await databaseService.connect();
  const { userId: userIdObj, quizId: quizIdObj } = ids(userId, quizId);
  await db.collection("grasp_quiz_session").updateOne(
    { userId: userIdObj, quizId: quizIdObj },
    { $set: { submittedAt: new Date() } }
  );
}

// Of `quizIds`, those the student started (answers or an unsubmitted session)
// but has no score for. A session alone counts so a timed-out student with no
// answers can still auto-submit.
async function getUnsubmittedQuizIds(userId, quizIds) {
  if (!quizIds.length) return new Set();
  const db = await databaseService.connect();
  const filter = { userId: toId(userId), quizId: { $in: quizIds.map(toId) } };
  const options = { projection: { quizId: 1 } };
  const [scores, attempts, sessions] = await Promise.all([
    db.collection("grasp_quiz_score").find(filter, options).toArray(),
    db.collection("grasp_student_attempt").find(filter, options).toArray(),
    db.collection("grasp_quiz_session").find({ ...filter, submittedAt: null }, options).toArray(),
  ]);
  const scored = new Set(scores.map((doc) => doc.quizId.toString()));
  return new Set(
    [...attempts, ...sessions]
      .map((doc) => doc.quizId.toString())
      .filter((quizId) => !scored.has(quizId))
  );
}

function isExpired(session, now = new Date()) {
  return Boolean(session?.expiresAt && new Date(session.expiresAt) <= now);
}

module.exports = {
  DEFAULT_TIME_LIMIT_MINUTES,
  quizTimeLimitMinutes,
  getOrCreateSession,
  getSession,
  recordQuestionCount,
  markSubmitted,
  getUnsubmittedQuizIds,
  isExpired,
};
