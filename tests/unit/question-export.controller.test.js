const {
  createCSVExport,
  createQTIExport,
  createQTIItem,
} = require('../../src/controllers/question');
const { QUESTION_TYPES } = require('../../src/constants/app-constants');

// Representative stored question documents, one per type, shaped the way the DB
// stores them (MC keeps the prompt in `title`; the others keep it in `stem`).
const mcQuestion = {
  questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
  title: 'Which gas do plants absorb?',
  stem: 'Select the best answer:',
  options: {
    A: { text: 'Oxygen', feedback: 'wrong' },
    B: { text: 'Carbon dioxide', feedback: '' },
    C: { text: 'Nitrogen', feedback: 'wrong' },
    D: { text: 'Hydrogen', feedback: 'wrong' },
  },
  correctAnswer: 'B',
  bloom: 'Understand',
};

const fibQuestion = {
  questionType: QUESTION_TYPES.FILL_IN_THE_BLANK,
  title: 'Powerhouse of the cell',
  stem: 'The _________ is the powerhouse of the cell.',
  correctAnswer: 'mitochondrion',
  acceptableAnswers: ['mitochondrion', 'mitochondria'],
  bloom: 'Remember',
};

const openQuestion = {
  questionType: QUESTION_TYPES.OPEN_ENDED,
  title: 'Explain natural selection',
  stem: 'Explain how natural selection drives evolution.',
  openEndedSampleAnswer: 'Organisms with advantageous traits survive and reproduce.',
  openEndedGradingCriteria: 'Mentions variation, selection pressure, and heritability.',
  bloom: 'Analyze',
};

const calcQuestion = {
  questionType: QUESTION_TYPES.CALCULATION,
  title: 'Kinetic energy',
  stem: 'Compute the kinetic energy of a {{m}} kg object at {{v}} m/s.',
  calculationFormula: '0.5 * m * v^2',
  calculationVariables: [
    { name: 'm', min: 1, max: 5, integerOnly: true },
    { name: 'v', min: 1, max: 10, integerOnly: true },
  ],
  calculationAnswerDecimals: 2,
  calculationAnswerTolerancePercent: null,
  bloom: 'Apply',
};

describe('createCSVExport', () => {
  test('emits a header row with all shared columns', () => {
    const csv = createCSVExport('COURSE', []);
    const header = csv.split('\n')[0];
    expect(header).toContain('"Type"');
    expect(header).toContain('"Question"');
    expect(header).toContain('"Correct Answer"');
    expect(header).toContain('"Acceptable Answers"');
    expect(header).toContain('"Sample Answer"');
    expect(header).toContain('"Grading Criteria"');
    expect(header).toContain('"Formula"');
  });

  test('multiple-choice row resolves the correct option text', () => {
    const csv = createCSVExport('COURSE', [mcQuestion]);
    const row = csv.trim().split('\n')[1];
    expect(row).toContain('Which gas do plants absorb?');
    expect(row).toContain('Carbon dioxide');
    expect(row).toContain(QUESTION_TYPES.MULTIPLE_CHOICE);
  });

  test('fill-in-the-blank row lists acceptable answers', () => {
    const csv = createCSVExport('COURSE', [fibQuestion]);
    const row = csv.trim().split('\n')[1];
    expect(row).toContain('The _________ is the powerhouse of the cell.');
    expect(row).toContain('mitochondrion; mitochondria');
  });

  test('open-ended row carries sample answer and grading criteria', () => {
    const csv = createCSVExport('COURSE', [openQuestion]);
    const row = csv.trim().split('\n')[1];
    expect(row).toContain('Explain how natural selection drives evolution.');
    expect(row).toContain('Organisms with advantageous traits');
    expect(row).toContain('variation, selection pressure');
  });

  test('calculation row carries the formula and variable ranges', () => {
    const csv = createCSVExport('COURSE', [calcQuestion]);
    const row = csv.trim().split('\n')[1];
    expect(row).toContain('0.5 * m * v^2');
    expect(row).toContain('m ∈ [1, 5]');
  });

  test('escapes embedded quotes and commas', () => {
    const tricky = {
      questionType: QUESTION_TYPES.OPEN_ENDED,
      stem: 'He said "hello", then left.',
    };
    const csv = createCSVExport('COURSE', [tricky]);
    const row = csv.trim().split('\n')[1];
    expect(row).toContain('""hello""');
  });
});

