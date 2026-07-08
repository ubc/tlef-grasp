const { QUESTION_TYPES } = require('../../src/constants/app-constants');
const CalculationQuestion = require('../../src/models/questions/CalculationQuestion');
const FillInTheBlankQuestion = require('../../src/models/questions/FillInTheBlankQuestion');
const MultipleChoiceQuestion = require('../../src/models/questions/MultipleChoiceQuestion');
const OpenEndedQuestion = require('../../src/models/questions/OpenEndedQuestion');
const Question = require('../../src/models/questions/Question');
const QuestionFactory = require('../../src/models/questions/QuestionFactory');

describe('question model normalization', () => {
  it('keeps the abstract base question contract explicit', () => {
    const instance = new Question({ id: 'question-1' });

    expect(instance.data).toEqual({ id: 'question-1' });
    expect(() => Question.getPromptInstruction()).toThrow(
      'getPromptInstruction() must be implemented by subclass'
    );
    expect(() => Question.getJsonSchema()).toThrow(
      'getJsonSchema() must be implemented by subclass'
    );
    expect(() => Question.getRetrySuffix()).toThrow(
      'getRetrySuffix() must be implemented by subclass'
    );
    expect(() => Question.validateAndNormalize()).toThrow(
      'validateAndNormalize() must be implemented by subclass'
    );
  });

  it('exposes schema and retry guidance for question generation models', () => {
    expect(MultipleChoiceQuestion.getJsonSchema().required).toEqual([
      'scratchwork',
      'question',
      'options',
      'correctAnswer',
      'explanation',
    ]);
    expect(MultipleChoiceQuestion.getPromptInstruction()).toContain(
      'Generate 4 answer options'
    );
    expect(
      MultipleChoiceQuestion.getRetrySuffix(2, new Error('duplicate options'))
    ).toContain('duplicate options');

    expect(FillInTheBlankQuestion.getJsonSchema().required).toContain(
      'acceptableAnswers'
    );
    expect(FillInTheBlankQuestion.getPromptInstruction()).toContain(
      'exactly ONE blank'
    );
    expect(FillInTheBlankQuestion.getRetrySuffix(1, new Error('bad blank'))).toContain(
      'bad blank'
    );

    expect(OpenEndedQuestion.getJsonSchema().required).toContain(
      'openEndedGradingCriteria'
    );
    expect(OpenEndedQuestion.getPromptInstruction()).toContain(
      'openEndedSampleAnswer'
    );
    expect(OpenEndedQuestion.getRetrySuffix(1, new Error('weak rubric'))).toContain(
      'weak rubric'
    );

    expect(CalculationQuestion.getJsonSchema().required).toContain(
      'calculationFormula'
    );
    expect(CalculationQuestion.getPromptInstruction()).toContain(
      'PARAMETERIZED CALCULATION QUESTION'
    );
    expect(CalculationQuestion.getRetrySuffix(1, new Error('square brackets'))).toContain(
      'square brackets'
    );
  });

  it('maps supported question types to their model classes', () => {
    expect(QuestionFactory.getModel(QUESTION_TYPES.MULTIPLE_CHOICE)).toBe(
      MultipleChoiceQuestion
    );
    expect(QuestionFactory.getModel(QUESTION_TYPES.FILL_IN_THE_BLANK)).toBe(
      FillInTheBlankQuestion
    );
    expect(QuestionFactory.getModel(QUESTION_TYPES.OPEN_ENDED)).toBe(OpenEndedQuestion);
    expect(QuestionFactory.getModel(QUESTION_TYPES.CALCULATION)).toBe(
      CalculationQuestion
    );
    expect(() => QuestionFactory.getModel('matching')).toThrow(
      'Unsupported question type: matching'
    );
  });

  it('normalizes multiple-choice questions and rejects duplicate option text', () => {
    const normalized = MultipleChoiceQuestion.validateAndNormalize({
      question: '  Which option is correct?  ',
      options: {
        A: { text: ' Alpha ', feedback: '' },
        B: { text: 'Beta', feedback: 'Not beta.' },
        C: { text: 'Gamma', feedback: 'Not gamma.' },
        D: { text: 'Delta', feedback: 'Not delta.' },
      },
      correctAnswer: ' a ',
      explanation: 'Because alpha.',
    });

    expect(normalized).toEqual({
      type: QUESTION_TYPES.MULTIPLE_CHOICE,
      questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
      question: 'Which option is correct?',
      options: {
        A: { text: 'Alpha', feedback: '' },
        B: { text: 'Beta', feedback: 'Not beta.' },
        C: { text: 'Gamma', feedback: 'Not gamma.' },
        D: { text: 'Delta', feedback: 'Not delta.' },
      },
      correctAnswer: 'A',
      explanation: 'Because alpha.',
    });

    expect(() =>
      MultipleChoiceQuestion.validateAndNormalize({
        question: 'Duplicate?',
        options: {
          A: { text: 'Same', feedback: '' },
          B: { text: ' same ', feedback: '' },
          C: { text: 'Different', feedback: '' },
          D: { text: 'Another', feedback: '' },
        },
        correctAnswer: 'A',
        explanation: '',
      })
    ).toThrow('Two or more answer options have identical or near-identical text.');
  });

  it('normalizes fill-in-the-blank fallback fields', () => {
    const normalized = FillInTheBlankQuestion.validateAndNormalize({
      topicTitle: 'Important answer???',
      question: 'The kinetic energy formula is _________.',
      correctAnswer: '1/2 mv^2',
      acceptableAnswers: [' ', '0.5mv^2', '1/2 mv^2'],
      explanation: null,
    });

    expect(normalized).toMatchObject({
      type: QUESTION_TYPES.FILL_IN_THE_BLANK,
      questionType: QUESTION_TYPES.FILL_IN_THE_BLANK,
      topicTitle: 'Important answer',
      correctAnswer: '1/2 mv^2',
      acceptableAnswers: ['0.5mv^2', '1/2 mv^2'],
      explanation: '',
      options: null,
    });

    expect(
      FillInTheBlankQuestion.validateAndNormalize({
        topicTitle: '',
        question: 'Photosynthesis converts _________.',
        correctAnswer: 'light energy',
        acceptableAnswers: [],
        explanation: 'Concept check.',
      }).topicTitle
    ).toBe('Photosynthesis converts');
  });

  it('normalizes open-ended fields and fallback topic titles', () => {
    const normalized = OpenEndedQuestion.validateAndNormalize({
      topicTitle: '',
      question: ' Explain why catalysts alter reaction rates. ',
      openEndedSampleAnswer: ' Catalysts lower activation energy. ',
      openEndedGradingCriteria: ' Mentions activation energy and rate. ',
      explanation: null,
    });

    expect(normalized).toMatchObject({
      type: QUESTION_TYPES.OPEN_ENDED,
      questionType: QUESTION_TYPES.OPEN_ENDED,
      topicTitle: 'Explain why catalysts alter reaction rates.',
      question: 'Explain why catalysts alter reaction rates.',
      stem: 'Explain why catalysts alter reaction rates.',
      openEndedSampleAnswer: 'Catalysts lower activation energy.',
      openEndedGradingCriteria: 'Mentions activation energy and rate.',
      explanation: '',
      options: null,
    });
  });

  it('normalizes calculation questions and rejects malformed variables', () => {
    const normalized = CalculationQuestion.validateAndNormalize({
      topicTitle: 'Projectile speed?',
      stem: 'A projectile travels {{d}} meters in {{t}} seconds. Find speed.',
      calculationFormula: 'speed = d / t',
      calculationVariables: [
        { name: ' d ', min: '10', max: '20', integerOnly: true, decimals: null },
        { name: 't', min: 2, max: 5, integerOnly: false, decimals: 3 },
      ],
      calculationAnswerDecimals: 20,
      calculationAnswerTolerancePercent: 105,
      explanation: 'distance divided by time',
    });

    expect(normalized).toMatchObject({
      type: QUESTION_TYPES.CALCULATION,
      questionType: QUESTION_TYPES.CALCULATION,
      topicTitle: 'Projectile speed',
      calculationFormula: 'd / t',
      calculationVariables: [
        { name: 'd', min: 10, max: 20, integerOnly: true },
        { name: 't', min: 2, max: 5, decimals: 3 },
      ],
      calculationAnswerDecimals: 12,
      calculationAnswerTolerancePercent: 100,
      options: null,
    });

    expect(() =>
      CalculationQuestion.validateAndNormalize({
        stem: 'Use {{x}}.',
        calculationFormula: 'x + 1',
        calculationVariables: [{ name: 'x', min: 5, max: 1 }],
      })
    ).toThrow('Invalid min/max for variable "x"');

    expect(() =>
      CalculationQuestion.validateAndNormalize({
        calculationFormula: 'x + 1',
        calculationVariables: [{ name: 'x', min: 1, max: 2 }],
      })
    ).toThrow('Missing required field: stem');

    expect(() =>
      CalculationQuestion.validateAndNormalize({
        stem: 'Use {{x}}.',
        calculationVariables: [{ name: 'x', min: 1, max: 2 }],
      })
    ).toThrow('Missing required field: calculationFormula');

    expect(() =>
      CalculationQuestion.validateAndNormalize({
        stem: 'Use {{x}}.',
        calculationFormula: 'x + 1',
        calculationVariables: [null],
      })
    ).toThrow('calculationVariables[0] must be an object');

    expect(() =>
      CalculationQuestion.validateAndNormalize({
        stem: 'Use {{x}}.',
        calculationFormula: 'x + 1',
        calculationVariables: [{ name: '!!!', min: 1, max: 2 }],
      })
    ).toThrow('calculationVariables[0] needs a valid "name"');
  });
});
