// Questions must test concepts the course material teaches, not just concepts
// related to it. Review is the independent check on that, so it is handed the
// same material generation retrieved — the initial review and the re-review of
// a fixed question alike. The standalone review route has no material, and its
// prompt is unchanged.

const mockGenerateStructured = jest.fn();

jest.mock('../../src/services/rag', () => ({
  getLearningObjectiveRagContent: jest.fn().mockResolvedValue('Eyes are flushed for 15 minutes at the eyewash.'),
}));
jest.mock('../../src/services/llm', () => ({ isReady: jest.fn(() => true) }));
jest.mock('../../src/services/question', () => ({
  getQuestionTextsByGranularObjective: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../src/services/settings', () => ({ getSettings: jest.fn().mockResolvedValue(null) }));
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

const { generateQuestionsWithRagHandler, reviewQuestionsHandler } = require('../../src/controllers/rag-llm');

const MATERIAL = 'Eyes are flushed for 15 minutes at the eyewash.';

const makeMcq = (question) => ({
  scratchwork: 'Checked the answer.',
  question,
  options: {
    A: { text: '15 minutes', feedback: '' },
    B: { text: '1 minute', feedback: 'Too short.' },
    C: { text: '5 minutes', feedback: 'Too short.' },
    D: { text: '60 minutes', feedback: 'Longer than required.' },
  },
  correctAnswer: 'A',
  explanation: 'The material says 15 minutes.',
});

const rating = (flagged, issue = '') => ({
  content: JSON.stringify({ ratings: [{ questionId: '0', reasoning: 'Checked.', flagged, issue }] }),
  usage: {},
});

const buildRequest = () => ({
  body: {
    courseId: 'course-1',
    courseName: 'Lab Safety',
    learningObjectiveId: 'objective-1',
    learningObjectiveText: 'Respond to chemical exposure',
    granularLearningObjectiveId: 'granular-1',
    granularLearningObjectiveText: 'Describe eyewash use',
    bloomLevels: ['Understand'],
    count: 1,
  },
});

const buildResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

const reviewPrompts = () =>
  mockGenerateStructured.mock.calls
    .filter((call) => call[0].operation === 'question-review')
    .map((call) => call[0].prompt);

describe('question review checks material coverage', () => {
  beforeEach(() => mockGenerateStructured.mockReset());

  it('gives the initial review and the re-review the retrieved material', async () => {
    mockGenerateStructured
      .mockResolvedValueOnce({ content: JSON.stringify(makeMcq('Who must be told after an eyewash?')), usage: {} })
      .mockResolvedValueOnce(rating(true, 'Who must be told is not taught in the material.'))
      .mockResolvedValueOnce({ content: JSON.stringify(makeMcq('How long are eyes flushed at the eyewash?')), usage: {} })
      .mockResolvedValueOnce(rating(false));

    const res = buildResponse();
    await generateQuestionsWithRagHandler(buildRequest(), res);

    const prompts = reviewPrompts();
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) {
      expect(prompt).toContain('MATERIAL COVERAGE');
      expect(prompt).toContain(MATERIAL);
    }
    expect(res.json.mock.calls[0][0].questions[0].reviewFlag).toBe(false);
  });

  it('tells generation the material is what questions must be grounded in', async () => {
    mockGenerateStructured
      .mockResolvedValueOnce({ content: JSON.stringify(makeMcq('How long are eyes flushed?')), usage: {} })
      .mockResolvedValueOnce(rating(false));

    await generateQuestionsWithRagHandler(buildRequest(), buildResponse());

    const generation = mockGenerateStructured.mock.calls.find((call) => call[0].operation === 'question-generate')[0];
    const generationText = JSON.stringify(generation);
    expect(generationText).toContain('GROUNDING:');
    expect(generationText).not.toContain('BACKGROUND COURSE MATERIAL');
  });

  it('leaves the standalone review prompt without a coverage check', async () => {
    mockGenerateStructured.mockResolvedValueOnce(rating(false));

    await reviewQuestionsHandler(
      { body: { questions: [{ id: '0', questionType: 'multiple-choice', title: 'How long are eyes flushed?' }] } },
      buildResponse()
    );

    const [prompt] = reviewPrompts();
    expect(prompt).not.toContain('MATERIAL COVERAGE');
  });
});
