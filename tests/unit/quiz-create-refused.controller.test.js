// A quiz import must say how many questions were refused (a multiple-answer
// question with no valid correct option, say), and why, while still importing
// the valid ones. Refusals are expected for a bad file, not server errors.
// See ubc/tlef-grasp#182.

jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
// Loading the quiz controller would otherwise start the LLM client.
jest.mock('../../src/services/answer-grading', () => ({}));
jest.mock('../../src/utils/auth', () => ({
  ...jest.requireActual('../../src/utils/auth'),
  isFaculty: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/utils/co-instructor-permissions', () => ({
  ...jest.requireActual('../../src/utils/co-instructor-permissions'),
  assertCoInstructorPermission: jest.fn().mockResolvedValue(true),
}));

const { ObjectId } = require('mongodb');
const databaseService = require('../../src/services/database');
const { createQuizHandler } = require('../../src/controllers/quiz');
const { QUESTION_TYPES } = require('../../src/constants/app-constants');

const COURSE_ID = new ObjectId().toString();
const OPTIONS = {
  A: { text: 'Neon', feedback: '' },
  B: { text: 'Nitrogen', feedback: '' },
  C: { text: 'Argon', feedback: '' },
};

const mcQuestion = (title = 'Which is a noble gas?') => ({
  questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
  title,
  stem: title,
  options: OPTIONS,
  correctAnswer: 'A',
  bloom: 'Remember',
});

const maQuestion = (correctAnswer, title = 'Which are noble gases?') => ({
  questionType: QUESTION_TYPES.MULTIPLE_ANSWER,
  title,
  stem: title,
  options: OPTIONS,
  correctAnswer,
  bloom: 'Remember',
});

// `existing` are questions already in the course, which the import's dedupe
// check finds. Question ids inserted into the quiz are recorded.
function mockDb(existing = []) {
  const byName = new Map();
  const collection = (name) => {
    if (!byName.has(name)) {
      byName.set(name, {
        insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
        insertMany: jest.fn((docs) => Promise.resolve({ insertedCount: docs.length })),
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn((query = {}) => ({
          toArray: jest.fn().mockResolvedValue(
            name === 'grasp_question'
              ? existing.filter((q) => q.questionType === query.questionType)
              : []
          ),
        })),
      });
    }
    return byName.get(name);
  };
  databaseService.connect.mockResolvedValue({ collection: jest.fn(collection) });
  return collection;
}

const asStored = (q) => ({ ...q, _id: new ObjectId(), questionType: String(q.questionType).toLowerCase() });

const importQuiz = async (newQuestions, extra = {}) => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  await createQuizHandler(
    {
      user: { id: 'u1' },
      body: { courseId: COURSE_ID, name: 'Imported quiz', deliveryFormat: 'all-approved', newQuestions, ...extra },
    },
    res
  );
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
};

let logSpy;
let errorSpy;
beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

// A refusal is the file's fault, so neither saveQuestion nor the handler may
// log it as a server error.
const loggedAnError = () => errorSpy.mock.calls.length > 0;

