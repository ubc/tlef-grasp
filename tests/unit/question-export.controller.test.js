const {
  createCSVExport,
  createQTIExport,
  createQTIItem,
  buildObjectivesSummary,
  normalizeQuizMeta,
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

  test('header includes the objective columns', () => {
    const csv = createCSVExport('COURSE', []);
    const header = csv.split('\n')[0];
    expect(header).toContain('"Meta Learning Objective"');
    expect(header).toContain('"Granular Learning Objective"');
    expect(header).toContain('"Meta LO ID"');
    expect(header).toContain('"Granular LO ID"');
  });

  test('row carries the resolved objective names and ids', () => {
    // Names/ids are attached upstream by enrichQuestionsWithObjectives; the CSV
    // builder just reads them off the question.
    const enriched = {
      ...mcQuestion,
      learningObjectiveName: 'Understand photosynthesis',
      granularObjectiveName: 'Identify gas exchange',
      learningObjectiveId: '665f1a0000000000000000aa',
      granularObjectiveId: '665f1b0000000000000000bb',
    };
    const row = createCSVExport('COURSE', [enriched]).trim().split('\n')[1];
    expect(row).toContain('Understand photosynthesis');
    expect(row).toContain('Identify gas exchange');
    expect(row).toContain('665f1a0000000000000000aa');
    expect(row).toContain('665f1b0000000000000000bb');
  });

  test('objective columns are blank when a question is unlinked', () => {
    // mcQuestion has no objective fields; its four objective cells trail as empties.
    const row = createCSVExport('COURSE', [mcQuestion]).trim().split('\n')[1];
    expect(row.endsWith('"Understand","","","",""')).toBe(true);
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

describe('buildObjectivesSummary', () => {
  test('groups distinct granular objectives under their meta objective', () => {
    const summary = buildObjectivesSummary([
      {
        learningObjectiveId: 'meta1',
        learningObjectiveName: 'Meta One',
        granularObjectiveId: 'gran1',
        granularObjectiveName: 'Granular One',
      },
      {
        learningObjectiveId: 'meta1',
        learningObjectiveName: 'Meta One',
        granularObjectiveId: 'gran2',
        granularObjectiveName: 'Granular Two',
      },
      // Duplicate granular — must not appear twice.
      {
        learningObjectiveId: 'meta1',
        learningObjectiveName: 'Meta One',
        granularObjectiveId: 'gran1',
        granularObjectiveName: 'Granular One',
      },
    ]);
    expect(summary).toHaveLength(1);
    expect(summary[0].metaObjectiveId).toBe('meta1');
    expect(summary[0].granularObjectives).toHaveLength(2);
    expect(summary[0].granularObjectives.map((g) => g.id).sort()).toEqual(['gran1', 'gran2']);
  });

  test('surfaces granular objectives with no known parent under a null meta entry', () => {
    const summary = buildObjectivesSummary([
      { learningObjectiveId: null, granularObjectiveId: 'orphan', granularObjectiveName: 'Orphan' },
    ]);
    expect(summary).toHaveLength(1);
    expect(summary[0].metaObjectiveId).toBeNull();
    expect(summary[0].granularObjectives[0].id).toBe('orphan');
  });

  test('is empty when no questions carry objectives', () => {
    expect(buildObjectivesSummary([{ title: 'no objective' }])).toEqual([]);
  });
});

describe('normalizeQuizMeta', () => {
  test('keeps whitelisted quiz settings and coerces them', () => {
    const meta = normalizeQuizMeta({
      name: 'Week 3 Quiz',
      description: 'Enzymes',
      deliveryFormat: 'spaced-3phase',
      disablePreviousNavigation: true,
      timeLimitMinutes: 45,
      published: true,
      createdAt: '2026-07-13T22:16:43.377Z',
    });
    expect(meta).toEqual({
      name: 'Week 3 Quiz',
      description: 'Enzymes',
      deliveryFormat: 'spaced-3phase',
      disablePreviousNavigation: true,
      published: true,
      timeLimitMinutes: 45,
      createdAt: '2026-07-13T22:16:43.377Z',
    });
  });

  test('falls back to safe defaults and drops an invalid time limit', () => {
    const meta = normalizeQuizMeta({
      name: 'Q',
      deliveryFormat: 'nonsense',
      timeLimitMinutes: 0,
    });
    expect(meta.deliveryFormat).toBe('all-approved');
    expect(meta.disablePreviousNavigation).toBe(false);
    expect(meta.published).toBe(false);
    expect(meta).not.toHaveProperty('timeLimitMinutes');
  });

  test('returns null for a non-object', () => {
    expect(normalizeQuizMeta(undefined)).toBeNull();
    expect(normalizeQuizMeta('nope')).toBeNull();
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

  // Calculation questions have no QTI representation (cut from Canvas export,
  // issue #46); the dispatcher must emit nothing rather than misrepresent them.
  test('calculation produces no QTI item', () => {
    const xml = createQTIItem(calcQuestion, 0);
    expect(xml).toBe('');
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

  test('excludes calculation questions (no Canvas export for them)', () => {
    const xml = createQTIExport('Mixed Quiz', [mcQuestion, calcQuestion]);
    expect((xml.match(/<item /g) || []).length).toBe(1);
    expect(xml).not.toContain('calculated_question');
  });
});
