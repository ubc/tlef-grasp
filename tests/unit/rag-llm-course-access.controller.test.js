/**
 * H6: the three RAG endpoints that name a course had no course check.
 *
 * The staff role on the mount was the only gate, so any staff user — including
 * every promoted TA — could read another course's raw material chunks via
 * /search, generate questions from its content, or write text into its vector
 * store via /add-document. Injected text has no grasp_material row, so it never
 * appears on the materials page and cannot be deleted through the UI, while
 * still feeding that course's question generation.
 *
 * generate-questions-with-rag is the subtle one: it *did* call the co-instructor
 * and TA guards, which reads like a check. Both fail open for a non-member — an
 * absent permission map means "allowed", and someone with no TA membership is
 * not a TA — so neither substituted for membership.
 */

jest.mock('../../src/services/rag', () => ({
  addDocumentToRAG: jest.fn().mockResolvedValue(['chunk-1']),
  getOrCreateInstance: jest.fn(),
  getLearningObjectiveRagContent: jest.fn(),
  getRagContentFromMaterials: jest.fn(),
  deleteDocumentFromRAG: jest.fn(),
}));
jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn(),
}));
jest.mock('../../src/utils/co-instructor-permissions', () => ({
  assertCoInstructorPermission: jest.fn().mockResolvedValue(true),
  PERMISSION_KEYS: { COURSE_MATERIALS: 'courseMaterials', QUESTION_GENERATION: 'questionGeneration' },
}));
jest.mock('../../src/utils/ta-permissions', () => ({
  assertTaPermission: jest.fn().mockResolvedValue(true),
  TA_PERMISSION_KEYS: { COURSE_MATERIALS: 'courseMaterials', QUESTION_GENERATION: 'questionGeneration' },
}));
jest.mock('../../src/services/llm', () => ({ isReady: jest.fn().mockReturnValue(true) }));
jest.mock('../../src/services/settings', () => ({ getSettings: jest.fn().mockResolvedValue({}) }));
jest.mock('../../src/services/question', () => ({
  getQuestionTextsByGranularObjective: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../src/services/material', () => ({
  getMaterialCourseId: jest.fn(),
  getMaterialBySourceId: jest.fn(),
}));
jest.mock('../../src/services/material-outline', () => ({ getOutline: jest.fn() }));
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/utils/structured-llm', () => ({ generateStructured: jest.fn() }));

const ragService = require('../../src/services/rag');
const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const {
  addDocumentToRagHandler,
  searchRagHandler,
  generateQuestionsWithRagHandler,
} = require('../../src/controllers/rag-llm');

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const user = { _id: 'staff-elsewhere' };

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => jest.restoreAllMocks());

describe('POST /api/rag-llm/add-document', () => {
  it('refuses a course the caller has no staff access in', async () => {
    hasStaffAccessInCourse.mockResolvedValue(false);
    const res = makeRes();

    await addDocumentToRagHandler(
      { body: { content: 'poison', metadata: { courseId: 'victim-course' } }, user },
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(ragService.addDocumentToRAG).not.toHaveBeenCalled();
  });

  // The client nests the course inside metadata, so that shape has to be checked
  // too — reading only body.courseId would leave the real path unguarded.
  it('reads the course from metadata as well as the top level', async () => {
    hasStaffAccessInCourse.mockResolvedValue(true);

    await addDocumentToRagHandler(
      { body: { content: 'ok', metadata: { courseId: 'my-course' } }, user },
      makeRes()
    );

    expect(hasStaffAccessInCourse).toHaveBeenCalledWith(user, 'my-course');
    expect(ragService.addDocumentToRAG).toHaveBeenCalled();
  });

  it('400s when no course is named at all', async () => {
    hasStaffAccessInCourse.mockResolvedValue(true);
    const res = makeRes();

    await addDocumentToRagHandler({ body: { content: 'x' }, user }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(ragService.addDocumentToRAG).not.toHaveBeenCalled();
  });

  it('allows a course the caller does have staff access in', async () => {
    hasStaffAccessInCourse.mockResolvedValue(true);
    const res = makeRes();

    await addDocumentToRagHandler({ body: { content: 'ok', courseId: 'my-course' }, user }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('POST /api/rag-llm/search', () => {
  it('refuses a course the caller has no staff access in', async () => {
    hasStaffAccessInCourse.mockResolvedValue(false);
    const res = makeRes();

    await searchRagHandler({ body: { query: 'midterm answers', courseId: 'victim-course' }, user }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(ragService.getOrCreateInstance).not.toHaveBeenCalled();
  });

  it('400s when no course is named', async () => {
    hasStaffAccessInCourse.mockResolvedValue(true);
    const res = makeRes();

    await searchRagHandler({ body: { query: 'x' }, user }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(ragService.getOrCreateInstance).not.toHaveBeenCalled();
  });
});

describe('POST /api/rag-llm/generate-questions-with-rag', () => {
  const body = {
    courseId: 'victim-course',
    courseName: 'CHEM 121',
    learningObjectiveText: 'Explain respiration',
    granularLearningObjectiveText: 'Describe glycolysis',
    bloomLevels: ['Understand'],
    learningObjectiveId: 'lo-1',
  };

  it('refuses a course the caller has no staff access in', async () => {
    hasStaffAccessInCourse.mockResolvedValue(false);
    const res = makeRes();

    await generateQuestionsWithRagHandler({ body, user }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(ragService.getLearningObjectiveRagContent).not.toHaveBeenCalled();
  });

  // Regression note: the capability guards ran before this fix and let a
  // non-member straight through, which is why membership is checked first.
  it('checks membership even though the capability guards would pass', async () => {
    hasStaffAccessInCourse.mockResolvedValue(false);
    const { assertCoInstructorPermission } = require('../../src/utils/co-instructor-permissions');
    assertCoInstructorPermission.mockResolvedValue(true);
    const res = makeRes();

    await generateQuestionsWithRagHandler({ body, user }, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});
