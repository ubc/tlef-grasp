import { jest, describe, it, expect } from '@jest/globals';
import {
  saveQuestionsToBank,
  buildUpdatePayload,
  hasUnsavedEdits,
  questionSnapshot,
  quizSkipNote,
  orphanedNote,
  countUnsavedQuestions,
} from '../../client/src/pages/question-generation/bankSave.js';

const question = (id, extra = {}) => ({
  id,
  stem: `Stem ${id}`,
  questionType: 'multiple-choice',
  options: { A: { text: 'a' }, B: { text: 'b' } },
  correctAnswer: 'A',
  status: 'Draft',
  granularObjectiveId: 'g-1',
  learningObjectiveId: 'lo-1',
  ...extra,
});

// A question as it looks right after a save: bank id plus saved snapshot.
const saved = (id, extra = {}) => {
  const q = question(id, { _id: `db-${id}`, ...extra });
  return { ...q, bankSnapshot: questionSnapshot(q) };
};

const apiError = (status, message = `HTTP ${status}`) =>
  Object.assign(new Error(message), { status });

// Fakes PUT /api/question/:id (put), POST /api/question/save (save) and
// POST /api/question/existing (existing). By default everything succeeds.
const makeApi = ({ put, save, existing } = {}) => {
  const saveFn =
    save ||
    ((body) =>
      Promise.resolve({
        savedCount: body.questions.length,
        questionIdsByIndex: body.questions.map((_, i) => `new-${i}`),
      }));
  const existingFn =
    existing || ((body) => Promise.resolve({ existingIds: body.questionIds }));
  return {
    put: jest.fn(put || (() => Promise.resolve({ success: true }))),
    post: jest.fn((path, body) =>
      path === '/api/question/existing' ? existingFn(body) : saveFn(body)
    ),
  };
};

const saveCalls = (api) =>
  api.post.mock.calls.filter(([path]) => path === '/api/question/save');

describe('hasUnsavedEdits', () => {
  it('is false for a question unchanged since its save', () => {
    expect(hasUnsavedEdits(saved('q1'))).toBe(false);
  });

  it('is true once the question is edited', () => {
    expect(hasUnsavedEdits({ ...saved('q1'), stem: 'Edited' })).toBe(true);
  });

  it('treats a saved question with no snapshot (an old draft) as edited', () => {
    expect(hasUnsavedEdits(question('q1', { _id: 'db-q1' }))).toBe(true);
  });
});

describe('buildUpdatePayload', () => {
  it('never sends the objective, so a deleted objective cannot be re-attached', () => {
    const payload = buildUpdatePayload({ ...saved('q1'), stem: 'Edited' });
    expect(payload).not.toHaveProperty('granularObjectiveId');
    expect(payload).not.toHaveProperty('learningObjectiveId');
    expect(payload).not.toHaveProperty('by');
    expect(payload.stem).toBe('Edited');
  });

  it('leaves status out unless it was toggled since the last save', () => {
    expect(buildUpdatePayload({ ...saved('q1'), stem: 'Edited' })).not.toHaveProperty('status');
    expect(buildUpdatePayload({ ...saved('q1'), status: 'Approved' }).status).toBe('Approved');
  });

  it('leaves status out when there is no snapshot to compare against', () => {
    const payload = buildUpdatePayload(question('q1', { _id: 'db-q1', status: 'Approved' }));
    expect(payload).not.toHaveProperty('status');
  });
});

