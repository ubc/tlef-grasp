// Which questions a student gets for a quiz, and which they may answer
// (issue #168). A spaced-3phase graded attempt keeps the pick of its first
// load on the student's quiz session, so a reload serves the same questions
// instead of another variant. The selection itself (quiz.js) is stubbed: each
// test decides what a fresh pick returns. The quiz-session service runs for
// real against a small in-memory stand-in for MongoDB.

const { ObjectId } = require('mongodb');

jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/services/quiz', () => ({
  getQuizQuestionsForStudent: jest.fn(),
  hasCompletedQuiz: jest.fn(),
  enrichQuestionsWithLO: jest.fn(async (questions) => questions),
  annotateUserLevels: jest.fn(async (_quiz, _userId, questions) => questions),
  getCourseQuizzesInStudentOrder: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const quizService = require('../../src/services/quiz');
const quizSessionService = require('../../src/services/quiz-session');
const delivery = require('../../src/services/student-quiz-delivery');

// ---- In-memory MongoDB ----------------------------------------------------------

const same = (a, b) =>
  a instanceof ObjectId || b instanceof ObjectId ? String(a) === String(b) : a === b;

function matches(doc, filter) {
  return Object.entries(filter).every(([field, condition]) => {
    const value = doc[field];
    if (condition && typeof condition === 'object' && !(condition instanceof ObjectId)) {
      return Object.entries(condition).every(([op, arg]) => {
        if (op === '$in') return arg.some((candidate) => same(value, candidate));
        if (op === '$exists') return (value !== undefined) === arg;
        throw new Error(`fake db: unsupported operator ${op}`);
      });
    }
    return same(value, condition);
  });
}

function createFakeDb() {
  const collections = new Map();
  const collection = (name) => {
    if (!collections.has(name)) {
      const docs = [];
      collections.set(name, {
        docs,
        find: (filter = {}) => ({
          toArray: async () => docs.filter((doc) => matches(doc, filter)).map((doc) => ({ ...doc })),
        }),
        findOne: async (filter = {}) => {
          const doc = docs.find((candidate) => matches(candidate, filter));
          return doc ? { ...doc } : null;
        },
        insertOne: async (doc) => {
          const stored = { _id: new ObjectId(), ...doc };
          docs.push(stored);
          return { insertedId: stored._id };
        },
        updateOne: async (filter, update) => {
          const doc = docs.find((candidate) => matches(candidate, filter));
          if (doc) Object.assign(doc, update.$set);
          return { matchedCount: doc ? 1 : 0 };
        },
      });
    }
    return collections.get(name);
  };
  return {
    db: { collection },
    docs: (name) => collection(name).docs,
    seed: (name, doc) => {
      const stored = { _id: new ObjectId(), ...doc };
      collection(name).docs.push(stored);
      return stored;
    },
  };
}

// ---- Fixtures ----------------------------------------------------------------

let fake;
const USER_ID = new ObjectId().toString();
const COURSE_ID = new ObjectId();

const quizDoc = (overrides = {}) =>
  fake.seed('grasp_quiz', {
    courseId: COURSE_ID,
    name: 'Quiz',
    deliveryFormat: 'spaced-3phase',
    published: true,
    ...overrides,
  });

// An approved question on `objective`, linked to `quiz` unless it is null.
function question(quiz, objective, overrides = {}) {
  const doc = fake.seed('grasp_question', {
    courseId: COURSE_ID,
    status: 'Approved',
    learningObjectiveId: objective,
    ...overrides,
  });
  if (quiz) fake.seed('grasp_quiz_question', { quizId: quiz._id, questionId: doc._id });
  return doc;
}

const picked = (doc, phase = 1) => ({ ...doc, phase });
const idsOf = (questions) => questions.map((q) => String(q._id));
const sessionOf = (quiz) =>
  fake.docs('grasp_quiz_session').find((doc) => String(doc.quizId) === String(quiz._id));
const startSession = (quiz) => quizSessionService.getOrCreateSession(USER_ID, quiz);
const answer = (quiz, doc, isCorrect = true) =>
  fake.seed('grasp_student_attempt', {
    userId: new ObjectId(USER_ID),
    quizId: quiz._id,
    questionId: doc._id,
    learningObjectiveId: doc.learningObjectiveId,
    isCorrect,
  });

