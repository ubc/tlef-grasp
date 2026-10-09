/**
 * Which questions a student may answer in a quiz (issue #168).
 */

const { ObjectId } = require('mongodb');
const databaseService = require('./database');
const quizService = require('./quiz');

const SPACED = 'spaced-3phase';

const toId = (value) => (ObjectId.isValid(value) ? new ObjectId(value) : value);
const idOf = (value) => String(value);
const isSpaced = (quiz) => quiz?.deliveryFormat === SPACED;

/**
 * Whether this student may answer this question in this quiz: an approved
 * question the quiz could serve them. That is one of its own, or for a
 * spaced-3phase quiz one from a quiz the student reached before it (its
 * remediation and review).
 */
async function canAnswerQuestion(quiz, userId, questionId) {
  if (!ObjectId.isValid(questionId)) return false;
  return isServableQuestion(quiz, userId, questionId);
}

async function isServableQuestion(quiz, userId, questionId) {
  const db = await databaseService.connect();
  const question = await db.collection('grasp_question').findOne(
    { _id: toId(questionId), status: 'Approved' },
    { projection: { _id: 1 } }
  );
  if (!question) return false;

  let quizIds = [toId(quiz._id)];
  if (isSpaced(quiz)) {
    const ordered = await quizService.getCourseQuizzesInStudentOrder(db, quiz.courseId, userId);
    const index = ordered.findIndex((candidate) => idOf(candidate._id) === idOf(quiz._id));
    if (index > 0) quizIds = quizIds.concat(ordered.slice(0, index).map((candidate) => candidate._id));
  }
  const link = await db.collection('grasp_quiz_question').findOne(
    { quizId: { $in: quizIds }, questionId: question._id },
    { projection: { _id: 1 } }
  );
  return Boolean(link);
}

module.exports = {
  canAnswerQuestion,
};
