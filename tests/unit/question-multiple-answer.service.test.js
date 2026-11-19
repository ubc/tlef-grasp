// Multiple-answer questions ("select all that apply") store their correct
// options as a list of letters. Saving or editing one must leave it gradeable:
// at least one option marked correct, and only options it has. The other types
// are saved exactly as before.

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
const questionService = require('../../src/services/question');
const { saveQuestionHandler, updateQuestionHandler } = require('../../src/controllers/question');
const { QUESTION_TYPES } = require('../../src/constants/app-constants');

const COURSE_ID = new ObjectId().toString();

const OPTIONS = {
  A: { text: 'Neon', feedback: '' },
  B: { text: 'Nitrogen', feedback: 'Nitrogen is in group 15.' },
  C: { text: 'Argon', feedback: '' },
};

const maQuestion = (overrides = {}) => ({
  questionType: QUESTION_TYPES.MULTIPLE_ANSWER,
  title: 'Which of these are noble gases?',
  stem: 'Which of these are noble gases?',
  options: OPTIONS,
  correctAnswer: ['A', 'C'],
  bloom: 'Remember',
  ...overrides,
});

function mockDb(existing = null) {
  const questions = {
    insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    findOne: jest.fn().mockResolvedValue(existing),
    find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
  };
  databaseService.connect.mockResolvedValue({ collection: jest.fn(() => questions) });
  return questions;
}

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

let consoleLogSpy;
let consoleErrorSpy;

beforeAll(() => {
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

describe('saveQuestion with a multiple-answer question', () => {
  it('stores the correct options as letters in A to H order', async () => {
    const questions = mockDb();

    await questionService.saveQuestion(COURSE_ID, maQuestion({ correctAnswer: ['c', 'A', 'C'] }));

    const [doc] = questions.insertOne.mock.calls[0];
    expect(doc.questionType).toBe('multiple-answer');
    expect(doc.correctAnswer).toEqual(['A', 'C']);
    expect(doc.options).toEqual(OPTIONS);
  });

  it.each([
    ['no option marked correct', [], /at least one option as correct/],
    ['a correct letter with no option', ['A', 'D'], /Option D is marked correct/],
  ])('refuses %s', async (_label, correctAnswer, message) => {
    const questions = mockDb();

    await expect(
      questionService.saveQuestion(COURSE_ID, maQuestion({ correctAnswer }))
    ).rejects.toMatchObject({ code: 'INVALID_QUESTION', message: expect.stringMatching(message) });
    expect(questions.insertOne).not.toHaveBeenCalled();
  });

  it('saves a multiple-choice question as before, unchecked', async () => {
    const questions = mockDb();

    await questionService.saveQuestion(COURSE_ID, {
      ...maQuestion(),
      questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
      correctAnswer: 'b',
    });

    expect(questions.insertOne.mock.calls[0][0].correctAnswer).toBe('b');
  });
});

describe('updateQuestion with a multiple-answer question', () => {
  const id = new ObjectId().toString();

  it('normalizes a new set of correct options', async () => {
    const questions = mockDb({ _id: id, ...maQuestion() });

    await questionService.updateQuestion(id, { correctAnswer: ['C', 'B'] });

    expect(questions.updateOne.mock.calls[0][1].$set.correctAnswer).toEqual(['B', 'C']);
  });

  it('refuses options that drop a correct one', async () => {
    const questions = mockDb({ _id: id, ...maQuestion() });

    await expect(
      questionService.updateQuestion(id, { options: { A: OPTIONS.A, B: OPTIONS.B } })
    ).rejects.toMatchObject({ code: 'INVALID_QUESTION' });
    expect(questions.updateOne).not.toHaveBeenCalled();
  });

  it('checks a question being switched to multiple answer', async () => {
    const questions = mockDb({
      _id: id,
      ...maQuestion({ questionType: QUESTION_TYPES.MULTIPLE_CHOICE, correctAnswer: 'A' }),
    });

    await questionService.updateQuestion(id, {
      questionType: QUESTION_TYPES.MULTIPLE_ANSWER,
      correctAnswer: ['A', 'B'],
    });

    expect(questions.updateOne.mock.calls[0][1].$set.correctAnswer).toEqual(['A', 'B']);
  });

  it('leaves an update that touches neither the options nor the answer alone', async () => {
    const questions = mockDb({ _id: id, ...maQuestion() });

    await questionService.updateQuestion(id, { bloom: 'Apply' });

    expect(questions.findOne).not.toHaveBeenCalled();
    expect(questions.updateOne.mock.calls[0][1].$set.correctAnswer).toBeUndefined();
  });
});

describe('answerSignature for multiple answer', () => {
  it('ignores the order of the correct letters', () => {
    expect(questionService.answerSignature(maQuestion({ correctAnswer: ['C', 'A'] }))).toBe(
      questionService.answerSignature(maQuestion({ correctAnswer: ['A', 'C'] }))
    );
  });

  it('differs when the correct set differs, or from multiple choice', () => {
    const base = questionService.answerSignature(maQuestion());
    expect(questionService.answerSignature(maQuestion({ correctAnswer: ['A'] }))).not.toBe(base);
    expect(
      questionService.answerSignature({
        ...maQuestion(),
        questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
        correctAnswer: 'A',
      })
    ).not.toBe(base);
  });
});

describe('the save and edit routes report an ungradeable question', () => {
  it('answers 400 with the reason when nothing could be saved', async () => {
    mockDb();
    const res = makeRes();

    await saveQuestionHandler(
      {
        user: { _id: new ObjectId().toString() },
        body: { courseId: COURSE_ID, questions: [maQuestion({ correctAnswer: [] })] },
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Mark at least one option as correct.', savedCount: 0 })
    );
  });

  it('answers 400 with the reason when an edit would leave no correct option', async () => {
    const id = new ObjectId().toString();
    mockDb({ _id: id, courseId: COURSE_ID, status: 'Draft', ...maQuestion() });
    const res = makeRes();

    await updateQuestionHandler(
      {
        user: { _id: new ObjectId().toString() },
        params: { questionId: id },
        body: { correctAnswer: [] },
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Mark at least one option as correct.' });
  });
});