beforeEach(() => {
  fake = createFakeDb();
  databaseService.connect.mockResolvedValue(fake.db);
  quizService.hasCompletedQuiz.mockResolvedValue(false);
  // clearMocks keeps unused mockResolvedValueOnce picks; a test that reloads
  // from the kept pick leaves some behind.
  quizService.getQuizQuestionsForStudent.mockReset();
});

// ---- The graded attempt of a spaced-3phase quiz --------------------------------

describe('getStudentQuestions, spaced-3phase graded attempt', () => {
  it('keeps the first pick: a reload serves the same variant, even after an answer', async () => {
    const quiz = quizDoc();
    const objective = new ObjectId();
    const [a, b, c] = ['A', 'B', 'C'].map((title) => question(quiz, objective, { title }));
    // Unseen first with random ties: every fresh pick would differ.
    quizService.getQuizQuestionsForStudent
      .mockResolvedValueOnce([picked(c)])
      .mockResolvedValueOnce([picked(a)])
      .mockResolvedValueOnce([picked(b)]);
    await startSession(quiz);

    const first = await delivery.getStudentQuestions(quiz, USER_ID);
    answer(quiz, c, false);
    const second = await delivery.getStudentQuestions(quiz, USER_ID);
    const third = await delivery.getStudentQuestions(quiz, USER_ID);

    expect(idsOf(first)).toEqual([String(c._id)]);
    expect(idsOf(second)).toEqual([String(c._id)]);
    expect(idsOf(third)).toEqual([String(c._id)]);
    expect(second[0].phase).toBe(1);
    expect(quizService.getQuizQuestionsForStudent).toHaveBeenCalledTimes(1);
    expect(sessionOf(quiz).servedQuestions).toEqual([{ questionId: c._id, phase: 1 }]);
  });

  it('serves the pick another load of the attempt kept first', async () => {
    const quiz = quizDoc();
    const objective = new ObjectId();
    const [b, c] = ['B', 'C'].map((title) => question(quiz, objective, { title }));
    await startSession(quiz);
    // A second tab keeps its pick while this load is still choosing.
    quizService.getQuizQuestionsForStudent.mockImplementationOnce(async () => {
      sessionOf(quiz).servedQuestions = [{ questionId: b._id, phase: 1 }];
      return [picked(c)];
    });

    const served = await delivery.getStudentQuestions(quiz, USER_ID);

    expect(idsOf(served)).toEqual([String(b._id)]);
    expect(sessionOf(quiz).servedQuestions).toEqual([{ questionId: b._id, phase: 1 }]);
  });

  it('stops serving a kept question that was deleted, unapproved or taken out of the quiz', async () => {
    const quiz = quizDoc();
    const earlier = quizDoc({ name: 'Earlier' });
    const kept = question(quiz, new ObjectId(), { title: 'kept' });
    const unapproved = question(quiz, new ObjectId(), { status: 'Draft' });
    const deleted = { _id: new ObjectId() };
    const unlinked = question(null, new ObjectId());
    const review = question(earlier, new ObjectId(), { title: 'from an earlier quiz' });
    await startSession(quiz);
    sessionOf(quiz).servedQuestions = [
      { questionId: kept._id, phase: 1 },
      { questionId: unapproved._id, phase: 1 },
      { questionId: deleted._id, phase: 1 },
      { questionId: unlinked._id, phase: 1 },
      { questionId: review._id, phase: 2 },
    ];

    const served = await delivery.getStudentQuestions(quiz, USER_ID);

    expect(served.map((q) => [String(q._id), q.phase])).toEqual([
      [String(kept._id), 1],
      [String(review._id), 2],
    ]);
    expect(quizService.getQuizQuestionsForStudent).not.toHaveBeenCalled();
  });

  it('keeps every answer of an attempt started before picks were kept', async () => {
    const quiz = quizDoc();
    const earlier = quizDoc({ name: 'Earlier' });
    const [x, y, z] = [new ObjectId(), new ObjectId(), new ObjectId()];
    const answeredHere = question(quiz, x, { title: 'answered variant of X' });
    const freshHere = question(quiz, x, { title: 'another variant of X' });
    const otherObjective = question(quiz, z, { title: 'Z' });
    const answeredReview = question(earlier, y, { title: 'answered review of Y' });
    const freshReview = question(earlier, y, { title: 'another review of Y' });
    await startSession(quiz);
    answer(quiz, answeredHere);
    answer(quiz, answeredReview);
    quizService.getQuizQuestionsForStudent.mockResolvedValueOnce([
      picked(freshHere),
      picked(otherObjective),
      picked(freshReview, 2),
    ]);

    const served = await delivery.getStudentQuestions(quiz, USER_ID);

    // The fresh pick only fills Z; X and Y keep the variants already answered.
    expect(served.map((q) => [q.title, q.phase])).toEqual([
      ['Z', 1],
      ['answered variant of X', 1],
      ['answered review of Y', 2],
    ]);
  });

  it('keeps no pick when there is nothing to serve', async () => {
    const quiz = quizDoc();
    await startSession(quiz);
    quizService.getQuizQuestionsForStudent.mockResolvedValueOnce([]);

    expect(await delivery.getStudentQuestions(quiz, USER_ID)).toEqual([]);
    expect(sessionOf(quiz).servedQuestions).toBeUndefined();
  });
});