describe('createQTIItem', () => {
  test('multiple-choice produces a multiple_choice_question with four choices', () => {
    const xml = createQTIItem(mcQuestion, 0);
    expect(xml).toContain('multiple_choice_question');
    expect((xml.match(/<response_label/g) || []).length).toBe(4);
    expect(xml).toContain('Carbon dioxide');
    expect(xml).toContain('<varequal');
  });

  test('fill-in-the-blank produces a short_answer_question with a varequal per answer', () => {
    const xml = createQTIItem(fibQuestion, 0);
    expect(xml).toContain('short_answer_question');
    expect(xml).toContain('<render_fib>');
    const varequals = xml.match(/<varequal[^>]*case="No">/g) || [];
    expect(varequals.length).toBe(2);
    expect(xml).toContain('mitochondrion');
    expect(xml).toContain('mitochondria');
  });

  test('open-ended produces an essay_question with feedback', () => {
    const xml = createQTIItem(openQuestion, 0);
    expect(xml).toContain('essay_question');
    expect(xml).toContain('<other/>');
    expect(xml).toContain('general_fb');
    expect(xml).toContain('Sample answer');
    expect(xml).toContain('Grading criteria');
  });

  test('calculation produces a parameterized calculated_question (Canvas Formula)', () => {
    const xml = createQTIItem(calcQuestion, 0);
    expect(xml).toContain('calculated_question');
    // Placeholders must be converted from {{m}} to Canvas's [m] syntax.
    expect(xml).not.toContain('{{m}}');
    expect(xml).toContain('[m]');
    expect(xml).toContain('[v]');
    // Formula, variable ranges, and the pre-generated solution pool.
    expect(xml).toContain('<formula>0.5 * m * v^2</formula>');
    expect(xml).toContain('<var name="m" scale="0">');
    expect(xml).toContain('<var name="v" scale="0">');
    expect(xml).toContain('<var_sets>');
    const varSetCount = (xml.match(/<var_set ident=/g) || []).length;
    expect(varSetCount).toBeGreaterThan(0);
    expect(varSetCount).toBeLessThanOrEqual(20);
  });

  test('calculation var_set answers are consistent with the formula', () => {
    const xml = createQTIItem(calcQuestion, 0);
    // Parse every var_set and recompute 0.5 * m * v^2 from its values.
    const varSetRe = /<var_set ident="\d+">([\s\S]*?)<\/var_set>/g;
    let match;
    let checked = 0;
    while ((match = varSetRe.exec(xml)) !== null) {
      const block = match[1];
      const m = Number(block.match(/<var name="m">([^<]+)<\/var>/)[1]);
      const v = Number(block.match(/<var name="v">([^<]+)<\/var>/)[1]);
      const answer = Number(block.match(/<answer>([^<]+)<\/answer>/)[1]);
      expect(answer).toBeCloseTo(0.5 * m * v * v, 2);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  test('calculation percent tolerance is exported as a percent margin', () => {
    const xml = createQTIItem({ ...calcQuestion, calculationAnswerTolerancePercent: 2 }, 0);
    expect(xml).toContain('<answer_tolerance>2%</answer_tolerance>');
  });

  test('calculation without tolerance exports a half-ulp absolute margin', () => {
    const xml = createQTIItem(calcQuestion, 0);
    expect(xml).toContain('<answer_tolerance>0.005</answer_tolerance>');
  });

  test('calculation formula constants are lowercased for Canvas (PI -> pi)', () => {
    const circle = {
      questionType: QUESTION_TYPES.CALCULATION,
      stem: 'Area of a circle with radius {{r}}?',
      calculationFormula: 'PI * r^2',
      calculationVariables: [{ name: 'r', min: 1, max: 5, integerOnly: true }],
      calculationAnswerDecimals: 2,
    };
    const xml = createQTIItem(circle, 0);
    expect(xml).toContain('<formula>pi * r^2</formula>');
  });

  test('calculation with an unsamplable formula falls back to an essay item', () => {
    const broken = {
      questionType: QUESTION_TYPES.CALCULATION,
      stem: 'Compute something.',
      calculationFormula: '',
      calculationVariables: [],
    };
    const xml = createQTIItem(broken, 0);
    expect(xml).toContain('essay_question');
  });

  test('legacy rows with no questionType default to multiple choice', () => {
    const legacy = {
      title: 'Legacy question?',
      options: { A: 'a', B: 'b', C: 'c', D: 'd' },
      correctAnswer: 'A',
    };
    const xml = createQTIItem(legacy, 0);
    expect(xml).toContain('multiple_choice_question');
  });
});

describe('createQTIExport', () => {
  test('emits one <item> per supported question across mixed types', () => {
    const xml = createQTIExport('Mixed Quiz', [
      mcQuestion,
      fibQuestion,
      openQuestion,
      calcQuestion,
    ]);
    expect((xml.match(/<item /g) || []).length).toBe(3);
    expect(xml).toContain('multiple_choice_question');
    expect(xml).toContain('short_answer_question');
    expect(xml).toContain('essay_question');
    expect(xml).toContain('</questestinterop>');
  });

  // Calculation export to Canvas is built and tested (see createQTIItem specs
  // above) but disabled pending a live Canvas import verification (issue #46).
  test('excludes calculation questions until verified against live Canvas', () => {
    const xml = createQTIExport('Mixed Quiz', [mcQuestion, calcQuestion]);
    expect((xml.match(/<item /g) || []).length).toBe(1);
    expect(xml).not.toContain('calculated_question');
  });
});
