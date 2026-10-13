// createQuiz and Canvas import provenance (#140). The importer passes the
// Canvas quiz it came from (`source`) and a creation time, so re-import finds
// the quiz and imported quizzes sort in Canvas due order. Anything else gets
// the shape it always had. Neither POST /api/quiz, PUT /api/quiz/:quizId nor
// POST /api/quiz/:quizId/questions takes provenance (or the import's
// `importLinkedItems`) from a client.

jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
// Loading the quiz controller would otherwise start the LLM client.
jest.mock('../../src/services/answer-grading', () => ({}));
// Auth and permission checks are covered by their own suites.
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
const quizService = require('../../src/services/quiz');
const { createQuizHandler, updateQuizHandler, addQuizQuestionsHandler } = require('../../src/controllers/quiz');

const NOW = new Date('2026-10-07T17:00:00.000Z');
const COURSE_ID = new ObjectId().toString();
const SOURCE = { kind: 'canvas-classic', quizIdent: 'g0quiz0000000000000000000000000a1' };

// Every field createQuiz wrote before #140, in insertion order.
const LEGACY_QUIZ_KEYS = [
  'courseId',
  'name',
  'description',
  'published',
  'deliveryFormat',
  'disablePreviousNavigation',
  'timeLimitMinutes',
  'createdAt',
  'updatedAt',
];

function mockDb() {
  const byName = new Map();
  const collection = (name) => {
    if (!byName.has(name)) {
      byName.set(name, {
        insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
        insertMany: jest.fn().mockResolvedValue({ insertedCount: 1 }),
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })),
      });
    }
    return byName.get(name);
  };
  databaseService.connect.mockResolvedValue({ collection: jest.fn(collection) });
  return collection;
}

