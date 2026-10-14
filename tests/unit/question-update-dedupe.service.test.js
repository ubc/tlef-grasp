// An edit must not make a question identical to another one under the same
// learning objective. Before this, an instructor could keep the questions of a
// deleted objective (orphaning them), re-import the quiz that recreated the
// objective, then re-attach the orphan to it: two copies of the same question
// under one objective, with nothing said.

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
const { updateQuestion } = require('../../src/services/question');
const { updateQuestionHandler } = require('../../src/controllers/question');
const { QUESTION_TYPES } = require('../../src/constants/app-constants');

const COURSE = new ObjectId();
const OBJECTIVE = new ObjectId();
const OTHER_OBJECTIVE = new ObjectId();
const DELETED_OBJECTIVE = new ObjectId();
const PARENT = new ObjectId();

const question = (overrides = {}) => ({
  _id: new ObjectId(),
  courseId: COURSE,
  questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
  title: 'Which gas do plants absorb?',
  stem: 'Select the best answer:',
  options: { A: { text: 'Carbon dioxide' }, B: { text: 'Oxygen' } },
  correctAnswer: 'A',
  status: 'Draft',
  granularObjectiveId: OBJECTIVE,
  learningObjectiveId: PARENT,
  ...overrides,
});

const orphan = (overrides = {}) =>
  question({ granularObjectiveId: DELETED_OBJECTIVE, orphaned: true, orphanedAt: new Date(), ...overrides });

// A small in-memory stand-in for the two collections updateQuestion reads, so
// the duplicate query really runs against the bank instead of a canned answer.
const sameId = (a, b) => String(a) === String(b);
const matches = (doc, filter) =>
  Object.entries(filter).every(([key, want]) =>
    want && typeof want === 'object' && '$ne' in want
      ? !sameId(doc[key], want.$ne)
      : sameId(doc[key], want)
  );

function useBank(questions) {
  const objectives = [
    { _id: OBJECTIVE, parent: PARENT },
    { _id: OTHER_OBJECTIVE, parent: PARENT },
  ];
  const collections = {
    grasp_question: {
      find: (filter) => ({ toArray: async () => questions.filter((doc) => matches(doc, filter)) }),
      findOne: async (filter) => questions.find((doc) => matches(doc, filter)) || null,
      updateOne: async (filter, { $set }) => {
        const doc = questions.find((d) => matches(d, filter));
        if (doc) Object.assign(doc, $set);
        return { acknowledged: true, modifiedCount: doc ? 1 : 0 };
      },
    },
    grasp_objective: {
      findOne: async (filter) => objectives.find((doc) => matches(doc, filter)) || null,
    },
  };
  databaseService.connect.mockResolvedValue({ collection: (name) => collections[name] });
}

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

