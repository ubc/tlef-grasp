/**
 * Which questions a student gets for a quiz, and which they may answer
 * (issue #168).
 *
 * A spaced-3phase quiz picks each student's questions (quiz.js
 * getQuizQuestionsForStudent): one per objective of the quiz, plus remediation
 * and review drawn from earlier quizzes, unseen questions first and ties at
 * random. The pick for the graded attempt is made once, at the first load, and
 * kept on the student's quiz session, so every later load serves the same
 * questions in the same order and a reload can no longer swap a question for
 * another variant of it. Remediation and review in later quizzes still pick
 * afresh from mastery, and so does each practice round after the graded
 * attempt. All-approved quizzes serve every approved question and keep nothing.
 */

const { ObjectId } = require('mongodb');
const databaseService = require('./database');
const quizService = require('./quiz');
const quizSessionService = require('./quiz-session');

const SPACED = 'spaced-3phase';

const toId = (value) => (ObjectId.isValid(value) ? new ObjectId(value) : value);
const idOf = (value) => String(value);
const isSpaced = (quiz) => quiz?.deliveryFormat === SPACED;
// The objective ids a question or an attempt belongs to (meta and granular).
const objectivesOf = (doc) =>
  [doc.learningObjectiveId, doc.granularObjectiveId].filter(Boolean).map(idOf);

/**
 * The questions to serve a student for a quiz, in order. Callers start the
 * student's quiz session first: it holds the kept pick.
 * @param {object} quiz - The quiz document
 * @param {string|ObjectId} userId
 * @returns {Promise<object[]>} Question documents; spaced-3phase ones carry `phase`
 */
async function getStudentQuestions(quiz, userId) {
  const quizId = idOf(quiz._id);
  if (!isSpaced(quiz) || (await quizService.hasCompletedQuiz(userId, quizId))) {
    // Every approved question of an all-approved quiz; a fresh pick for each
    // practice round once the graded attempt is done.
    return quizService.getQuizQuestionsForStudent(quizId, userId);
  }

  const session = await quizSessionService.getSession(userId, quizId);
  let served = session?.servedQuestions;
  if (!served) {
    const pick = await pickForAttempt(quiz, userId);
    if (pick.length === 0) return [];
    if (session) {
      served = (await quizSessionService.saveServedQuestions(userId, quizId, pick)) || pick;
    } else {
      console.warn(`[quiz-delivery] No session for user ${userId} on quiz ${quizId}; serving an unkept pick.`);
      served = pick;
    }
  }
  return loadServedQuestions(quiz, userId, served);
}

/**
 * A fresh pick for a graded attempt, as `{ questionId, phase }` entries. An
 * attempt already under way before picks were kept keeps every question the
 * student has answered, so no recorded answer is dropped; the fresh pick fills
 * only the objectives those answers do not cover.
 */
async function pickForAttempt(quiz, userId) {
  const quizId = idOf(quiz._id);
  const fresh = await quizService.getQuizQuestionsForStudent(quizId, userId);
  const entryOf = (question) => ({ questionId: question._id, phase: question.phase });

  const db = await databaseService.connect();
  const attempts = await db.collection('grasp_student_attempt')
    .find(
      { userId: toId(userId), quizId: toId(quizId) },
      { projection: { questionId: 1, learningObjectiveId: 1, granularObjectiveId: 1 } }
    )
    .toArray();
  const freshIds = new Set(fresh.map((question) => idOf(question._id)));
  const extra = attempts.filter((attempt) => !freshIds.has(idOf(attempt.questionId)));
  if (extra.length === 0) return fresh.map(entryOf);

  const links = await db.collection('grasp_quiz_question')
    .find(
      { quizId: toId(quizId), questionId: { $in: extra.map((attempt) => attempt.questionId) } },
      { projection: { questionId: 1 } }
    )
    .toArray();
  const inQuiz = new Set(links.map((link) => idOf(link.questionId)));
  const answered = new Set(attempts.map((attempt) => idOf(attempt.questionId)));
  const covered = new Set(extra.flatMap(objectivesOf));
  return [
    ...fresh
      .filter(
        (question) =>
          answered.has(idOf(question._id)) || !objectivesOf(question).some((id) => covered.has(id))
      )
      .map(entryOf),
    // Not in the fresh pick: this quiz's own questions are phase 1, the rest
    // came from earlier quizzes.
    ...extra.map((attempt) => ({
      questionId: attempt.questionId,
      phase: inQuiz.has(idOf(attempt.questionId)) ? 1 : 2,
    })),
  ].sort((a, b) => a.phase - b.phase);
}

