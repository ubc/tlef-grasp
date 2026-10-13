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
      'Generate 4 answer options (A-D)'
    );
    // The option count is a generation setting (issue #144): the schema and
    // the instruction follow it, and an out-of-range request gets the default.
    const five = MultipleChoiceQuestion.getJsonSchema({ mcOptionCount: 5 });
    expect(five.properties.options.required).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(five.properties.correctAnswer.enum).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(MultipleChoiceQuestion.getJsonSchema().properties.options.required).toEqual([
      'A',
      'B',
      'C',
      'D',
    ]);
    expect(MultipleChoiceQuestion.getJsonSchema({ mcOptionCount: 9 })).toBe(
      MultipleChoiceQuestion.getJsonSchema()
    );
    expect(MultipleChoiceQuestion.getPromptInstruction({ mcOptionCount: 5 })).toContain(
      'Generate 5 answer options (A-E)'
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

  it('accepts two to eight multiple-choice options and rejects malformed sets', () => {
    const option = (text, feedback) => ({ text, feedback });
    const five = MultipleChoiceQuestion.validateAndNormalize({
      question: 'Five?',
      options: {
        A: option('One', 'Not one.'),
        B: option('Two', 'Not two.'),
        C: option('Three', 'Not three.'),
        D: option('Four', 'Not four.'),
        E: option('Five', ''),
      },
      correctAnswer: 'e',
      explanation: 'Five.',
    });
    expect(Object.keys(five.options)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(five.correctAnswer).toBe('E');

    const two = MultipleChoiceQuestion.validateAndNormalize({
      question: 'True or false?',
      options: { A: option('True', ''), B: option('False', 'It is true.') },
      correctAnswer: 'A',
      explanation: '',
    });
    expect(Object.keys(two.options)).toEqual(['A', 'B']);

    expect(() =>
      MultipleChoiceQuestion.validateAndNormalize({
        question: 'One?',
        options: { A: option('Only', '') },
        correctAnswer: 'A',
        explanation: '',
      })
    ).toThrow('at least 2 answer options');

    expect(() =>
      MultipleChoiceQuestion.validateAndNormalize({
        question: 'Gap?',
        options: { A: option('One', ''), B: option('Two', 'x'), D: option('Four', 'x') },
        correctAnswer: 'A',
        explanation: '',
      })
    ).toThrow('lettered consecutively from A');

    expect(() =>
      MultipleChoiceQuestion.validateAndNormalize({
        question: 'Outside?',
        options: { A: option('One', 'x'), B: option('Two', 'x') },
        correctAnswer: 'C',
        explanation: '',
      })
    ).toThrow('correctAnswer must be one of A, B');
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

  // Multiple-choice has always emitted scratchwork first, so constrained
  // decoding produces the worked reasoning before it commits to an answer — and
  // it is the type with the fewest content errors. The types without it carried
  // nearly all of them: formulas inconsistent with their own stem, answers that
  // round to zero at the stated precision, ranges no chemist would write.
  it('makes every generated type reason before it commits', () => {
    for (const model of [MultipleChoiceQuestion, FillInTheBlankQuestion, CalculationQuestion]) {
      const schema = model.getJsonSchema();
      expect(schema.required[0]).toBe('scratchwork');
      // First in `properties` too: constrained decoding emits fields in order,
      // so a scratchwork listed last would be written after the answer it is
      // supposed to inform.
      expect(Object.keys(schema.properties)[0]).toBe('scratchwork');
    }
  });

  it('keeps scratchwork out of the stored question', () => {
    const fitb = FillInTheBlankQuestion.validateAndNormalize({
      scratchwork: 'The blank has to be the salt classification, not a word the sentence implies.',
      topicTitle: 'Salt behaviour',
      question: 'A salt of a strong acid and strong base gives a solution that is _________.',
      correctAnswer: 'neutral',
      acceptableAnswers: ['neutral'],
      explanation: '',
    });
    expect(fitb).not.toHaveProperty('scratchwork');

    const calc = CalculationQuestion.validateAndNormalize({
      scratchwork: 'Checked that x changes the result and that 2 decimals can show it.',
      topicTitle: 'Free variables',
      stem: 'A system has {{x}} variables and 2 pivots. How many are free?',
      calculationFormula: 'x-2',
      calculationVariables: [{ name: 'x', min: 3, max: 8, integerOnly: true, decimals: null }],
      calculationAnswerDecimals: 0,
      calculationAnswerTolerancePercent: null,
      explanation: '',
    });
    expect(calc).not.toHaveProperty('scratchwork');
  });

  // Half of a generated bank is fill-in-the-blank, and the type's rules only
  // ever constrained its shape — one blank, declarative, no "What/Which". A
  // stem like "the favoured side holds the weaker acid and the weaker ______"
  // satisfies all of that and still answers itself from its own parallel
  // structure.
  it('forbids a fill-in-the-blank whose sentence gives away the blank', () => {
    const instruction = FillInTheBlankQuestion.getPromptInstruction();
    expect(instruction).toMatch(/not be recoverable from the sentence/i);
    expect(instruction).toMatch(/parallel structure/i);
    // Worked counter-examples, not just a rule: the rejected stems here are
    // real ones this pipeline produced.
    expect(instruction).toContain('Bad:');
    expect(instruction).toContain('Good:');
  });

  // The JSON schema only pins field names, so a model that drifted into
  // multiple-choice phrasing still emits a schema-valid fill-in-the-blank
  // record — a question stem with no blank in it, which no amount of
  // downstream grading can match an answer against. Rejecting it here is what
  // makes getRetrySuffix() reachable for this failure.
  it('rejects a fill-in-the-blank stem that has no blank to fill', () => {
    expect(() =>
      FillInTheBlankQuestion.validateAndNormalize({
        topicTitle: 'Classifying salt solutions',
        question: 'Which salt solution is expected to be neutral in water?',
        correctAnswer: 'A',
        acceptableAnswers: ['A'],
        explanation: 'Strong acid + strong base.',
      })
    ).toThrow(/exactly one blank/i);
  });

  // Grading matches a single submitted string against acceptableAnswers, so a
  // second blank has nothing to be graded against.
  it('rejects a fill-in-the-blank stem with more than one blank', () => {
    expect(() =>
      FillInTheBlankQuestion.validateAndNormalize({
        topicTitle: 'Acid-base pairs',
        question: 'A _________ acid pairs with a _________ base.',
        correctAnswer: 'strong',
        acceptableAnswers: ['strong'],
        explanation: 'Two blanks.',
      })
    ).toThrow(/exactly one blank/i);
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

  // Issue #145: a calculation question with no variables is a fixed numeric
  // answer, and the tolerance can be a percent, an absolute amount or a range.
  it('normalizes fixed-answer calculation questions and their tolerance', () => {
    const fixed = CalculationQuestion.validateAndNormalize({
      topicTitle: 'Avogadro',
      stem: 'How many molecules are in two moles of water?',
      calculationFormula: '6.02e23 * 2',
      calculationVariables: [],
      calculationAnswerDecimals: 0,
      calculationTolerance: { mode: 'range', min: '1.2e24', max: '1.21e24' },
    });
    expect(fixed).toMatchObject({
      calculationFormula: '6.02e23 * 2',
      calculationVariables: [],
      calculationAnswerDecimals: 0,
      calculationTolerance: { mode: 'range', min: 1.2e24, max: 1.21e24 },
      calculationAnswerTolerancePercent: null,
    });

    // The LLM schema only knows the percent field; it is mirrored into the object.
    const legacy = CalculationQuestion.validateAndNormalize({
      stem: 'Use {{x}}.',
      calculationFormula: 'x + 1',
      calculationVariables: [{ name: 'x', min: 1, max: 2, integerOnly: true, decimals: null }],
      calculationAnswerTolerancePercent: 5,
    });
    expect(legacy.calculationTolerance).toEqual({ mode: 'percent', value: 5 });
    expect(legacy.calculationAnswerTolerancePercent).toBe(5);

    expect(() =>
      CalculationQuestion.validateAndNormalize({
        stem: 'Find {{x}}.',
        calculationFormula: '42',
        calculationVariables: [],
      })
    ).toThrow('stem uses placeholder(s) {{x}} but no variables are declared');
    expect(() =>
      CalculationQuestion.validateAndNormalize({
        stem: 'Find it.',
        calculationFormula: 'x + 1',
        calculationVariables: [],
      })
    ).toThrow('but no variables are declared');
    expect(() =>
      CalculationQuestion.validateAndNormalize({
        stem: 'Use {{x}}.',
        calculationFormula: 'x + 1',
        calculationVariables: [{ name: 'x', min: 1, max: 2 }],
        calculationTolerance: { mode: 'range', min: 1, max: 3 },
      })
    ).toThrow('A range tolerance needs a fixed answer');
    expect(() =>
      CalculationQuestion.validateAndNormalize({
        stem: 'Find it.',
        calculationFormula: '42',
        calculationVariables: 'x',
      })
    ).toThrow('calculationVariables must be an array');
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