beforeEach(() => {
  // Only the clock is faked: the code under test awaits promises, not timers.
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('createQuiz import provenance', () => {
  it('stores the Canvas quiz source and the given creation time', async () => {
    const collection = mockDb();
    const createdAt = new Date('2026-01-15T08:00:00.000Z');

    const quiz = await quizService.createQuiz(COURSE_ID, {
      name: 'Thermochemistry quiz',
      deliveryFormat: 'spaced-3phase',
      timeLimitMinutes: 30,
      source: SOURCE,
      createdAt,
    });

    const inserted = collection('grasp_quiz').insertOne.mock.calls[0][0];
    expect(inserted.source).toEqual(SOURCE);
    expect(inserted.createdAt).toEqual(createdAt);
    expect(inserted.updatedAt).toEqual(NOW);
    expect(inserted.deliveryFormat).toBe('spaced-3phase');
    expect(Object.keys(inserted)).toEqual([...LEGACY_QUIZ_KEYS, 'source']);
    // The instructor gets the stored quiz back, provenance included.
    expect(quiz.source).toEqual(SOURCE);
  });

  it('keeps only kind and quizIdent, each capped at 200 characters', async () => {
    const collection = mockDb();

    await quizService.createQuiz(COURSE_ID, {
      name: 'Quiz',
      deliveryFormat: 'spaced-3phase',
      source: {
        kind: 'canvas-classic',
        quizIdent: 'q'.repeat(240),
        itemIdent: 'g0item',
        url: 'https://canvas.example.test/courses/1/quizzes/2',
      },
    });

    expect(collection('grasp_quiz').insertOne.mock.calls[0][0].source).toEqual({
      kind: 'canvas-classic',
      quizIdent: 'q'.repeat(200),
    });
  });

  it('writes no source for a quiz created without one', async () => {
    const collection = mockDb();

    await quizService.createQuiz(COURSE_ID, { name: 'Practice', deliveryFormat: 'all-approved' });

    const inserted = collection('grasp_quiz').insertOne.mock.calls[0][0];
    expect(Object.keys(inserted)).toEqual(LEGACY_QUIZ_KEYS);
    expect(inserted.createdAt).toEqual(NOW);
  });

  it.each([
    ['a string', 'canvas-classic'],
    ['an array', [SOURCE]],
    ['an object without quizIdent', { kind: 'canvas-classic' }],
    ['an object with a numeric quizIdent', { kind: 'canvas-classic', quizIdent: 12 }],
  ])('writes no source when it is %s', async (_label, source) => {
    const collection = mockDb();

    await quizService.createQuiz(COURSE_ID, { name: 'Quiz', deliveryFormat: 'all-approved', source });

    expect(Object.keys(collection('grasp_quiz').insertOne.mock.calls[0][0])).toEqual(LEGACY_QUIZ_KEYS);
  });

  it.each([
    ['an ISO string', '2026-01-15T08:00:00.000Z'],
    ['a timestamp', 1768464000000],
    ['an invalid Date', new Date('not a date')],
    ['null', null],
  ])('uses the current time when createdAt is %s', async (_label, createdAt) => {
    const collection = mockDb();

    await quizService.createQuiz(COURSE_ID, { name: 'Quiz', deliveryFormat: 'all-approved', createdAt });

    expect(collection('grasp_quiz').insertOne.mock.calls[0][0].createdAt).toEqual(NOW);
  });
});

describe('client-sent provenance', () => {
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

  it('POST /api/quiz creates the quiz and its new questions without source, importWarnings, importLinkedItems or a client createdAt', async () => {
    const collection = mockDb();
    const res = makeRes();

    await createQuizHandler(
      {
        user: { _id: new ObjectId().toString() },
        body: {
          courseId: COURSE_ID,
          name: 'Imported by hand',
          deliveryFormat: 'all-approved',
          source: SOURCE,
          importLinkedItems: ['g0forgeditem'],
          createdAt: '2020-01-01T00:00:00.000Z',
          newQuestions: [
            {
              questionType: 'multiple-choice',
              title: 'Which gas does the reaction release?',
              stem: 'Select the best answer:',
              options: { A: { text: 'Oxygen' }, B: { text: 'Carbon dioxide' } },
              correctAnswer: 'B',
              status: 'Draft',
              source: { ...SOURCE, itemIdent: 'g0item', slotIdent: 'g0slot' },
              importWarnings: ['Forged warning'],
            },
          ],
        },
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, questionsAdded: 1 });

    const quizDoc = collection('grasp_quiz').insertOne.mock.calls[0][0];
    expect(Object.keys(quizDoc)).toEqual(LEGACY_QUIZ_KEYS);
    expect(quizDoc.createdAt).toEqual(NOW);

    const questionDoc = collection('grasp_question').insertOne.mock.calls[0][0];
    expect(questionDoc).not.toHaveProperty('source');
    expect(questionDoc).not.toHaveProperty('importWarnings');
    expect(questionDoc.title).toBe('Which gas does the reaction release?');
  });

  it('PUT /api/quiz/:quizId updates only the editable settings, never source or importLinkedItems', async () => {
    const collection = mockDb();
    const res = makeRes();
    const quizId = new ObjectId().toString();
    collection('grasp_quiz').findOne.mockResolvedValue({
      _id: new ObjectId(quizId),
      courseId: new ObjectId(COURSE_ID),
      name: 'Thermochemistry quiz',
      source: SOURCE,
      importLinkedItems: ['g0item'],
    });

    await updateQuizHandler(
      {
        user: { _id: new ObjectId().toString() },
        params: { quizId },
        body: {
          name: 'Renamed quiz',
          published: true,
          source: { kind: 'canvas-classic', quizIdent: 'g0forgedquiz' },
          importLinkedItems: ['g0forgeditem'],
          importWarnings: ['Forged warning'],
        },
      },
      res
    );

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, result: { matchedCount: 1, modifiedCount: 1 } });
    expect(collection('grasp_quiz').updateOne).toHaveBeenCalledWith(
      { _id: new ObjectId(quizId) },
      { $set: { name: 'Renamed quiz', published: true, updatedAt: NOW } }
    );
  });

  it('POST /api/quiz/:quizId/questions saves and adds the questions without source or importWarnings', async () => {
    const collection = mockDb();
    const res = makeRes();
    const quizId = new ObjectId().toString();

    await addQuizQuestionsHandler(
      {
        user: { _id: new ObjectId().toString() },
        params: { quizId },
        body: {
          courseId: COURSE_ID,
          questions: [
            {
              questionType: 'multiple-choice',
              title: 'Which gas does the reaction release?',
              stem: 'Select the best answer:',
              options: { A: { text: 'Oxygen' }, B: { text: 'Carbon dioxide' } },
              correctAnswer: 'B',
              status: 'Draft',
              source: { ...SOURCE, itemIdent: 'g0item', slotIdent: 'g0slot' },
              importWarnings: ['Forged warning'],
            },
          ],
        },
      },
      res
    );

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      result: { insertedCount: 1 },
      questionsAdded: 1,
    });

    const questionDoc = collection('grasp_question').insertOne.mock.calls[0][0];
    expect(questionDoc).not.toHaveProperty('source');
    expect(questionDoc).not.toHaveProperty('importWarnings');
    expect(questionDoc.title).toBe('Which gas does the reaction release?');
    expect(questionDoc.courseId).toEqual(new ObjectId(COURSE_ID));

    // The saved question is the one linked to the quiz.
    const { insertedId } = await collection('grasp_question').insertOne.mock.results[0].value;
    expect(collection('grasp_quiz_question').insertMany).toHaveBeenCalledWith([
      { quizId: new ObjectId(quizId), questionId: insertedId, createdAt: NOW },
    ]);
  });
});
