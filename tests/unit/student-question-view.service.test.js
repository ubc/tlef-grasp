// The student view of a quiz question (issues #177, #223): one prompt per
// question, and only the fields a student may see.

jest.mock('../../src/models/questions/CalculationQuestion', () => ({
  resolveCalculationDisplayTemplate: jest.fn((stem, title) => stem || title || ''),
  buildStudentCalculationInstance: jest.fn(),
  readGradingSettings: jest.fn(() => ({ answerDec: 2, tolerance: { kind: 'percent', value: 1 }, tolerancePercent: 1 })),
  toleranceForStudent: jest.fn((tolerance) => tolerance),
}));

const CalculationQuestion = require('../../src/models/questions/CalculationQuestion');
const { toStudentQuestion, toStudentQuestions } = require('../../src/services/student-question-view');

// Fields that must never reach a student, on any type.
const SECRET_FIELDS = [
  'correctAnswer',
  'acceptableAnswers',
  'openEndedSampleAnswer',
  'openEndedGradingCriteria',
  'calculationFormula',
  'calculationVariables',
  'source',
  'importWarnings',
  'stem',
  'title',
];

const secrets = {
  correctAnswer: 'B',
  acceptableAnswers: ['mitochondria'],
  openEndedSampleAnswer: 'A model answer',
  openEndedGradingCriteria: 'Mentions X',
  source: { kind: 'canvas-classic', itemId: 'i1' },
  importWarnings: ['Converted math'],
};

function expectNoSecrets(view) {
  SECRET_FIELDS.forEach((field) => expect(view).not.toHaveProperty(field));
}

let consoleErrorSpy;
beforeAll(() => {
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => consoleErrorSpy.mockRestore());

describe('toStudentQuestion', () => {
  test('shows a wizard-made multiple-choice question its stem, not its label (#177)', () => {
    const view = toStudentQuestion({
      _id: 'q1',
      questionType: 'multiple-choice',
      title: 'Kinetic energy formula',
      stem: 'What is the kinetic energy of a 2 kg object moving at 3 m/s?',
      options: { A: { text: '6 J', feedback: 'No' }, B: { text: '9 J', feedback: 'Yes' } },
      ...secrets,
    });

    expect(view).toEqual({
      id: 'q1',
      question: 'What is the kinetic energy of a 2 kg object moving at 3 m/s?',
      questionType: 'multiple-choice',
      stemImages: [],
      options: { A: '6 J', B: '9 J' },
    });
    expectNoSecrets(view);
  });

  test('shows an AI-made multiple-choice question its title, without the generic line', () => {
    const view = toStudentQuestion({
      _id: 'q2',
      questionType: 'multiple-choice',
      title: 'What is 2 + 2?',
      stem: 'Select the best answer:',
      options: { A: '3', B: '4' },
    });

    expect(view.question).toBe('What is 2 + 2?');
    expectNoSecrets(view);
  });

  test('treats a question without a type as multiple choice', () => {
    expect(toStudentQuestion({ _id: 'q3', title: 'Legacy?', options: { A: 'x', B: 'y' } }))
      .toMatchObject({ questionType: 'multiple-choice', question: 'Legacy?', options: { A: 'x', B: 'y' } });
  });

  test('sends an option image as { text, image } with only the file id and alt text', () => {
    const view = toStudentQuestion({
      _id: 'q4',
      questionType: 'multiple-answer',
      stem: 'Which are aromatic?',
      options: {
        A: { text: '', feedback: 'Yes', image: { fileId: 'f1', filename: 'benzene.png', caption: 'Ring' } },
        B: { text: 'Cyclohexane', feedback: 'No' },
      },
      correctAnswer: ['A'],
    });

    expect(view.options).toEqual({ A: { text: '', image: { fileId: 'f1', caption: 'Ring' } }, B: 'Cyclohexane' });
    expectNoSecrets(view);
  });

  test.each(['fill-in-the-blank', 'open-ended'])('sends a %s question its stem and no options', (questionType) => {
    const view = toStudentQuestion({
      _id: 'q5',
      questionType,
      title: 'Cells',
      stem: 'The powerhouse of the cell is the _________.',
      stemImage: { fileId: 'f2', caption: 'A cell' },
      ...secrets,
    });

    expect(view).toEqual({
      id: 'q5',
      question: 'The powerhouse of the cell is the _________.',
      questionType,
      stemImages: [{ fileId: 'f2', caption: 'A cell' }],
      options: {},
    });
    expectNoSecrets(view);
  });

  test('sends a calculation question one built instance, without its formula', () => {
    CalculationQuestion.buildStudentCalculationInstance.mockReturnValue({
      ok: true,
      rendered: 'Compute 2 + 3',
      token: 'tok',
      answerDecimalPlaces: 2,
    });
    const view = toStudentQuestion({
      _id: 'q6',
      questionType: 'calculation',
      title: 'Addition',
      stem: 'Compute {{x}} + {{y}}',
      calculationFormula: 'x + y',
      calculationVariables: [{ name: 'x' }, { name: 'y' }],
      ...secrets,
    });

    expect(view).toMatchObject({
      id: 'q6',
      question: 'Compute 2 + 3',
      questionType: 'calculation',
      calculationToken: 'tok',
      answerDecimalPlaces: 2,
      calculationTolerance: { kind: 'percent', value: 1 },
      calculationAnswerTolerancePercent: 1,
    });
    expectNoSecrets(view);
  });

  test('marks a calculation question that could not be built', () => {
    CalculationQuestion.buildStudentCalculationInstance.mockReturnValue({ ok: false, error: new Error('bad') });
    const view = toStudentQuestion({ _id: 'q7', questionType: 'calculation', stem: 'Compute {{x}}' });

    expect(view).toMatchObject({
      question: 'Compute {{x}}',
      calculationToken: null,
      answerDecimalPlaces: 2,
      calculationLoadError: true,
    });
  });

  test('passes objective names through for instructors previewing the quiz', () => {
    expect(toStudentQuestion({ _id: 'q8', stem: 'Q?', learningObjectiveName: 'LO 1' }))
      .toMatchObject({ learningObjectiveName: 'LO 1' });
  });
});

describe('toStudentQuestions', () => {
  test('numbers questions without an id by position', () => {
    expect(toStudentQuestions([{ stem: 'A?' }, { stem: 'B?' }]).map((q) => q.id)).toEqual(['1', '2']);
    expect(toStudentQuestions(undefined)).toEqual([]);
  });
});