describe('getStudentQuestions, everything else', () => {
  it('picks afresh for each practice round once the graded attempt is done', async () => {
    const quiz = quizDoc();
    const objective = new ObjectId();
    const [a, b] = ['A', 'B'].map((title) => question(quiz, objective, { title }));
    await startSession(quiz);
    quizService.hasCompletedQuiz.mockResolvedValue(true);
    quizService.getQuizQuestionsForStudent
      .mockResolvedValueOnce([picked(a)])
      .mockResolvedValueOnce([picked(b)]);

    expect(idsOf(await delivery.getStudentQuestions(quiz, USER_ID))).toEqual([String(a._id)]);
    expect(idsOf(await delivery.getStudentQuestions(quiz, USER_ID))).toEqual([String(b._id)]);
    expect(sessionOf(quiz).servedQuestions).toBeUndefined();
  });

  it('serves an all-approved quiz as before and keeps nothing', async () => {
    const quiz = quizDoc({ deliveryFormat: 'all-approved' });
    const doc = question(quiz, new ObjectId());
    await startSession(quiz);
    quizService.getQuizQuestionsForStudent.mockResolvedValue([doc]);

    expect(idsOf(await delivery.getStudentQuestions(quiz, USER_ID))).toEqual([String(doc._id)]);
    expect(quizService.hasCompletedQuiz).not.toHaveBeenCalled();
    expect(sessionOf(quiz).servedQuestions).toBeUndefined();
  });
});

describe('getStudentQuestionCounts', () => {
  it('counts the kept pick of a started attempt', async () => {
    const quiz = quizDoc();
    const earlier = quizDoc({ name: 'Earlier' });
    const here = question(quiz, new ObjectId());
    const review = question(earlier, new ObjectId());
    await startSession(quiz);
    sessionOf(quiz).servedQuestions = [
      { questionId: here._id, phase: 1 },
      { questionId: review._id, phase: 3 },
    ];

    expect(await delivery.getStudentQuestionCounts(quiz, USER_ID)).toEqual({
      questionCount: 2,
      phase1Count: 1,
      phase2Count: 0,
      phase3Count: 1,
    });
    expect(quizService.getQuizQuestionsForStudent).not.toHaveBeenCalled();
  });

  it('previews a fresh pick without keeping it', async () => {
    const quiz = quizDoc();
    const here = question(quiz, new ObjectId());
    quizService.getQuizQuestionsForStudent.mockResolvedValue([picked(here), picked(here, 2)]);

    expect(await delivery.getStudentQuestionCounts(quiz, USER_ID)).toMatchObject({
      questionCount: 2,
      phase1Count: 1,
      phase2Count: 1,
    });
    expect(fake.docs('grasp_quiz_session')).toEqual([]);
  });
});

