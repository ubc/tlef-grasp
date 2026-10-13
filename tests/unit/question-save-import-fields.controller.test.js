// POST /api/question/save takes no Canvas import provenance from a client
// (#140). saveQuestion keeps a question's `source` and `importWarnings` when it
// is given them, and re-import counts a question whose source matches a Canvas
// item as already imported. So a client that could set them could hide a real
// Canvas item from every later import, or show a forged warning to
// instructors. Only the Canvas importer may write them.

jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
// Auth and permission checks are covered by their own suites.
jest.mock('../../src/utils/course-access', () => ({
  ...jest.requireActual('../../src/utils/course-access'),
  hasStaffAccessInCourse: jest.fn(),
}));
jest.mock('../../src/utils/co-instructor-permissions', () => ({
  ...jest.requireActual('../../src/utils/co-instructor-permissions'),
  assertCoInstructorPermission: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/utils/ta-permissions', () => ({
  ...jest.requireActual('../../src/utils/ta-permissions'),
  assertTaPermission: jest.fn().mockResolvedValue(true),
}));

const { ObjectId } = require('mongodb');
const databaseService = require('../../src/services/database');
const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const { saveQuestionHandler } = require('../../src/controllers/question');

const COURSE_ID = new ObjectId().toString();
const USER = { _id: new ObjectId().toString() };

const FORGED_SOURCE = {
  kind: 'canvas-classic',
  quizIdent: 'g0quiz0000000000000000000000000a1',
  itemIdent: 'g0item0000000000000000000000000b2',
  slotIdent: 'g0slot0000000000000000000000000c3',
};

const OPTIONS = {
  A: { text: 'Oxygen', feedback: '' },
  B: { text: 'Carbon dioxide', feedback: '' },
};

const forgedQuestion = () => ({
  questionType: 'multiple-choice',
  title: 'Which gas does the reaction release?',
  stem: 'Select the best answer:',
  options: OPTIONS,
  correctAnswer: 'B',
  bloom: 'Understand',
  status: 'Draft',
  source: FORGED_SOURCE,
  importWarnings: ['Forged warning'],
});

function mockDb() {
  const insertedId = new ObjectId();
  const questions = {
    insertOne: jest.fn().mockResolvedValue({ insertedId }),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })),
  };
  const collection = jest.fn(() => questions);
  databaseService.connect.mockResolvedValue({ collection });
  return { questions, collection, insertedId };
}

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

let consoleLogSpy;

beforeAll(() => {
  // saveQuestion logs every payload it saves.
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  consoleLogSpy.mockRestore();
});

describe('POST /api/question/save ignores client-sent provenance', () => {
  it('saves the question without the source or importWarnings the client sent', async () => {
    hasStaffAccessInCourse.mockResolvedValue(true);
    const { questions, collection, insertedId } = mockDb();
    const res = makeRes();

    await saveQuestionHandler({ user: USER, body: { courseId: COURSE_ID, questions: [forgedQuestion()] } }, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: '1 question(s) saved successfully',
      savedCount: 1,
      duplicateCount: 0,
      questionIds: [insertedId.toString()],
    });

    expect(collection).toHaveBeenCalledWith('grasp_question');
    expect(questions.insertOne).toHaveBeenCalledTimes(1);
    const doc = questions.insertOne.mock.calls[0][0];
    expect(doc).not.toHaveProperty('source');
    expect(doc).not.toHaveProperty('importWarnings');
    // Everything else the client sent is still saved.
    expect(doc).toMatchObject({
      title: 'Which gas does the reaction release?',
      stem: 'Select the best answer:',
      options: OPTIONS,
      correctAnswer: 'B',
      questionType: 'multiple-choice',
      status: 'Draft',
      courseId: new ObjectId(COURSE_ID),
    });
  });

  it('refuses a user without staff access in the course and saves nothing', async () => {
    hasStaffAccessInCourse.mockResolvedValue(false);
    const { questions } = mockDb();
    const res = makeRes();

    await saveQuestionHandler({ user: USER, body: { courseId: COURSE_ID, questions: [forgedQuestion()] } }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'User is not in course' });
    expect(questions.insertOne).not.toHaveBeenCalled();
  });
});
