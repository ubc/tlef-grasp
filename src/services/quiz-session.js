const { ObjectId } = require("mongodb");
const databaseService = require("./database");

const DEFAULT_TIME_LIMIT_MINUTES = 60;

function quizTimeLimitMinutes(quiz) {
  const value = Number(quiz?.timeLimitMinutes);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_TIME_LIMIT_MINUTES;
}

function ids(userId, quizId) {
  return {
    userId: ObjectId.isValid(userId) ? new ObjectId(userId) : userId,
    quizId: ObjectId.isValid(quizId) ? new ObjectId(quizId) : quizId,
  };
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

async function markSubmitted(userId, quizId) {
  const db = await databaseService.connect();
  const { userId: userIdObj, quizId: quizIdObj } = ids(userId, quizId);
  await db.collection("grasp_quiz_session").updateOne(
    { userId: userIdObj, quizId: quizIdObj },
    { $set: { submittedAt: new Date() } }
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
  markSubmitted,
  isExpired,
};
