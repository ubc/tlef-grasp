jest.mock('../../src/utils/structured-llm', () => ({
  generateStructured: jest.fn(),
}));

jest.mock('../../src/services/settings', () => ({
  getSettings: jest.fn(),
}));

const { generateStructured } = require('../../src/utils/structured-llm');
const settingsService = require('../../src/services/settings');
const {
  gradeOpenEndedAnswer,
  gradeFillInTheBlankAnswer,
} = require('../../src/services/answer-grading');
const { DEFAULT_PROMPTS } = require('../../src/constants/app-constants');
const {
  OPEN_ENDED_GRADING_SCHEMA,
  FILL_IN_THE_BLANK_GRADING_SCHEMA,
} = require('../../src/constants/llm-schemas');

const llmResponse = (payload) => ({
  content: JSON.stringify(payload),
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
});

describe('answer-grading service', () => {
  let consoleErrorSpy;

  beforeAll(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  beforeEach(() => {
    generateStructured.mockReset();
    settingsService.getSettings.mockReset();
    settingsService.getSettings.mockResolvedValue({ prompts: {} });
  });

  describe('gradeOpenEndedAnswer', () => {
    const args = {
      courseId: 'course-1',
      question: 'Explain photosynthesis.',
      studentAnswer: 'Plants convert light to chemical energy.',
      sampleAnswer: 'Light reactions produce ATP; the Calvin cycle fixes CO2.',
      gradingCriteria: 'Mentions light reactions; mentions carbon fixation.',
    };

    it('fills the default prompt and normalizes the structured verdict', async () => {
      generateStructured.mockResolvedValue(
        llmResponse({
          pass: true,
          overallFeedback: '  Good coverage.  ',
          criteria: [
            { criterion: ' Light reactions ', met: true, comment: ' Covered. ' },
            { criterion: 'Carbon fixation', met: false, comment: 'Missing.' },
          ],
        })
      );

      const result = await gradeOpenEndedAnswer(args);

      expect(result).toEqual({
        pass: true,
        overallFeedback: 'Good coverage.',
        criteria: [
          { criterion: 'Light reactions', met: true, comment: 'Covered.' },
          { criterion: 'Carbon fixation', met: false, comment: 'Missing.' },
        ],
      });

      expect(generateStructured).toHaveBeenCalledTimes(1);
      const call = generateStructured.mock.calls[0][0];
      expect(call.schema).toBe(OPEN_ENDED_GRADING_SCHEMA);
      expect(call.temperature).toBe(0.1);
      expect(call.prompt).toContain(args.question);
      expect(call.prompt).toContain(args.studentAnswer);
      expect(call.prompt).toContain(args.sampleAnswer);
      expect(call.prompt).toContain(args.gradingCriteria);
      expect(call.prompt).not.toContain('{question}');
      expect(call.prompt).not.toContain('{studentAnswer}');
    });

    it('does not mangle replacement-pattern characters in the student answer', async () => {
      // String.replace would corrupt "$&" / "$'" sequences; the service must not.
      generateStructured.mockResolvedValue(
        llmResponse({ pass: false, overallFeedback: 'f', criteria: [] })
      );

      await gradeOpenEndedAnswer({ ...args, studentAnswer: "Costs $& more than $' baseline" });

      const call = generateStructured.mock.calls[0][0];
      expect(call.prompt).toContain("Costs $& more than $' baseline");
    });

    it('uses the course-specific prompt override when one is set', async () => {
      settingsService.getSettings.mockResolvedValue({
        prompts: { openEndedGrading: 'CUSTOM PROMPT {question} / {studentAnswer}' },
      });
      generateStructured.mockResolvedValue(
        llmResponse({ pass: true, overallFeedback: 'f', criteria: [] })
      );

      await gradeOpenEndedAnswer(args);

      expect(settingsService.getSettings).toHaveBeenCalledWith('course-1');
      const call = generateStructured.mock.calls[0][0];
      expect(call.prompt).toBe(
        `CUSTOM PROMPT ${args.question} / ${args.studentAnswer}`
      );
    });

    it('falls back to the default prompt when settings lookup fails', async () => {
      settingsService.getSettings.mockRejectedValue(new Error('db down'));
      generateStructured.mockResolvedValue(
        llmResponse({ pass: true, overallFeedback: 'f', criteria: [] })
      );

      await gradeOpenEndedAnswer(args);

      const call = generateStructured.mock.calls[0][0];
      // Default prompt with placeholders filled: shares the instruction header.
      expect(call.prompt).toContain('You are an automated grader');
      expect(call.prompt).toContain(args.question);
    });

    it('substitutes guidance when the question has no grading criteria', async () => {
      generateStructured.mockResolvedValue(
        llmResponse({ pass: true, overallFeedback: 'f', criteria: [] })
      );

      await gradeOpenEndedAnswer({ ...args, gradingCriteria: '' });

      const call = generateStructured.mock.calls[0][0];
      expect(call.prompt).toContain('No explicit rubric provided');
    });

    it('propagates LLM failures to the caller', async () => {
      generateStructured.mockRejectedValue(new Error('provider unavailable'));
      await expect(gradeOpenEndedAnswer(args)).rejects.toThrow('provider unavailable');
    });

    it('propagates unparseable output to the caller', async () => {
      generateStructured.mockResolvedValue({ content: 'not json', usage: {} });
      await expect(gradeOpenEndedAnswer(args)).rejects.toThrow();
    });
  });

  describe('gradeFillInTheBlankAnswer', () => {
    const args = {
      courseId: 'course-1',
      question: 'The powerhouse of the cell is _________.',
      studentAnswer: 'the mitochondria',
      correctAnswer: 'mitochondrion',
      acceptableAnswers: ['mitochondrion', 'mitochondria'],
    };

    it('returns the normalized verdict and lists instructor alternatives', async () => {
      generateStructured.mockResolvedValue(
        llmResponse({ correct: true, feedback: ' Equivalent phrasing. ' })
      );

      const result = await gradeFillInTheBlankAnswer(args);

      expect(result).toEqual({ correct: true, feedback: 'Equivalent phrasing.' });
      const call = generateStructured.mock.calls[0][0];
      expect(call.schema).toBe(FILL_IN_THE_BLANK_GRADING_SCHEMA);
      expect(call.prompt).toContain(args.question);
      expect(call.prompt).toContain(args.studentAnswer);
      expect(call.prompt).toContain('mitochondrion');
      // The canonical answer is not repeated in the alternatives list.
      expect(call.prompt).toContain('mitochondria');
      expect(call.prompt).not.toContain('mitochondrion; mitochondria');
    });

    it('marks alternatives as "(none)" when only the canonical answer exists', async () => {
      generateStructured.mockResolvedValue(
        llmResponse({ correct: false, feedback: 'f' })
      );

      await gradeFillInTheBlankAnswer({ ...args, acceptableAnswers: ['mitochondrion'] });

      const call = generateStructured.mock.calls[0][0];
      expect(call.prompt).toContain('(none)');
    });

    it('propagates LLM failures to the caller', async () => {
      generateStructured.mockRejectedValue(new Error('provider unavailable'));
      await expect(gradeFillInTheBlankAnswer(args)).rejects.toThrow('provider unavailable');
    });
  });
});
