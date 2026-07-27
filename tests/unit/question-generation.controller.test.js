const mockGenerateStructured = jest.fn();
const mockGetExistingQuestionTexts = jest.fn();

jest.mock('../../src/services/rag', () => ({
  getLearningObjectiveRagContent: jest.fn().mockResolvedValue('Relevant material'),
}));
jest.mock('../../src/services/llm', () => ({ isReady: jest.fn(() => true) }));
jest.mock('../../src/services/question', () => ({
  getQuestionTextsByGranularObjective: mockGetExistingQuestionTexts,
}));
jest.mock('../../src/services/settings', () => ({
  getSettings: jest.fn().mockResolvedValue(null),
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

const makeMcq = (question, correctAnswer = 'A') => ({
  scratchwork: 'Checked the answer.',
  question,
  options: {
    A: { text: 'Option A', feedback: correctAnswer === 'A' ? '' : 'Not A.' },
    B: { text: 'Option B', feedback: correctAnswer === 'B' ? '' : 'Not B.' },
    C: { text: 'Option C', feedback: correctAnswer === 'C' ? '' : 'Not C.' },
    D: { text: 'Option D', feedback: correctAnswer === 'D' ? '' : 'Not D.' },
  },
  correctAnswer,
  explanation: 'Because the correct option is correct.',
});

const makeReviewResponse = (ratings) => ({
  content: JSON.stringify({ ratings }),
  usage: {},
});

const cleanRating = (id = '0') => ({
  questionId: id,
  reasoning: 'Recomputed independently; matches the stated answer.',
  flagged: false,
  issue: '',
});

const flaggedRating = (id = '0', issue = 'The stated correct answer is wrong.') => ({
  questionId: id,
  reasoning: 'Recomputed independently; does not match the stated answer.',
  flagged: true,
  issue,
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

describe('generateQuestionsWithRagHandler duplicate protection', () => {
  beforeEach(() => {
    mockGenerateStructured.mockReset();
    mockGetExistingQuestionTexts.mockReset();
    mockGetExistingQuestionTexts.mockResolvedValue(['What is ATP?']);
  });

  it('includes existing granular-objective questions and retries an exact duplicate', async () => {
    mockGenerateStructured
      .mockResolvedValueOnce({ content: JSON.stringify(makeMcq('  WHAT  IS ATP? ')), usage: {} })
      .mockResolvedValueOnce({ content: JSON.stringify(makeMcq('How does ATP power transport?')), usage: {} })
      .mockResolvedValueOnce(makeReviewResponse([cleanRating('0')]));
    const res = buildResponse();

    await generateQuestionsWithRagHandler(buildRequest(), res);

    expect(mockGetExistingQuestionTexts).toHaveBeenCalledWith('course-1', 'granular-1');
    // 2 generation attempts (duplicate retry + success) + 1 initial review call,
    // which comes back clean so no fix cycle runs.
    expect(mockGenerateStructured).toHaveBeenCalledTimes(3);
    expect(mockGenerateStructured.mock.calls[0][0].messages[0].content).toContain(
      '1. What is ATP?'
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        questions: [
          expect.objectContaining({
            question: 'How does ATP power transport?',
            reviewFlag: false,
          }),
        ],
      })
    );
  });

  it('never returns a duplicate when every retry repeats it', async () => {
    mockGenerateStructured.mockResolvedValue({
      content: JSON.stringify(makeMcq('What is ATP?')),
      usage: {},
    });
    const res = buildResponse();

    await generateQuestionsWithRagHandler(buildRequest(), res);

    expect(mockGenerateStructured).toHaveBeenCalledTimes(3);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });
});

describe('generateQuestionsWithRagHandler review-fix loop', () => {
  beforeEach(() => {
    mockGenerateStructured.mockReset();
    mockGetExistingQuestionTexts.mockReset();
    mockGetExistingQuestionTexts.mockResolvedValue([]);
  });

  it('fixes a flagged question with a targeted patch and clears the flag once re-review passes', async () => {
    mockGenerateStructured
      // generation succeeds on the first attempt
      .mockResolvedValueOnce({
        content: JSON.stringify(makeMcq('What is ATP?', 'A')),
        usage: { promptTokens: 1000, completionTokens: 200 },
      })
      // initial review flags it
      .mockResolvedValueOnce({
        ...makeReviewResponse([flaggedRating('0', 'Option A is not actually correct.')]),
        usage: { promptTokens: 300, completionTokens: 50 },
      })
      // fix attempt produces a corrected answer
      .mockResolvedValueOnce({
        content: JSON.stringify(makeMcq('What is ATP?', 'B')),
        usage: { promptTokens: 900, completionTokens: 150 },
      })
      // re-review of just the fixed question comes back clean
      .mockResolvedValueOnce({
        ...makeReviewResponse([cleanRating('0')]),
        usage: { promptTokens: 250, completionTokens: 40 },
      });
    const res = buildResponse();
    // Fisher-Yates over 4 options makes exactly 3 Math.random() calls per
    // scramble. If a question were scrambled again after review/fix (the bug
    // this guards against — where a reviewer's issue text, or an
    // already-fixed question, would name/hold a letter that no longer
    // matches what ships), this count would be higher than "one scramble per
    // question produced" (original generation + the one successful fix = 2).
    const randomSpy = jest.spyOn(Math, 'random');

    await generateQuestionsWithRagHandler(buildRequest(), res);

    expect(randomSpy).toHaveBeenCalledTimes(6);
    randomSpy.mockRestore();

    // The "scramble the generated options" step runs immediately when the
    // question (and separately, the fix) is produced — never again after —
    // so conversationHistory, the reviewer's issue text, and what ships all
    // agree on the same lettering throughout. That still means correctAnswer's
    // *letter* isn't deterministic in this test (each scramble is random);
    // assert on content instead — the option holding the fix's chosen answer
    // ("Option B") must be the one marked correct, whichever letter that is.
    expect(mockGenerateStructured).toHaveBeenCalledTimes(4);
    expect(res.json).toHaveBeenCalledTimes(1);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.questions).toHaveLength(1);
    const fixedQuestion = payload.questions[0];
    expect(['A', 'B', 'C', 'D']).toContain(fixedQuestion.correctAnswer);
    expect(fixedQuestion.options[fixedQuestion.correctAnswer].text).toBe('Option B');
    expect(fixedQuestion.wasAutoFixed).toBe(true);
    expect(fixedQuestion.reviewFlag).toBe(false);
    expect(fixedQuestion.reviewIssue).toBe('');
    expect(fixedQuestion.autoFixReason).toContain('Option A is not actually correct.');

    // tokenUsage is broken out by stage so the review-fix loop's cost is
    // visible separately from generation's — this is the whole point of the
    // breakdown (letting callers compute the loop's cost delta, not just a
    // single opaque total).
    expect(payload.tokenUsage.generation).toEqual({ promptTokens: 1000, completionTokens: 200 });
    expect(payload.tokenUsage.review).toEqual({ promptTokens: 550, completionTokens: 90 });
    expect(payload.tokenUsage.fix).toEqual({ promptTokens: 900, completionTokens: 150 });
    expect(payload.tokenUsage.total).toEqual({ promptTokens: 2450, completionTokens: 440 });
  });

  it('scrambles a never-flagged question exactly once', async () => {
    mockGenerateStructured
      .mockResolvedValueOnce({ content: JSON.stringify(makeMcq('What is ATP?')), usage: {} })
      .mockResolvedValueOnce(makeReviewResponse([cleanRating('0')]));
    const res = buildResponse();
    const randomSpy = jest.spyOn(Math, 'random');

    await generateQuestionsWithRagHandler(buildRequest(), res);

    // Exactly one scramble (3 Math.random() calls for a 4-option Fisher-Yates)
    // at generation time; nothing should scramble it again after review.
    expect(randomSpy).toHaveBeenCalledTimes(3);
    randomSpy.mockRestore();
  });

  it('ships a question still flagged after 2 fix cycles if every fix attempt fails validation', async () => {
    mockGenerateStructured
      .mockResolvedValueOnce({ content: JSON.stringify(makeMcq('What is ATP?')), usage: {} })
      .mockResolvedValueOnce(makeReviewResponse([flaggedRating('0')]))
      // cycle 1: both fix attempts return unparseable content
      .mockResolvedValueOnce({ content: 'not valid json', usage: {} })
      .mockResolvedValueOnce({ content: 'still not valid json', usage: {} })
      // cycle 2
      .mockResolvedValueOnce({ content: 'not valid json', usage: {} })
      .mockResolvedValueOnce({ content: 'still not valid json', usage: {} });
    const res = buildResponse();

    await generateQuestionsWithRagHandler(buildRequest(), res);

    // 1 generation + 1 initial review + 2 cycles x 2 fix attempts each = 6.
    // No re-review calls: a fix attempt that never produces valid output never
    // reaches the "patched" set, so nothing is re-reviewed — this is the
    // existing ship-with-flag behavior, just reached after more attempts, not
    // a new failure mode.
    expect(mockGenerateStructured).toHaveBeenCalledTimes(6);
    expect(res.json).toHaveBeenCalledTimes(1);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.questions).toHaveLength(1);
    expect(payload.questions[0].reviewFlag).toBe(true);
    expect(payload.questions[0].wasAutoFixed).toBeFalsy();
  });
});
