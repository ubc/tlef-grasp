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
  PERMISSION_KEYS: { QUESTION_GENERATION: 'questionGeneration' },
}));
jest.mock('../../src/utils/ta-permissions', () => ({
  assertTaPermission: jest.fn().mockResolvedValue(true),
  TA_PERMISSION_KEYS: { QUESTION_GENERATION: 'questionGeneration' },
}));

const questionService = require('../../src/services/question');
const { saveQuestionHandler } = require('../../src/controllers/question');

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const inserted = (id) => ({ insertedId: { toString: () => id } });

describe('POST /api/question/save', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  // A failure in the middle must not shift later ids onto the wrong question.
  it('returns ids in request order with null for questions that failed', async () => {
    questionService.saveQuestion
      .mockResolvedValueOnce(inserted('id-a'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(inserted('id-c'));

    const req = {
      user: { id: 'u1' },
      body: { courseId: 'course-1', questions: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] },
    };
    const res = makeRes();

    await saveQuestionHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        savedCount: 2,
        questionIds: ['id-a', 'id-c'],
        questionIdsByIndex: ['id-a', null, 'id-c'],
      })
    );
  });
});
