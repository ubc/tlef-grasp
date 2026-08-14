// A course owner can turn the automatic fix off to trade repair time for speed
// and cost. Review always runs: with auto-fix off, questions are still reviewed
// and flagged, they are simply handed back for the instructor to deal with
// rather than rewritten and re-reviewed.

const mockGenerateStructured = jest.fn();
const mockGetSettings = jest.fn();

jest.mock('../../src/services/rag', () => ({
  getLearningObjectiveRagContent: jest.fn().mockResolvedValue('Relevant material'),
}));
jest.mock('../../src/services/llm', () => ({ isReady: jest.fn(() => true) }));
jest.mock('../../src/services/question', () => ({
  getQuestionTextsByGranularObjective: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../src/services/settings', () => ({ getSettings: mockGetSettings }));
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

const { generateQuestionsWithRagHandler } = require('../../src/controllers/rag-llm');

const makeMcq = (question) => ({
  scratchwork: 'Checked the answer.',
  question,
  options: {
    A: { text: 'Option A', feedback: '' },
    B: { text: 'Option B', feedback: 'Not B.' },
    C: { text: 'Option C', feedback: 'Not C.' },
    D: { text: 'Option D', feedback: 'Not D.' },
  },
  correctAnswer: 'A',
  explanation: 'Because the correct option is correct.',
});

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

describe('question generation automatic-fix toggle', () => {
  beforeEach(() => {
    mockGenerateStructured.mockReset();
    mockGetSettings.mockReset();
  });

  it('reviews but does not fix when the course turned auto-fix off', async () => {
    mockGetSettings.mockResolvedValue({ autoFixEnabled: false, reasoningEffort: {} });
    mockGenerateStructured
      .mockResolvedValueOnce({
        content: JSON.stringify(makeMcq('What powers active transport?')),
        usage: { promptTokens: 10, completionTokens: 5 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          ratings: [
            {
              questionId: '0',
              reasoning: 'Recomputed independently; does not match.',
              flagged: true,
              issue: 'The stated correct answer is wrong.',
            },
          ],
        }),
        usage: { promptTokens: 8, completionTokens: 4 },
      });

    const res = buildResponse();
    await generateQuestionsWithRagHandler(buildRequest(), res);

    // Generation and the initial review ran; no fix, and no re-review.
    const operations = mockGenerateStructured.mock.calls.map((call) => call[0].operation);
    expect(operations).toEqual(['question-generate', 'question-review']);

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.questions).toHaveLength(1);
    // The reviewer's verdict survives, so the instructor sees what was wrong.
    expect(payload.questions[0].reviewFlag).toBe(true);
    expect(payload.questions[0].reviewIssue).toBe('The stated correct answer is wrong.');
    // Review cost is real and reported; the fix line stays at zero.
    expect(payload.tokenUsage.review).toEqual({ promptTokens: 8, completionTokens: 4 });
    expect(payload.tokenUsage.fix).toEqual({ promptTokens: 0, completionTokens: 0 });
  });

  it('leaves a clean question unflagged when auto-fix is off', async () => {
    mockGetSettings.mockResolvedValue({ autoFixEnabled: false, reasoningEffort: {} });
    mockGenerateStructured
      .mockResolvedValueOnce({
        content: JSON.stringify(makeMcq('What powers active transport?')),
        usage: {},
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          ratings: [
            { questionId: '0', reasoning: 'Independently verified.', flagged: false, issue: '' },
          ],
        }),
        usage: {},
      });

    const res = buildResponse();
    await generateQuestionsWithRagHandler(buildRequest(), res);

    expect(res.json.mock.calls[0][0].questions[0].reviewFlag).toBeFalsy();
  });

  it('still fixes a flagged question when the course has not touched the setting', async () => {
    mockGetSettings.mockResolvedValue(null);
    mockGenerateStructured
      .mockResolvedValueOnce({
        content: JSON.stringify(makeMcq('What powers active transport?')),
        usage: {},
      })
      // Initial review flags it...
      .mockResolvedValueOnce({
        content: JSON.stringify({
          ratings: [
            {
              questionId: '0',
              reasoning: 'Recomputed independently; does not match.',
              flagged: true,
              issue: 'The stated correct answer is wrong.',
            },
          ],
        }),
        usage: {},
      })
      // ...the fix rewrites it...
      .mockResolvedValueOnce({
        content: JSON.stringify(makeMcq('Which molecule powers active transport?')),
        usage: {},
      })
      // ...and the re-review clears it.
      .mockResolvedValueOnce({
        content: JSON.stringify({
          ratings: [
            { questionId: '0', reasoning: 'Now consistent.', flagged: false, issue: '' },
          ],
        }),
        usage: {},
      });

    const res = buildResponse();
    await generateQuestionsWithRagHandler(buildRequest(), res);

    const operations = mockGenerateStructured.mock.calls.map((call) => call[0].operation);
    expect(operations).toContain('question-review');
    // The default path repairs rather than handing the flag back.
    expect(operations).toContain('question-fix');
    expect(res.json.mock.calls[0][0].questions[0].reviewFlag).toBe(false);
  });

  it("passes the course's chosen effort to generation and review", async () => {
    mockGetSettings.mockResolvedValue({
      autoFixEnabled: true,
      reasoningEffort: { 'question-generation': 'low', 'question-review-fix': 'high' },
    });
    mockGenerateStructured
      .mockResolvedValueOnce({
        content: JSON.stringify(makeMcq('What powers active transport?')),
        usage: {},
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          ratings: [
            { questionId: '0', reasoning: 'Independently verified.', flagged: false, issue: '' },
          ],
        }),
        usage: {},
      });

    await generateQuestionsWithRagHandler(buildRequest(), buildResponse());

    const byOperation = Object.fromEntries(
      mockGenerateStructured.mock.calls.map((call) => [call[0].operation, call[0].effort])
    );
    expect(byOperation['question-generate']).toBe('low');
    expect(byOperation['question-review']).toBe('high');
  });
});