/**
 * A kept pick, read back in its order. A question deleted, unapproved, or (one
 * of this quiz's own) taken out of the quiz since is no longer served.
 */
async function loadServedQuestions(quiz, userId, served, { annotate = true } = {}) {
  const db = await databaseService.connect();
  const ids = served.map((entry) => toId(entry.questionId));
  const [docs, links] = await Promise.all([
    db.collection('grasp_question').find({ _id: { $in: ids }, status: 'Approved' }).toArray(),
    db.collection('grasp_quiz_question')
      .find({ quizId: toId(quiz._id), questionId: { $in: ids } }, { projection: { questionId: 1 } })
      .toArray(),
  ]);
  const byId = new Map(docs.map((doc) => [idOf(doc._id), doc]));
  const inQuiz = new Set(links.map((link) => idOf(link.questionId)));
  const questions = served
    .filter((entry) => {
      const id = idOf(entry.questionId);
      return byId.has(id) && (entry.phase !== 1 || inQuiz.has(id));
    })
    .map((entry) => ({ ...byId.get(idOf(entry.questionId)), phase: entry.phase }));
  const enriched = await quizService.enrichQuestionsWithLO(questions);
  return annotate ? quizService.annotateUserLevels(quiz, userId, enriched) : enriched;
}

/**
 * Question counts of a spaced-3phase quiz for the student's quiz list: the
 * kept pick when there is one, otherwise a preview of a fresh pick (nothing is
 * kept).
 */
async function getStudentQuestionCounts(quiz, userId) {
  const quizId = idOf(quiz._id);
  const session = await quizSessionService.getSession(userId, quizId);
  const questions = session?.servedQuestions
    ? await loadServedQuestions(quiz, userId, session.servedQuestions, { annotate: false })
    : await quizService.getQuizQuestionsForStudent(quizId, userId);
  return {
    questionCount: questions.length,
    phase1Count: questions.filter((question) => question.phase === 1).length,
    phase2Count: questions.filter((question) => question.phase === 2).length,
    phase3Count: questions.filter((question) => question.phase === 3).length,
  };
}

/**
 * The questions a graded attempt with a kept pick is scored on: the kept
 * questions still served, plus any the student answered that have since been
 * removed (their answer still counts). Null when the attempt has no kept pick;
 * the caller then keeps the count recorded at the first load.
 * @returns {Promise<Set<string>|null>} Question ids
 */
async function scoredQuestionIds(quiz, userId, session, attempts) {
  if (!session?.servedQuestions) return null;
  const kept = new Set(session.servedQuestions.map((entry) => idOf(entry.questionId)));
  const available = await loadServedQuestions(quiz, userId, session.servedQuestions, { annotate: false });
  const scored = new Set(available.map((question) => idOf(question._id)));
  attempts.forEach((attempt) => {
    const id = idOf(attempt.questionId);
    if (kept.has(id)) scored.add(id);
  });
  return scored;
}

/**
 * Whether this student may answer this question in this quiz. A graded answer
 * must be to a question of their attempt: the kept pick of a spaced-3phase
 * quiz, or an approved question of an all-approved one. Practice picks afresh
 * each round, so it takes any approved question the quiz could serve: its own,
 * or for a spaced-3phase quiz one from a quiz the student reached before it.
 */
async function canAnswerQuestion(quiz, userId, questionId, { practice = false } = {}) {
  if (!ObjectId.isValid(questionId)) return false;
  if (isSpaced(quiz) && !practice) {
    const session = await quizSessionService.getSession(userId, idOf(quiz._id));
    // The quiz page starts the session, and keeps the pick, before any answer.
    if (!session) return false;
    if (session.servedQuestions) {
      return session.servedQuestions.some((entry) => idOf(entry.questionId) === idOf(questionId));
    }
    // An attempt started before picks were kept: whatever the quiz could serve.
  }
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
  getStudentQuestions,
  getStudentQuestionCounts,
  scoredQuestionIds,
  canAnswerQuestion,
};