describe('saveQuestionsToBank', () => {
  it('creates new questions and does not touch unchanged saved ones', async () => {
    const api = makeApi();
    const result = await saveQuestionsToBank({
      api,
      courseId: 'c1',
      pageQuestions: [saved('q1'), question('q2')],
    });

    expect(api.put).not.toHaveBeenCalled();
    expect(saveCalls(api)).toHaveLength(1);
    expect(saveCalls(api)[0][1].questions).toHaveLength(1);
    expect(result.ids).toEqual(['db-q1', 'new-0']);
    expect(result.savedCount).toBe(2);
    expect(result.error).toBeUndefined();
    expect(result.saved.get('q2')).toEqual({
      _id: 'new-0',
      bankSnapshot: questionSnapshot(question('q2')),
    });
  });

  it('updates only the saved questions edited since their save', async () => {
    const api = makeApi();
    const edited = { ...saved('q1'), stem: 'Edited' };
    const result = await saveQuestionsToBank({
      api,
      courseId: 'c1',
      pageQuestions: [edited, saved('q2')],
    });

    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith('/api/question/db-q1', buildUpdatePayload(edited));
    expect(saveCalls(api)).toHaveLength(0);
    expect(result.ids).toEqual(['db-q1', 'db-q2']);
    // The new snapshot makes the question clean again.
    expect(hasUnsavedEdits({ ...edited, ...result.saved.get('q1') })).toBe(false);
  });

  it('saves a question as new when its bank copy was deleted (404)', async () => {
    const api = makeApi({ put: () => Promise.reject(apiError(404)) });
    const edited = { ...saved('q1'), stem: 'Edited' };
    const result = await saveQuestionsToBank({ api, courseId: 'c1', pageQuestions: [edited] });

    expect(saveCalls(api)).toHaveLength(1);
    // A re-created question keeps its objective.
    expect(saveCalls(api)[0][1].questions[0].granularObjectiveId).toBe('g-1');
    expect(result.ids).toEqual(['new-0']);
    expect(result.saved.get('q1')._id).toBe('new-0');
  });

  it('saves again a question deleted from the bank, even when unchanged', async () => {
    const api = makeApi({
      existing: () => Promise.resolve({ existingIds: ['db-q1'] }),
    });
    const result = await saveQuestionsToBank({
      api,
      courseId: 'c1',
      pageQuestions: [saved('q1'), saved('q2')],
    });

    expect(api.post).toHaveBeenCalledWith('/api/question/existing', {
      courseId: 'c1',
      questionIds: ['db-q1', 'db-q2'],
    });
    expect(api.put).not.toHaveBeenCalled();
    expect(saveCalls(api)).toHaveLength(1);
    expect(saveCalls(api)[0][1].questions.map((q) => q.stem)).toEqual(['Stem q2']);
    expect(result.ids).toEqual(['db-q1', 'new-0']);
    expect(result.saved.get('q2')._id).toBe('new-0');
  });

  it('does not try to update an edited question that was deleted from the bank', async () => {
    const api = makeApi({ existing: () => Promise.resolve({ existingIds: [] }) });
    const result = await saveQuestionsToBank({
      api,
      courseId: 'c1',
      pageQuestions: [{ ...saved('q1'), stem: 'Edited' }],
    });

    expect(api.put).not.toHaveBeenCalled();
    expect(saveCalls(api)[0][1].questions[0].stem).toBe('Edited');
    expect(result.ids).toEqual(['new-0']);
  });

  it('skips the existence check when nothing was saved before', async () => {
    const api = makeApi();
    await saveQuestionsToBank({ api, courseId: 'c1', pageQuestions: [question('q1')] });
    expect(api.post).not.toHaveBeenCalledWith('/api/question/existing', expect.anything());
  });

  it('reports an update failure, keeps the updates that worked and creates nothing', async () => {
    const api = makeApi({
      put: (path) =>
        path.endsWith('db-q1')
          ? Promise.resolve({ success: true })
          : Promise.reject(apiError(403, 'No access')),
    });
    const result = await saveQuestionsToBank({
      api,
      courseId: 'c1',
      pageQuestions: [
        { ...saved('q1'), stem: 'Edited 1' },
        { ...saved('q2'), stem: 'Edited 2' },
        question('q3'),
      ],
    });

    expect(result.error.message).toBe('No access');
    expect(saveCalls(api)).toHaveLength(0);
    expect([...result.saved.keys()]).toEqual(['q1']);
    expect(result.ids).toEqual(['db-q1', 'db-q2', null]);
  });

  it('gives a null id to a new question the server did not store', async () => {
    const api = makeApi({
      save: () => Promise.resolve({ savedCount: 1, questionIdsByIndex: ['new-0', null] }),
    });
    const result = await saveQuestionsToBank({
      api,
      courseId: 'c1',
      pageQuestions: [question('q1'), question('q2')],
    });

    expect(result.ids).toEqual(['new-0', null]);
    expect(result.savedCount).toBe(1);
    expect(result.saved.has('q2')).toBe(false);
  });
});

