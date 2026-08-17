// Finding 1 (final branch review): a partially generated batch must not be
// discarded when a later question in the same batch hits a rate limit.
//
// Before this fix, `isRetryableLLMError(error)` inside `generateOneQuestion`'s
// catch re-threw, and nothing in `generateQuestionsWithRagHandler` caught it
// at the `for (const spec of slotSpecs)` loop — so the throw unwound the
// whole handler. With count: 2, question 1 (already generated, already paid
// for) was discarded and the response came back 429 with zero questions,
// instead of 200 with the one question that succeeded.
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
// Same convention as question-generation-retry-policy.test.js: without this,
// the real generationLimiter retries a 429 itself before the slot-loop logic
// under test ever gets to matter.
jest.mock('../../src/utils/generation-limiter', () => ({
  generationLimiter: { run: jest.fn((fn) => fn()) },
}));

const { generateQuestionsWithRagHandler } = require('../../src/controllers/rag-llm');

const makeMcq = (question, correctAnswer = 'A') => ({
  scratchwork: 'Checked.',
  question,
  options: {
    A: { text: 'Option A', feedback: correctAnswer === 'A' ? '' : 'Not A.' },
    B: { text: 'Option B', feedback: correctAnswer === 'B' ? '' : 'Not B.' },
    C: { text: 'Option C', feedback: correctAnswer === 'C' ? '' : 'Not C.' },
    D: { text: 'Option D', feedback: correctAnswer === 'D' ? '' : 'Not D.' },
  },
  correctAnswer,
  explanation: 'Because.',
});

const cleanRating = (id) => ({
  questionId: id,
  reasoning: 'Recomputed independently; matches the stated answer.',
  flagged: false,
  issue: '',
});

const rateLimitError = () => {
  const error = new Error('429 Rate limit reached for gpt-5.6-luna');
  error.status = 429;
  return error;
};

const buildRequest = (count) => ({
  body: {
    courseId: 'course-1',
    courseName: 'Biology',
    learningObjectiveId: 'objective-1',
    learningObjectiveText: 'Explain cellular energy',
    granularLearningObjectiveId: 'granular-1',
    granularLearningObjectiveText: 'Explain ATP production',
    bloomLevels: ['Understand'],
    count,
  },
});

const buildResponse = () => ({
  status: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

describe('generateQuestionsWithRagHandler partial-batch rate limiting', () => {
  beforeEach(() => mockGenerateStructured.mockReset());

  it('ships the questions already generated, with requested/produced counts, when a later slot is rate limited', async () => {
    mockGenerateStructured
      // Q1 succeeds.
      .mockResolvedValueOnce({
        content: JSON.stringify(makeMcq('What is ATP?')),
        usage: { promptTokens: 10, completionTokens: 5 },
      })
      // Q2 hits a rate limit that survives the limiter.
      .mockRejectedValueOnce(rateLimitError())
      // Review of the one question that made it.
      .mockResolvedValueOnce({
        content: JSON.stringify({ ratings: [cleanRating('0')] }),
        usage: {},
      });

    const res = buildResponse();
    await generateQuestionsWithRagHandler(buildRequest(2), res);

    expect(res.status).not.toHaveBeenCalledWith(429);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledTimes(1);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.questions).toHaveLength(1);
    expect(payload.questions[0].question).toBe('What is ATP?');
    expect(payload.requested).toBe(2);
    expect(payload.produced).toBe(1);
    // The first question's tokens are still counted — not dropped along with
    // the batch.
    expect(payload.tokenUsage.generation).toEqual({ promptTokens: 10, completionTokens: 5 });

    // Exactly 2 generation attempts: Q1's single (successful) try, then Q2's
    // single rate-limited try — no in-place retry of the rate-limited slot.
    const generateCalls = mockGenerateStructured.mock.calls.filter(
      (call) => call[0].operation === 'question-generate'
    );
    expect(generateCalls).toHaveLength(2);
  });
});
