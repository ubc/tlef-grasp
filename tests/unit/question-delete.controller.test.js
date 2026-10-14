jest.mock('../../src/services/question', () => ({
  saveQuestion: jest.fn(),
  updateQuestion: jest.fn(),
  deleteQuestion: jest.fn(),
  getQuestions: jest.fn(),
  getQuestionCourseId: jest.fn(),
  getQuestion: jest.fn(),
  findExistingQuestionIds: jest.fn(),
}));
jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn(),
}));
jest.mock('../../src/utils/co-instructor-permissions', () => ({
  assertCoInstructorPermission: jest.fn().mockResolvedValue(true),
  PERMISSION_KEYS: { QUESTION_BANK: 'questionBank', QUESTION_GENERATION: 'questionGeneration' },
}));
jest.mock('../../src/utils/ta-permissions', () => ({
  assertTaPermission: jest.fn().mockResolvedValue(true),
  TA_PERMISSION_KEYS: { QUESTION_BANK: 'questionBank', QUESTION_GENERATION: 'questionGeneration' },
}));
jest.mock('../../src/utils/auth', () => ({
  isFaculty: jest.fn().mockResolvedValue(true),
}));

const questionService = require('../../src/services/question');
const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const { assertCoInstructorPermission } = require('../../src/utils/co-instructor-permissions');
const {
  deleteQuestionHandler,
  updateQuestionHandler,
  existingQuestionsHandler,
} = require('../../src/controllers/question');

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('DELETE /api/question/:questionId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // The wizard treats 404 as "already deleted". A question removed from the
  // Question Bank tab first has no course left to check access against, and
  // that used to surface as a 403 "User is not in course".
  it('returns 404 for a question that no longer exists, before the access check', async () => {
    questionService.getQuestionCourseId.mockResolvedValue(undefined);
    hasStaffAccessInCourse.mockResolvedValue(false);
    const res = makeRes();

    await deleteQuestionHandler({ params: { questionId: 'gone' }, user: { id: 'prof' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(hasStaffAccessInCourse).not.toHaveBeenCalled();
    expect(questionService.deleteQuestion).not.toHaveBeenCalled();
  });

  it('still returns 403 for an existing question in a course the user is not in', async () => {
    questionService.getQuestionCourseId.mockResolvedValue('course-1');
    hasStaffAccessInCourse.mockResolvedValue(false);
    const res = makeRes();

    await deleteQuestionHandler({ params: { questionId: 'q1' }, user: { id: 'prof' } }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(questionService.deleteQuestion).not.toHaveBeenCalled();
  });
});

describe('PUT /api/question/:questionId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Add to Question Bank updates saved questions and re-saves any whose bank
  // copy was deleted, which it recognises by this 404.
  it('returns 404 for a question that no longer exists, before the access check', async () => {
    questionService.getQuestionCourseId.mockResolvedValue(undefined);
    hasStaffAccessInCourse.mockResolvedValue(false);
    const res = makeRes();

    await updateQuestionHandler(
      { params: { questionId: 'gone' }, user: { id: 'prof' }, body: { stem: 'x' } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(hasStaffAccessInCourse).not.toHaveBeenCalled();
    expect(questionService.updateQuestion).not.toHaveBeenCalled();
  });

  it('returns 400 when the objective being attached is not in the course', async () => {
    questionService.getQuestionCourseId.mockResolvedValue('course-1');
    questionService.getQuestion.mockResolvedValue({ status: 'Draft' });
    hasStaffAccessInCourse.mockResolvedValue(true);
    questionService.updateQuestion.mockRejectedValue(
      Object.assign(new Error('bad objective'), { code: 'INVALID_OBJECTIVE' })
    );
    const res = makeRes();

    await updateQuestionHandler(
      { params: { questionId: 'q1' }, user: { id: 'prof' }, body: { granularObjectiveId: 'gone' } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('POST /api/question/existing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the ids that still exist, checked with the wizard permission', async () => {
    hasStaffAccessInCourse.mockResolvedValue(true);
    questionService.findExistingQuestionIds.mockResolvedValue(['q1']);
    const res = makeRes();

    await existingQuestionsHandler(
      { user: { id: 'co' }, body: { courseId: 'course-1', questionIds: ['q1', 'q2'] } },
      res
    );

    expect(questionService.findExistingQuestionIds).toHaveBeenCalledWith('course-1', ['q1', 'q2']);
    expect(res.json).toHaveBeenCalledWith({ success: true, existingIds: ['q1'] });
    expect(assertCoInstructorPermission).toHaveBeenCalledWith(
      expect.anything(),
      res,
      'course-1',
      'questionGeneration'
    );
  });

  it('returns 403 outside the course', async () => {
    hasStaffAccessInCourse.mockResolvedValue(false);
    const res = makeRes();

    await existingQuestionsHandler(
      { user: { id: 'x' }, body: { courseId: 'course-1', questionIds: ['q1'] } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(questionService.findExistingQuestionIds).not.toHaveBeenCalled();
  });

  it('returns 400 without a question id list', async () => {
    const res = makeRes();
    await existingQuestionsHandler({ user: { id: 'x' }, body: { courseId: 'course-1' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