describe('scoredQuestionIds', () => {
  it('scores the kept questions still served, plus answered ones removed since', async () => {
    const quiz = quizDoc();
    const served = question(quiz, new ObjectId());
    const removedUnanswered = question(quiz, new ObjectId(), { status: 'Draft' });
    const removedAnswered = question(quiz, new ObjectId(), { status: 'Draft' });
    const neverServed = question(quiz, new ObjectId());
    const session = {
      servedQuestions: [served, removedUnanswered, removedAnswered].map((doc) => ({
        questionId: doc._id,
        phase: 1,
      })),
    };
    const attempts = [answer(quiz, removedAnswered), answer(quiz, neverServed)];

    const scored = await delivery.scoredQuestionIds(quiz, USER_ID, session, attempts);

    expect([...scored].sort()).toEqual([String(served._id), String(removedAnswered._id)].sort());
  });

  it('leaves an attempt without a kept pick to the recorded count', async () => {
    const quiz = quizDoc();

    expect(await delivery.scoredQuestionIds(quiz, USER_ID, { questionCount: 5 }, [])).toBeNull();
    expect(await delivery.scoredQuestionIds(quiz, USER_ID, null, [])).toBeNull();
  });
});

describe('canAnswerQuestion', () => {
  let earlier;
  let quiz;
  let later;

  beforeEach(() => {
    earlier = quizDoc({ name: 'Earlier' });
    quiz = quizDoc({ name: 'Current' });
    later = quizDoc({ name: 'Later' });
    quizService.getCourseQuizzesInStudentOrder.mockResolvedValue([earlier, quiz, later]);
  });

  it('takes a graded answer only to a question of the kept pick', async () => {
    const objective = new ObjectId();
    const keptVariant = question(quiz, objective);
    const otherVariant = question(quiz, objective);
    await startSession(quiz);
    sessionOf(quiz).servedQuestions = [{ questionId: keptVariant._id, phase: 1 }];

    expect(await delivery.canAnswerQuestion(quiz, USER_ID, String(keptVariant._id))).toBe(true);
    expect(await delivery.canAnswerQuestion(quiz, USER_ID, String(otherVariant._id))).toBe(false);
  });

  it('takes no graded answer before the quiz page has started the attempt', async () => {
    const doc = question(quiz, new ObjectId());

    expect(await delivery.canAnswerQuestion(quiz, USER_ID, String(doc._id))).toBe(false);
  });

  it('takes, for an attempt started before picks were kept, what the quiz could serve', async () => {
    const own = question(quiz, new ObjectId());
    const review = question(earlier, new ObjectId());
    const ahead = question(later, new ObjectId());
    const unapproved = question(quiz, new ObjectId(), { status: 'Draft' });
    await startSession(quiz);

    expect(await delivery.canAnswerQuestion(quiz, USER_ID, String(own._id))).toBe(true);
    expect(await delivery.canAnswerQuestion(quiz, USER_ID, String(review._id))).toBe(true);
    expect(await delivery.canAnswerQuestion(quiz, USER_ID, String(ahead._id))).toBe(false);
    expect(await delivery.canAnswerQuestion(quiz, USER_ID, String(unapproved._id))).toBe(false);
  });

  it('takes in practice any approved question the quiz could serve', async () => {
    const keptVariant = question(quiz, new ObjectId());
    const otherVariant = question(quiz, new ObjectId());
    const review = question(earlier, new ObjectId());
    const ahead = question(later, new ObjectId());
    await startSession(quiz);
    sessionOf(quiz).servedQuestions = [{ questionId: keptVariant._id, phase: 1 }];
    const practice = { practice: true };

    expect(await delivery.canAnswerQuestion(quiz, USER_ID, String(otherVariant._id), practice)).toBe(true);
    expect(await delivery.canAnswerQuestion(quiz, USER_ID, String(review._id), practice)).toBe(true);
    expect(await delivery.canAnswerQuestion(quiz, USER_ID, String(ahead._id), practice)).toBe(false);
  });

  it('takes an answer to an all-approved quiz only for its own approved questions', async () => {
    const plain = quizDoc({ deliveryFormat: 'all-approved' });
    const own = question(plain, new ObjectId());
    const unapproved = question(plain, new ObjectId(), { status: 'Draft' });
    const elsewhere = question(earlier, new ObjectId());

    expect(await delivery.canAnswerQuestion(plain, USER_ID, String(own._id))).toBe(true);
    expect(await delivery.canAnswerQuestion(plain, USER_ID, String(unapproved._id))).toBe(false);
    expect(await delivery.canAnswerQuestion(plain, USER_ID, String(elsewhere._id))).toBe(false);
    expect(await delivery.canAnswerQuestion(plain, USER_ID, 'not-an-id')).toBe(false);
  });
});
