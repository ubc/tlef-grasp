const {
  H5P_LIBRARIES,
  filterH5PExportableQuestions,
  buildH5PPackage,
} = require('../../src/utils/h5p-export');
const { QUESTION_TYPES } = require('../../src/constants/app-constants');

const mcQuestion = {
  questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
  title: 'Which gas do plants absorb?',
  stem: 'Select the best answer:',
  options: {
    A: { text: 'Oxygen', feedback: 'Oxygen is released, not absorbed.' },
    B: { text: 'Carbon dioxide', feedback: '' },
    C: { text: 'Nitrogen', feedback: 'Nitrogen is inert here.' },
    D: { text: 'Hydrogen', feedback: 'Not involved.' },
  },
  correctAnswer: 'B',
};

const fibQuestion = {
  questionType: QUESTION_TYPES.FILL_IN_THE_BLANK,
  title: 'Powerhouse of the cell',
  stem: 'The _________ is the powerhouse of the cell.',
  correctAnswer: 'mitochondrion',
  acceptableAnswers: ['mitochondrion', 'mitochondria'],
};

const openQuestion = {
  questionType: QUESTION_TYPES.OPEN_ENDED,
  title: 'Explain natural selection',
  stem: 'Explain how natural selection drives evolution.',
  openEndedSampleAnswer: 'Organisms with advantageous traits survive and reproduce.',
  openEndedGradingCriteria: 'Mentions variation, selection pressure, and heritability.',
};

const calcQuestion = {
  questionType: QUESTION_TYPES.CALCULATION,
  stem: 'Compute the kinetic energy of a {{m}} kg object at {{v}} m/s.',
  calculationFormula: '0.5 * m * v^2',
  calculationVariables: [{ name: 'm', min: 1, max: 5, integerOnly: true }],
};

describe('filterH5PExportableQuestions', () => {
  test('keeps multiple-choice, fill-in-the-blank, and open-ended; drops calculation', () => {
    const kept = filterH5PExportableQuestions([mcQuestion, fibQuestion, openQuestion, calcQuestion]);
    expect(kept).toHaveLength(3);
    expect(kept).not.toContain(calcQuestion);
  });
});

describe('buildH5PPackage', () => {
  test('exports the whole quiz as one Question Set, calculation skipped', () => {
    const { manifest, content } = buildH5PPackage('Midterm Review', [
      mcQuestion,
      fibQuestion,
      openQuestion,
      calcQuestion,
    ]);
    expect(manifest.title).toBe('Midterm Review');
    expect(manifest.mainLibrary).toBe('H5P.QuestionSet');
    expect(content.questions).toHaveLength(3);
    expect(content.questions[0].library).toContain('H5P.MultiChoice');
    expect(content.questions[1].library).toContain('H5P.Blanks');
    expect(content.questions[2].library).toContain('H5P.Essay');
  });

  test('declares Essay as a dependency only when an open-ended question exists', () => {
    const withEssay = buildH5PPackage('Q', [mcQuestion, openQuestion]);
    const withoutEssay = buildH5PPackage('Q', [mcQuestion, fibQuestion]);
    const names = (pkg) => pkg.manifest.preloadedDependencies.map((d) => d.machineName);
    expect(names(withEssay)).toContain('H5P.Essay');
    expect(names(withoutEssay)).not.toContain('H5P.Essay');
    expect(names(withoutEssay)).toEqual(
      expect.arrayContaining(['H5P.QuestionSet', 'H5P.MultiChoice', 'H5P.Blanks'])
    );
  });

  test('library strings match the declared dependency versions', () => {
    const { content } = buildH5PPackage('Q', [mcQuestion]);
    const { multiChoice } = H5P_LIBRARIES;
    expect(content.questions[0].library).toBe(
      `${multiChoice.machineName} ${multiChoice.majorVersion}.${multiChoice.minorVersion}`
    );
  });

  test('sub-content ids are unique UUIDs', () => {
    const { content } = buildH5PPackage('Q', [mcQuestion, fibQuestion, openQuestion]);
    const ids = content.questions.map((s) => s.subContentId);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id).toMatch(/^[0-9a-f-]{36}$/));
  });

  test('intro page reflects quiz name and exportable question count', () => {
    const { content } = buildH5PPackage('Midterm Review', [mcQuestion, fibQuestion, openQuestion]);
    expect(content.introPage.title).toBe('Midterm Review');
    expect(content.introPage.introduction).toContain('3 questions');
  });
});

describe('per-type params', () => {
  const { content } = buildH5PPackage('Quiz', [mcQuestion, fibQuestion, openQuestion]);

  test('multiple-choice marks only the correct option and keeps per-option feedback', () => {
    const params = content.questions[0].params;
    expect(params.question).toContain('Which gas do plants absorb?');
    const correct = params.answers.filter((a) => a.correct);
    expect(correct).toHaveLength(1);
    expect(correct[0].text).toContain('Carbon dioxide');
    const oxygen = params.answers.find((a) => a.text.includes('Oxygen'));
    expect(oxygen.tipsAndFeedback.chosenFeedback).toContain('Oxygen is released');
    expect(params.behaviour.type).toBe('single');
  });

  test('fill-in-the-blank converts the underscore blank to H5P markup with alternatives', () => {
    const params = content.questions[1].params;
    expect(params.questions[0]).toContain('*mitochondrion/mitochondria*');
    expect(params.questions[0]).not.toContain('___');
    expect(params.behaviour.caseSensitive).toBe(false);
  });

  test('open-ended (Essay) carries sample answer and grading criteria into the solution', () => {
    const params = content.questions[2].params;
    expect(params.taskDescription).toContain('natural selection drives evolution');
    expect(params.solution.sample).toContain('advantageous traits');
    expect(params.solution.introduction).toContain('Grading criteria');
    expect(params.solution.introduction).toContain('selection pressure');
    expect(params.keywords).toEqual([]);
  });
});

describe('H5P markup safety', () => {
  test('blank answers containing H5P markup characters are sanitized', () => {
    const tricky = {
      questionType: QUESTION_TYPES.FILL_IN_THE_BLANK,
      stem: 'Speed is measured in _________.',
      correctAnswer: 'km/h',
      acceptableAnswers: ['km/h', 'k*m:h'],
    };
    const { content } = buildH5PPackage('Q', [tricky]);
    const text = content.questions[0].params.questions[0];
    // '*', '/', ':' are H5P Blanks control characters and must not survive
    // inside an answer (they'd corrupt the blank markup).
    expect(text).toContain('*km h/k m h*');
  });

  test('HTML in question text is escaped, not injected', () => {
    const sneaky = {
      questionType: QUESTION_TYPES.OPEN_ENDED,
      stem: 'Explain why <script>alert(1)</script> is dangerous.',
      openEndedSampleAnswer: 'Because & reasons.',
      openEndedGradingCriteria: '',
    };
    const { content } = buildH5PPackage('Q', [sneaky]);
    const params = content.questions[0].params;
    expect(params.taskDescription).not.toContain('<script>');
    expect(params.taskDescription).toContain('&lt;script&gt;');
    expect(params.solution.sample).toContain('&amp; reasons');
  });

  test('a stem without an underscore blank still gets an answerable blank', () => {
    const noBlank = {
      questionType: QUESTION_TYPES.FILL_IN_THE_BLANK,
      stem: 'Name the powerhouse of the cell:',
      correctAnswer: 'mitochondrion',
      acceptableAnswers: [],
    };
    const { content } = buildH5PPackage('Q', [noBlank]);
    expect(content.questions[0].params.questions[0]).toContain('*mitochondrion*');
  });
});
