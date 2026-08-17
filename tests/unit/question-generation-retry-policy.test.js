// The limiter owns rate-limit retries. The slot loop owns content retries.
// Doing both means up to 9 attempts at a provider already saying no.
const mockGenerateStructured = jest.fn();

jest.mock('../../src/services/rag', () => ({
  getLearningObjectiveRagContent: jest.fn().mockResolvedValue('Relevant material'),
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
jest.mock('../../src/utils/structured-llm', () => ({ generateStructured: mockGenerateStructured }));
// Without this, the real generationLimiter retries a 429 itself (maxRetries:
// 3, real backoff delays) before the slot-level fix ever gets to matter,
// which both makes the assertions below false (4 calls, not 1) and the test
// slow/flaky. Same pass-through convention as generation-limiter-wiring.test.js.
jest.mock('../../src/utils/generation-limiter', () => ({
  generationLimiter: { run: jest.fn((fn) => fn()) },
}));

const { generateQuestionsWithRagHandler } = require('../../src/controllers/rag-llm');

const buildRequest = () => ({
  body: {
    courseId: 'course-1',
    courseName: 'Biology',
    learningObjectiveId: 'objective-1',
    learningObjectiveText: 'Explain cellular energy',
    granularLearningObjectiveId: 'granular-1',
    granularLearningObjectiveText: 'Explain ATP production',
    bloomLevels: ['Understand'],
    count: 1,
  },
});

const buildResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

const rateLimitError = () => {
  const error = new Error('429 Rate limit reached for gpt-5.6-luna');
  error.status = 429;
  return error;
};

describe('question slot retry policy', () => {
  beforeEach(() => mockGenerateStructured.mockReset());

  it('does not retry the slot after a rate-limit failure', async () => {
    mockGenerateStructured.mockRejectedValue(rateLimitError());

    await generateQuestionsWithRagHandler(buildRequest(), buildResponse());

    // Exactly one generation attempt, not three.
    expect(mockGenerateStructured).toHaveBeenCalledTimes(1);
  });

  it('still retries a content failure', async () => {
    mockGenerateStructured
      .mockResolvedValueOnce({ content: 'not json at all', usage: {} })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          scratchwork: 'Checked.',
          question: 'What powers active transport?',
          options: {
            A: { text: 'Option A', feedback: '' },
            B: { text: 'Option B', feedback: 'Not B.' },
            C: { text: 'Option C', feedback: 'Not C.' },
            D: { text: 'Option D', feedback: 'Not D.' },
          },
          correctAnswer: 'A',
          explanation: 'Because.',
        }),
        usage: {},
      })
      .mockResolvedValue({
        content: JSON.stringify({ ratings: [{ questionId: '0', reasoning: 'ok', flagged: false, issue: '' }] }),
        usage: {},
      });

    await generateQuestionsWithRagHandler(buildRequest(), buildResponse());

    const generateCalls = mockGenerateStructured.mock.calls.filter(
      (call) => call[0].operation === 'question-generate'
    );
    expect(generateCalls).toHaveLength(2);
  });
});
