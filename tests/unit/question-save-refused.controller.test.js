// A bank import must say how many questions were refused (a multiple-answer
// question with no correct option, say), and why, whatever happened to the
// rest. "Every question already exists" is only for imports where every
// question really was a duplicate. See ubc/tlef-grasp#183.

jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/utils/course-access', () => ({
  ...jest.requireActual('../../src/utils/course-access'),
  hasStaffAccessInCourse: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/utils/co-instructor-permissions', () => ({
  ...jest.requireActual('../../src/utils/co-instructor-permissions'),
  assertCoInstructorPermission: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/utils/ta-permissions', () => ({
  ...jest.requireActual('../../src/utils/ta-permissions'),
  assertTaPermission: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/utils/auth', () => ({
  ...jest.requireActual('../../src/utils/auth'),
  isFaculty: jest.fn().mockResolvedValue(true),
}));

const { ObjectId } = require('mongodb');
const databaseService = require('../../src/services/database');
const { saveQuestionHandler } = require('../../src/controllers/question');
const { QUESTION_TYPES } = require('../../src/constants/app-constants');

const COURSE_ID = new ObjectId().toString();
const OPTIONS = {
  A: { text: 'Neon', feedback: '' },
  B: { text: 'Nitrogen', feedback: '' },
};

const mcQuestion = (title = 'Which is a noble gas?') => ({
  questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
  title,
  stem: title,
  options: OPTIONS,
  correctAnswer: 'A',
  bloom: 'Remember',
});

// Ungradable: no option is marked correct.
const refusedMaQuestion = (title = 'Which are noble gases?') => ({
  questionType: QUESTION_TYPES.MULTIPLE_ANSWER,
  title,
  stem: title,
  options: OPTIONS,
  correctAnswer: [],
  bloom: 'Remember',
});

// `existing` are questions already in the course, which the import's dedupe
// check finds.
function mockDb(existing = []) {
  const questions = {
    insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn((query) => ({
      toArray: jest.fn().mockResolvedValue(
        existing.filter((q) => q.questionType === query.questionType)
      ),
    })),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
  };
  databaseService.connect.mockResolvedValue({ collection: jest.fn(() => questions) });
  return questions;
}

const importQuestions = async (questions) => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  await saveQuestionHandler(
    { user: { id: 'u1' }, body: { courseId: COURSE_ID, dedupe: true, questions } },
    res
  );
  return { status: res.status.mock.calls[0]?.[0] ?? 200, body: res.json.mock.calls[0][0] };
};

const asStored = (q) => ({ ...q, _id: new ObjectId(), questionType: String(q.questionType).toLowerCase() });

let logSpy;
let errorSpy;
beforeAll(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('bank import with a refused multiple-answer question', () => {
  it('counts the refused question, and says why, when the others save', async () => {
    mockDb();

    const { status, body } = await importQuestions([mcQuestion(), refusedMaQuestion()]);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      savedCount: 1,
      duplicateCount: 0,
      invalidCount: 1,
      invalidReason: expect.stringMatching(/at least one option as correct/),
    });
  });

  it('names both the duplicate and the refusal when nothing saved', async () => {
    mockDb([asStored(mcQuestion())]);

    const { status, body } = await importQuestions([mcQuestion(), refusedMaQuestion()]);

    expect(status).toBe(400);
    expect(body.error).not.toMatch(/Every question already exists/);
    expect(body.error).toMatch(/^1 question already exists; 1 was refused: .*at least one option as correct/);
    expect(body).toMatchObject({ savedCount: 0, duplicateCount: 1, invalidCount: 1 });
  });

  it('pluralizes the counts when several were duplicates and refused', async () => {
    mockDb([asStored(mcQuestion('Q1')), asStored(mcQuestion('Q2'))]);

    const { status, body } = await importQuestions([
      mcQuestion('Q1'),
      mcQuestion('Q2'),
      refusedMaQuestion('M1'),
      refusedMaQuestion('M2'),
    ]);

    expect(status).toBe(400);
    expect(body.error).toMatch(/^2 questions already exist; 2 were refused: /);
  });

  it('gives the reason alone when the only question was refused', async () => {
    mockDb();

    const { status, body } = await importQuestions([refusedMaQuestion()]);

    expect(status).toBe(400);
    expect(body.error).toMatch(/at least one option as correct/);
    expect(body).toMatchObject({ savedCount: 0, duplicateCount: 0, invalidCount: 1 });
  });

  it('still says every question already exists when they all were duplicates', async () => {
    mockDb([asStored(mcQuestion())]);

    const { status, body } = await importQuestions([mcQuestion()]);

    expect(status).toBe(409);
    expect(body).toMatchObject({
      error: 'Every question already exists in this course.',
      savedCount: 0,
      duplicateCount: 1,
      invalidCount: 0,
    });
  });
});
