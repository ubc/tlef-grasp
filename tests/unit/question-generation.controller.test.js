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
  explanation: 'Because A is correct.',
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
      .mockResolvedValueOnce({ content: JSON.stringify(makeMcq('How does ATP power transport?')), usage: {} });
    const res = buildResponse();

    await generateQuestionsWithRagHandler(buildRequest(), res);

    expect(mockGetExistingQuestionTexts).toHaveBeenCalledWith('course-1', 'granular-1');
    expect(mockGenerateStructured).toHaveBeenCalledTimes(2);
    expect(mockGenerateStructured.mock.calls[0][0].messages[0].content).toContain(
      '1. What is ATP?'
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        questions: [expect.objectContaining({ question: 'How does ATP power transport?' })],
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
