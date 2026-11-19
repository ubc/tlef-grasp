/**
 * Questions must come from the course material. When an objective has no
 * material to retrieve from — none attached, every attached one deleted, or
 * only the empty "From Canvas" placeholder a Canvas quiz import links to —
 * retrieval returns nothing, and generating anyway produced questions from the
 * model's general knowledge that the course never taught. The request is
 * refused instead, with a reason the instructor can act on.
 */
const mockGenerateStructured = jest.fn();

jest.mock('../../src/services/rag', () => ({
  getLearningObjectiveRagContent: jest.fn(),
  getRagContentFromMaterials: jest.fn(),
}));
jest.mock('../../src/services/llm', () => ({ isReady: jest.fn(() => true) }));
jest.mock('../../src/services/question', () => ({
  getQuestionTextsByGranularObjective: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../src/services/settings', () => ({
  getSettings: jest.fn().mockResolvedValue(null),
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
jest.mock('../../src/utils/llm-provider', () => ({
  getLLMModel: jest.fn(() => 'test-model'),
  getReviewModel: jest.fn(() => 'test-review-model'),
  getLLMProvider: jest.fn(() => 'openai'),
}));
jest.mock('../../src/utils/structured-llm', () => ({
  generateStructured: mockGenerateStructured,
}));

const ragService = require('../../src/services/rag');
const { generateQuestionsWithRagHandler } = require('../../src/controllers/rag-llm');

const buildRequest = (overrides = {}) => ({
  user: { id: 'u1' },
  body: {
    courseId: 'course-1',
    courseName: 'Biology',
    learningObjectiveId: 'objective-1',
    learningObjectiveText: 'Explain cellular energy',
    granularLearningObjectiveId: 'granular-1',
    granularLearningObjectiveText: 'Explain ATP production',
    bloomLevels: ['Understand'],
    count: 1,
    ...overrides,
  },
});

const buildResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  mockGenerateStructured.mockReset();
  // Stop after the first model call: these tests only ask whether generation started.
  mockGenerateStructured.mockRejectedValue(new Error('stop after the first model call'));
});

describe('question generation without course material', () => {
  it.each([
    ['nothing at all', ''],
    ['only whitespace', '  \n\t '],
  ])('refuses when the objective retrieves %s', async (_label, context) => {
    ragService.getLearningObjectiveRagContent.mockResolvedValue(context);
    const res = buildResponse();

    await generateQuestionsWithRagHandler(buildRequest(), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: 'NO_COURSE_MATERIAL',
      error: expect.stringMatching(/course material/i),
    }));
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  // Retrieval (services/rag.js) skips deleted materials and the "From Canvas"
  // placeholder, so each of these reaches the handler as an empty context.
  it('refuses on the material-ID fallback path too', async () => {
    ragService.getRagContentFromMaterials.mockResolvedValue('');
    const res = buildResponse();

    await generateQuestionsWithRagHandler(
      buildRequest({ learningObjectiveId: undefined, materialIds: ['source-1'] }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it('still generates when material was retrieved', async () => {
    ragService.getLearningObjectiveRagContent.mockResolvedValue('ATP is made by ATP synthase.');
    const res = buildResponse();

    await generateQuestionsWithRagHandler(buildRequest(), res);

    expect(mockGenerateStructured).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(409);
  });
});