describe('saveQuestionsToBank with a deleted objective', () => {
  const orphanedApproval = () =>
    Object.assign(apiError(409, 'Cannot approve'), {
      body: { code: 'ORPHANED_APPROVAL_BLOCKED' },
    });

  it('marks new questions the server saved as orphaned as Draft on the page', async () => {
    const api = makeApi({
      save: () =>
        Promise.resolve({
          savedCount: 2,
          questionIdsByIndex: ['new-0', 'new-1'],
          orphanedIds: ['new-1'],
        }),
    });
    const result = await saveQuestionsToBank({
      api,
      courseId: 'c1',
      pageQuestions: [question('q1', { status: 'Approved' }), question('q2', { status: 'Approved' })],
    });

    expect(result.orphanedCount).toBe(1);
    expect(result.saved.get('q1').status).toBeUndefined();
    expect(result.saved.get('q2')).toMatchObject({ _id: 'new-1', status: 'Draft' });
    // Once Draft, the page copy matches its snapshot.
    const pageCopy = { ...question('q2', { status: 'Approved' }), ...result.saved.get('q2') };
    expect(hasUnsavedEdits(pageCopy)).toBe(false);
  });

  it('saves an edit without the approval when the objective was deleted', async () => {
    const put = jest
      .fn()
      .mockRejectedValueOnce(orphanedApproval())
      .mockResolvedValueOnce({ success: true });
    const api = makeApi({ put });
    const edited = { ...saved('q1'), stem: 'Edited', status: 'Approved' };

    const result = await saveQuestionsToBank({ api, courseId: 'c1', pageQuestions: [edited] });

    expect(result.error).toBeUndefined();
    expect(result.orphanedCount).toBe(1);
    expect(api.put).toHaveBeenCalledTimes(2);
    expect(api.put.mock.calls[0][1].status).toBe('Approved');
    expect(api.put.mock.calls[1][1]).not.toHaveProperty('status');
    expect(api.put.mock.calls[1][1].stem).toBe('Edited');
    expect(result.saved.get('q1')).toMatchObject({ _id: 'db-q1', status: 'Draft' });
  });

  it('still reports any other 409', async () => {
    const api = makeApi({ put: () => Promise.reject(apiError(409, 'Conflict')) });
    const result = await saveQuestionsToBank({
      api,
      courseId: 'c1',
      pageQuestions: [{ ...saved('q1'), status: 'Approved' }],
    });

    expect(result.error.message).toBe('Conflict');
    expect(api.put).toHaveBeenCalledTimes(1);
  });
});

describe('orphanedNote', () => {
  it('is empty when nothing was orphaned', () => {
    expect(orphanedNote(0)).toBe('');
    expect(orphanedNote(undefined)).toBe('');
  });

  it('says which questions were kept as Draft', () => {
    expect(orphanedNote(1)).toBe(
      ' 1 was saved as Draft because its learning objective was deleted.'
    );
    expect(orphanedNote(3)).toBe(
      ' 3 were saved as Draft because their learning objective was deleted.'
    );
  });
});

describe('quizSkipNote', () => {
  it('is empty when nothing was skipped', () => {
    expect(quizSkipNote({ alreadyInQuizCount: 0, ineligibleCount: 0 })).toBe('');
    expect(quizSkipNote(undefined)).toBe('');
  });

  it('explains questions with no valid objective and ones already in the quiz', () => {
    expect(quizSkipNote({ ineligibleCount: 1 })).toBe(
      ' 1 question was skipped because it has no valid learning objective.'
    );
    expect(quizSkipNote({ ineligibleCount: 2, alreadyInQuizCount: 1 })).toBe(
      ' 2 questions were skipped because they have no valid learning objective; 1 was already in the quiz.'
    );
  });
});

describe('countUnsavedQuestions', () => {
  it('counts new questions and saved ones edited since, not saved unchanged ones', () => {
    const groups = [
      {
        los: [
          { questions: [saved('q1'), { ...saved('q2'), stem: 'Edited' }] },
          { questions: [question('q3')] },
        ],
      },
    ];
    expect(countUnsavedQuestions(groups)).toBe(2);
  });
});
