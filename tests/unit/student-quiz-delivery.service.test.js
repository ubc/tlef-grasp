// Which questions a student may answer in a quiz (issue #168): an approved
// question the quiz could serve them, so an answer cannot be recorded under a
// quiz for any question at all. The student order of a course's quizzes
// (quiz.js) is stubbed; everything else runs against a small in-memory
// stand-in for MongoDB.

const { ObjectId } = require('mongodb');

jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/services/quiz', () => ({
  getCourseQuizzesInStudentOrder: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const quizService = require('../../src/services/quiz');
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

beforeEach(() => {
  fake = createFakeDb();
  databaseService.connect.mockResolvedValue(fake.db);
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

  it('takes an answer to an approved question the quiz could serve', async () => {
    const own = question(quiz, new ObjectId());
    const review = question(earlier, new ObjectId());
    const ahead = question(later, new ObjectId());
    const unapproved = question(quiz, new ObjectId(), { status: 'Draft' });

    expect(await delivery.canAnswerQuestion(quiz, USER_ID, String(own._id))).toBe(true);
    expect(await delivery.canAnswerQuestion(quiz, USER_ID, String(review._id))).toBe(true);
    expect(await delivery.canAnswerQuestion(quiz, USER_ID, String(ahead._id))).toBe(false);
    expect(await delivery.canAnswerQuestion(quiz, USER_ID, String(unapproved._id))).toBe(false);
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
