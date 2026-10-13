// Canvas import provenance on questions (#140). saveQuestion keeps a
// whitelisted, capped `source` and `importWarnings` when the importer passes
// them, writes neither field otherwise (documents created any other way keep
// their exact shape), and updateQuestion never lets an edit change them.

const { ObjectId } = require('mongodb');

jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
// GridFS deletes are a storage boundary; collectQuestionImageIds stays real.
jest.mock('../../src/services/image', () => ({
  ...jest.requireActual('../../src/services/image'),
  deleteImages: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const questionService = require('../../src/services/question');

const COURSE_ID = new ObjectId();
const GRANULAR_ID = new ObjectId();
const PARENT_ID = new ObjectId();

const SOURCE = {
  kind: 'canvas-classic',
  quizIdent: 'g0quiz0000000000000000000000000a1',
  itemIdent: 'g0item0000000000000000000000000b2',
  slotIdent: 'g0slot0000000000000000000000000c3',
};

// Every field saveQuestion wrote before #140, in insertion order. A question
// saved without provenance must still have exactly these.
const LEGACY_QUESTION_KEYS = [
  'title',
  'stem',
  'stemImages',
  'options',
  'correctAnswer',
  'questionType',
  'acceptableAnswers',
  'openEndedSampleAnswer',
  'openEndedGradingCriteria',
  'calculationFormula',
  'calculationVariables',
  'calculationAnswerDecimals',
  'calculationTolerance',
  'calculationAnswerTolerancePercent',
  'bloom',
  'courseId',
  'learningObjectiveId',
  'granularObjectiveId',
  'createdBy',
  'status',
  'flagStatus',
  'flagReason',
  'createdAt',
];

function mockDb() {
  const questions = {
    insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    findOne: jest.fn().mockResolvedValue(null),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true, matchedCount: 1, modifiedCount: 1 }),
  };
  const objectives = {
    findOne: jest.fn().mockResolvedValue({ _id: GRANULAR_ID, parent: PARENT_ID }),
  };
  databaseService.connect.mockResolvedValue({
    collection: jest.fn((name) => (name === 'grasp_objective' ? objectives : questions)),
  });
  return { questions };
}

const mcPayload = (overrides = {}) => ({
  questionType: 'multiple-choice',
  title: 'Which gas does the reaction release?',
  stem: 'Select the best answer:',
  options: {
    A: { text: 'Oxygen', feedback: '' },
    B: { text: 'Carbon dioxide', feedback: '' },
  },
  correctAnswer: 'B',
  bloom: 'Understand',
  granularObjectiveId: GRANULAR_ID.toString(),
  status: 'Draft',
  by: 'user-1',
  ...overrides,
});

async function savedDoc(payload) {
  const { questions } = mockDb();
  await questionService.saveQuestion(COURSE_ID.toString(), payload, { dedupe: false });
  expect(questions.insertOne).toHaveBeenCalledTimes(1);
  return questions.insertOne.mock.calls[0][0];
}

describe('saveQuestion import provenance', () => {
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

  it('stores the Canvas source and the conversion warnings after the usual fields', async () => {
    const doc = await savedDoc(
      mcPayload({
        source: SOURCE,
        importWarnings: ['An image could not be downloaded from Canvas.'],
      })
    );

    expect(doc.source).toEqual(SOURCE);
    expect(doc.importWarnings).toEqual(['An image could not be downloaded from Canvas.']);
    expect(Object.keys(doc)).toEqual([...LEGACY_QUESTION_KEYS, 'source', 'importWarnings']);
  });

  it('keeps only the four source keys', async () => {
    const doc = await savedDoc(
      mcPayload({
        source: {
          ...SOURCE,
          url: 'https://canvas.example.test/courses/1/files/2/download',
          bankIdent: 'g0bank',
          nested: { kind: 'other' },
        },
      })
    );

    expect(doc.source).toEqual(SOURCE);
  });

  it('caps each source field at 200 characters', async () => {
    const doc = await savedDoc(
      mcPayload({ source: { ...SOURCE, itemIdent: 'i'.repeat(250), slotIdent: 's'.repeat(200) } })
    );

    expect(doc.source).toEqual({ ...SOURCE, itemIdent: 'i'.repeat(200), slotIdent: 's'.repeat(200) });
  });

  it('keeps at most 20 warnings of 300 characters, dropping non-strings and blanks', async () => {
    const numbered = Array.from({ length: 25 }, (_, i) => `Warning ${i + 1}`);

    const doc = await savedDoc(
      mcPayload({ importWarnings: ['w'.repeat(350), 42, null, { message: 'x' }, '   ', ...numbered] })
    );

    expect(doc.importWarnings).toEqual(['w'.repeat(300), ...numbered.slice(0, 19)]);
    expect(doc.source).toBeUndefined();
  });

  it('writes neither field for a question saved without them', async () => {
    const doc = await savedDoc(mcPayload());

    expect(Object.keys(doc)).toEqual(LEGACY_QUESTION_KEYS);
  });

  it.each([
    ['null', null],
    ['a string', 'canvas-classic'],
    ['an array', [SOURCE]],
    ['an object missing slotIdent', { kind: 'canvas-classic', quizIdent: 'q', itemIdent: 'i' }],
    ['an object with a numeric itemIdent', { ...SOURCE, itemIdent: 7 }],
  ])('writes no source when it is %s', async (_label, source) => {
    const doc = await savedDoc(mcPayload({ source }));

    expect(Object.keys(doc)).toEqual(LEGACY_QUESTION_KEYS);
  });

  it.each([
    ['an empty array', []],
    ['an array with nothing usable', ['', '  ', 3, null]],
    ['a bare string', 'An image could not be downloaded from Canvas.'],
  ])('writes no importWarnings when they are %s', async (_label, importWarnings) => {
    const doc = await savedDoc(mcPayload({ importWarnings }));

    expect(Object.keys(doc)).toEqual(LEGACY_QUESTION_KEYS);
  });

  it('stores provenance on a numerical (calculation) import too', async () => {
    const doc = await savedDoc({
      questionType: 'calculation',
      title: 'Energy stored in the test cell',
      stem: 'Find the energy stored in the test cell, in kJ.',
      calculationFormula: '-123.4',
      calculationVariables: [],
      calculationAnswerDecimals: 1,
      calculationTolerance: { mode: 'absolute', value: 0.2 },
      bloom: 'Understand',
      granularObjectiveId: GRANULAR_ID.toString(),
      status: 'Approved',
      by: 'user-1',
      source: SOURCE,
    });

    expect(doc.source).toEqual(SOURCE);
    expect(doc.calculationTolerance).toEqual({ mode: 'absolute', value: 0.2 });
    expect(doc).not.toHaveProperty('importWarnings');
  });
});

describe('updateQuestion leaves import provenance alone', () => {
  let consoleErrorSpy;

  beforeAll(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('ignores source and importWarnings sent with an edit', async () => {
    const { questions } = mockDb();

    await questionService.updateQuestion(new ObjectId().toString(), {
      title: 'Edited prompt',
      source: { ...SOURCE, itemIdent: 'g0forged' },
      importWarnings: [],
    });

    expect(questions.updateOne).toHaveBeenCalledTimes(1);
    expect(questions.updateOne.mock.calls[0][1]).toEqual({
      $set: { updatedAt: expect.any(Date), title: 'Edited prompt' },
    });
  });

  it('approving a question does not clear or rewrite its provenance', async () => {
    const { questions } = mockDb();

    await questionService.updateQuestion(new ObjectId().toString(), {
      status: 'Approved',
      source: null,
      importWarnings: null,
    });

    expect(questions.updateOne.mock.calls[0][1]).toEqual({
      $set: { updatedAt: expect.any(Date), status: 'Approved' },
    });
  });
});