describe('updateQuestion duplicate check', () => {
  it('refuses to re-attach an orphan to an objective that already has the same question', async () => {
    const attached = question();
    const kept = orphan();
    useBank([attached, kept]);

    await expect(
      updateQuestion(kept._id.toString(), { granularObjectiveId: OBJECTIVE.toString() })
    ).rejects.toMatchObject({ code: 'DUPLICATE_QUESTION' });

    expect(kept.orphaned).toBe(true);
    expect(kept.granularObjectiveId).toBe(DELETED_OBJECTIVE);
  });

  it('refuses an edit that makes a question match another under the same objective', async () => {
    const existing = question();
    const edited = question({ title: 'Which gas do plants release?' });
    useBank([existing, edited]);

    await expect(
      updateQuestion(edited._id.toString(), { title: '  which GAS do plants absorb? ' })
    ).rejects.toMatchObject({ code: 'DUPLICATE_QUESTION' });

    expect(edited.title).toBe('Which gas do plants release?');
  });

  it('saves a question whose content is resent unchanged', async () => {
    const only = question();
    useBank([only]);

    const result = await updateQuestion(only._id.toString(), {
      title: only.title,
      stem: only.stem,
      options: only.options,
      correctAnswer: 'A',
    });

    expect(result.modifiedCount).toBe(1);
  });

  it('allows the same question under a different objective', async () => {
    const elsewhere = question({ granularObjectiveId: OTHER_OBJECTIVE });
    const edited = question({ title: 'Which gas do plants release?' });
    useBank([elsewhere, edited]);

    await updateQuestion(edited._id.toString(), { title: 'Which gas do plants absorb?' });

    expect(edited.title).toBe('Which gas do plants absorb?');
  });

  it('does not check an orphan until it is re-attached', async () => {
    const first = orphan();
    const second = orphan({ title: 'Which gas do plants release?' });
    useBank([first, second]);

    await updateQuestion(second._id.toString(), { title: 'Which gas do plants absorb?' });

    expect(second.title).toBe('Which gas do plants absorb?');
  });

  it('still lets an existing duplicate be approved', async () => {
    const first = question();
    const second = question();
    useBank([first, second]);

    await updateQuestion(second._id.toString(), { status: 'Approved' });

    expect(second.status).toBe('Approved');
  });

  it('lets an existing duplicate be edited when the edit does not change what makes it one', async () => {
    const first = question();
    const second = question();
    useBank([first, second]);

    // The edit modal resends every content field on each save.
    await updateQuestion(second._id.toString(), {
      title: second.title,
      stem: second.stem,
      options: second.options,
      correctAnswer: 'A',
      bloom: 'Apply',
    });

    expect(second.bloom).toBe('Apply');
  });

  it('refuses to re-attach an orphan whose text was edited to match while orphaned', async () => {
    const attached = question();
    const kept = orphan({ title: 'Which gas do plants release?' });
    useBank([attached, kept]);

    await updateQuestion(kept._id.toString(), { title: 'Which gas do plants absorb?' });
    await expect(
      updateQuestion(kept._id.toString(), { granularObjectiveId: OBJECTIVE.toString() })
    ).rejects.toMatchObject({ code: 'DUPLICATE_QUESTION' });

    expect(kept.orphaned).toBe(true);
  });
});

describe('updateQuestion duplicate check with stem images', () => {
  const image = (fileId) => ({ fileId, filename: 'leaf.png', mimeType: 'image/png', size: 10, caption: '' });
  const leaf = new ObjectId().toString();
  const root = new ObjectId().toString();

  it('allows matching text when the stem images differ', async () => {
    const existing = question({ stemImages: [image(leaf)] });
    const edited = question({ title: 'Which gas do plants release?', stemImages: [image(root)] });
    useBank([existing, edited]);

    await updateQuestion(edited._id.toString(), { title: 'Which gas do plants absorb?' });

    expect(edited.title).toBe('Which gas do plants absorb?');
  });

  it('refuses matching text when the stem images match too', async () => {
    const existing = question({ stemImages: [image(leaf)] });
    const edited = question({ title: 'Which gas do plants release?', stemImages: [image(leaf)] });
    useBank([existing, edited]);

    await expect(
      updateQuestion(edited._id.toString(), { title: 'Which gas do plants absorb?' })
    ).rejects.toMatchObject({ code: 'DUPLICATE_QUESTION' });
  });

  it('refuses an image swap that makes the question match another', async () => {
    const existing = question({ stemImages: [image(leaf)] });
    const edited = question({ stemImages: [image(root)] });
    useBank([existing, edited]);

    await expect(
      updateQuestion(edited._id.toString(), { stemImages: [image(leaf)] })
    ).rejects.toMatchObject({ code: 'DUPLICATE_QUESTION' });

    expect(edited.stemImages[0].fileId).toBe(root);
  });
});

describe('updateQuestionHandler duplicate check', () => {
  it('answers 409 with a reason the instructor can act on, coded for the popup', async () => {
    const existing = question();
    const edited = question({ title: 'Which gas do plants release?' });
    useBank([existing, edited]);
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };

    await updateQuestionHandler(
      {
        user: { _id: new ObjectId().toString() },
        params: { questionId: edited._id.toString() },
        body: { title: 'Which gas do plants absorb?' },
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: expect.stringMatching(/\S/),
      code: 'DUPLICATE_QUESTION',
    });
  });
});