describe('quiz import with a refused multiple-answer question', () => {
  it.each([
    ['no option marked correct', [], /at least one option as correct/],
    ['a correct letter with no option', ['A', 'D'], /Option D is marked correct/],
  ])('imports the valid question and reports the one with %s', async (_label, correctAnswer, reason) => {
    mockDb();

    const { status, body } = await importQuiz([mcQuestion(), maQuestion(correctAnswer)]);

    expect(status).toBe(201);
    expect(body).toMatchObject({
      success: true,
      questionsAdded: 1,
      duplicateCount: 0,
      invalidCount: 1,
      invalidReason: expect.stringMatching(reason),
    });
    expect(loggedAnError()).toBe(false);
  });

  it('counts duplicates and refusals separately', async () => {
    mockDb([asStored(mcQuestion('Q1'))]);

    const { body } = await importQuiz([
      mcQuestion('Q1'),
      mcQuestion('Q2'),
      maQuestion([], 'M1'),
      // Only A to H are letters, so "Z" leaves no correct option.
      maQuestion(['Z'], 'M2'),
    ]);

    expect(body).toMatchObject({
      questionsAdded: 1,
      duplicateCount: 1,
      invalidCount: 2,
      invalidReason: expect.stringMatching(/at least one option as correct/),
    });
  });

  it.each([
    [1, /^No quiz was created: its only question was refused\. Mark at least one option as correct\.$/],
    [3, /^No quiz was created: all 3 questions were refused\. Mark at least one option as correct\.$/],
  ])('creates no quiz, and saves nothing, when all %i questions were refused', async (n, message) => {
    const collection = mockDb();

    const refused = Array.from({ length: n }, (_, i) => maQuestion([], `M${i}`));
    const { status, body } = await importQuiz(refused);

    expect(status).toBe(400);
    expect(body).toMatchObject({
      success: false,
      code: 'ALL_QUESTIONS_REFUSED',
      error: expect.stringMatching(message),
      questionsAdded: 0,
      invalidCount: n,
    });
    expect(collection('grasp_quiz').insertOne).not.toHaveBeenCalled();
    expect(collection('grasp_question').insertOne).not.toHaveBeenCalled();
    expect(loggedAnError()).toBe(false);
  });

  // Only a file whose every question was refused is turned away.
  it('still creates the quiz when the others were duplicates', async () => {
    const collection = mockDb([asStored(mcQuestion())]);

    const { status, body } = await importQuiz([mcQuestion(), maQuestion([])]);

    expect(status).toBe(201);
    expect(body).toMatchObject({ success: true, questionsAdded: 0, duplicateCount: 1, invalidCount: 1 });
    expect(collection('grasp_quiz').insertOne).toHaveBeenCalledTimes(1);
  });

  it('still creates the quiz when existing questions were attached too', async () => {
    const collection = mockDb();

    const { status, body } = await importQuiz([maQuestion([])], { questionIds: [new ObjectId().toString()] });

    expect(status).toBe(201);
    expect(body).toMatchObject({ success: true, questionsAdded: 1, invalidCount: 1 });
    expect(collection('grasp_quiz').insertOne).toHaveBeenCalledTimes(1);
  });

  it('reports no refusals for a clean import', async () => {
    mockDb();

    const { body } = await importQuiz([mcQuestion(), maQuestion(['A', 'C'])]);

    expect(body).toMatchObject({ questionsAdded: 2, invalidCount: 0, invalidReason: null });
  });
});

// POST /api/quiz/:quizId/questions saves new questions straight into an
// existing quiz. It used to report a refusal only when nothing saved.
describe('adding new questions to an existing quiz', () => {
  const { addQuizQuestionsHandler } = require('../../src/controllers/quiz');

  const addQuestions = async (questions) => {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    await addQuizQuestionsHandler(
      { user: { id: 'u1' }, params: { quizId: new ObjectId().toString() }, body: { courseId: COURSE_ID, questions } },
      res
    );
    return { status: res.status.mock.calls[0]?.[0] ?? 200, body: res.json.mock.calls[0][0] };
  };

  it('adds the valid question and reports the refused one', async () => {
    mockDb();

    const { status, body } = await addQuestions([mcQuestion(), maQuestion([])]);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      questionsAdded: 1,
      invalidCount: 1,
      invalidReason: expect.stringMatching(/at least one option as correct/),
    });
    expect(loggedAnError()).toBe(false);
  });

  it('gives the reason and the count when nothing saved', async () => {
    mockDb();

    const { status, body } = await addQuestions([maQuestion([], 'M1'), maQuestion(['A', 'D'], 'M2')]);

    expect(status).toBe(400);
    expect(body).toMatchObject({
      success: false,
      error: expect.stringMatching(/at least one option as correct/),
      questionsAdded: 0,
      invalidCount: 2,
    });
  });

  it('reports no refusals when every question saved', async () => {
    mockDb();

    const { body } = await addQuestions([mcQuestion()]);

    expect(body).toMatchObject({ success: true, questionsAdded: 1, invalidCount: 0, invalidReason: null });
  });
});
