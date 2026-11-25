// Approving a question is faculty-only: the status route refuses anyone else.
// The save and edit routes took a client-supplied status as-is, so a TA (or
// SAML staff) could approve through "Approve on save" — or any request naming
// status: "Approved" — and the question went straight to students.
jest.mock('../../src/services/question', () => ({
  saveQuestion: jest.fn(),
  updateQuestion: jest.fn(),
  deleteQuestion: jest.fn(),
  getQuestions: jest.fn(),
  getQuestionCourseId: jest.fn(),
  getQuestion: jest.fn(),
}));
jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/utils/co-instructor-permissions', () => ({
  assertCoInstructorPermission: jest.fn().mockResolvedValue(true),
  PERMISSION_KEYS: { QUESTION_GENERATION: 'questionGeneration', QUESTION_BANK: 'questionBank' },
}));
jest.mock('../../src/utils/ta-permissions', () => ({
  assertTaPermission: jest.fn().mockResolvedValue(true),
  TA_PERMISSION_KEYS: { QUESTION_GENERATION: 'questionGeneration', QUESTION_BANK: 'questionBank' },
}));
jest.mock('../../src/utils/auth', () => ({
  ...jest.requireActual('../../src/utils/auth'),
  isFaculty: jest.fn(),
}));

const questionService = require('../../src/services/question');
const { isFaculty } = require('../../src/utils/auth');
const { saveQuestionHandler, updateQuestionHandler } = require('../../src/controllers/question');

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const inserted = (id) => ({ insertedId: { toString: () => id } });
const ta = { _id: 'ta-1' };
const instructor = { _id: 'fac-1' };

beforeEach(() => {
  jest.clearAllMocks();
  questionService.saveQuestion.mockResolvedValue(inserted('q-1'));
  questionService.getQuestionCourseId.mockResolvedValue('course-1');
  questionService.getQuestion.mockResolvedValue({ _id: 'q-1', status: 'Draft' });
  questionService.updateQuestion.mockResolvedValue({ modifiedCount: 1 });
});

describe('POST /api/question/save', () => {
  const save = (user, questions) =>
    saveQuestionHandler({ user, body: { courseId: 'course-1', questions } }, makeRes());

  it('saves a non-faculty question as Draft even when it asks for Approved', async () => {
    isFaculty.mockResolvedValue(false);

    await save(ta, [{ title: 'a', status: 'Approved' }, { title: 'b', status: 'approved' }]);

    const statuses = questionService.saveQuestion.mock.calls.map(([, data]) => data.status);
    expect(statuses).toEqual(['Draft', 'Draft']);
  });

  it('keeps the status a faculty member chose', async () => {
    isFaculty.mockResolvedValue(true);

    await save(instructor, [{ title: 'a', status: 'Approved' }]);

    expect(questionService.saveQuestion.mock.calls[0][1].status).toBe('Approved');
  });
});

describe('PUT /api/question/:questionId', () => {
  const update = (user, body) => {
    const res = makeRes();
    return updateQuestionHandler({ user, params: { questionId: 'q-1' }, body }, res).then(() => res);
  };

  it('refuses a non-faculty edit that approves the question', async () => {
    isFaculty.mockResolvedValue(false);

    const res = await update(ta, { title: 'edited', status: 'Approved' });

    expect(res.status).toHaveBeenCalledWith(403);
    expect(questionService.updateQuestion).not.toHaveBeenCalled();
  });

  it('lets a non-faculty edit that leaves the question a Draft through', async () => {
    isFaculty.mockResolvedValue(false);

    await update(ta, { title: 'edited', status: 'Draft' });
    await update(ta, { title: 'edited again' });

    expect(questionService.updateQuestion).toHaveBeenCalledTimes(2);
  });

  it('lets faculty approve through an edit', async () => {
    isFaculty.mockResolvedValue(true);

    await update(instructor, { title: 'edited', status: 'Approved' });

    expect(questionService.updateQuestion).toHaveBeenCalledWith('q-1', { title: 'edited', status: 'Approved' });
  });
});
