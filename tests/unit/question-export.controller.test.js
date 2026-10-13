const {
  createCSVExport,
  createQTIExport,
  createQTIItem,
  buildObjectivesSummary,
  normalizeQuizMeta,
  prepareQTIQuestions,
  leftOutSummary,
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
  test('adds option columns beyond D only when a question needs them (issue #144)', () => {
    const four = createCSVExport({ courseName: 'Bio' }, [mcQuestion]);
    expect(four.split('\n')[0]).toContain('"Option D","Correct Answer"');
    expect(four.split('\n')[0]).not.toContain('Option E');

    const five = {
      ...mcQuestion,
      options: { ...mcQuestion.options, E: { text: 'Argon', feedback: 'wrong' } },
      correctAnswer: 'E',
    };
    const csv = createCSVExport({ courseName: 'Bio' }, [five, fibQuestion]);
    const [header, mcRow, fibRow] = csv.split('\n');
    expect(header).toContain('"Option D","Option E","Correct Answer"');
    expect(mcRow).toContain('"Hydrogen","Argon","Argon"');
    // The other types leave every option column blank, including the fifth.
    expect(fibRow).toContain('"The _________ is the powerhouse of the cell.","","","","","","mitochondrion"');
  });

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

  test('an image-only option shows its caption in the CSV (issue #146)', () => {
    const withImage = {
      ...mcQuestion,
      options: {
        ...mcQuestion.options,
        B: { text: '', image: { fileId: '665f1a0000000000000000aa', caption: 'CO2 structure' } },
      },
    };
    const row = createCSVExport('COURSE', [withImage]).trim().split('\n')[1];
    // Once as option B, once as the correct answer.
    expect(row.match(/"CO2 structure"/g)).toHaveLength(2);
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

  // Issue #63: a calculation question with variables is a Canvas formula question.
  test('calculation with variables produces a calculated_question', () => {
    const xml = createQTIItem(calcQuestion, 0);
    expect(xml).toContain('<fieldentry>calculated_question</fieldentry>');
    expect(xml).toContain('Compute the kinetic energy of a [m] kg object at [v] m/s.');
    expect(xml).toContain('<answer_tolerance>0.005</answer_tolerance>');
    expect(xml).toContain('<formulas decimal_places="2">');
    expect(xml).toContain('<formula>0.5*m*v^2</formula>');
    expect(xml).toMatch(/<var name="m" scale="0">\s*<min>1<\/min>\s*<max>5<\/max>\s*<\/var>/);
    const sets = [...xml.matchAll(/<var_set ident="(\d+)">\s*<var name="m">(\d+)<\/var>\s*<var name="v">(\d+)<\/var>\s*<answer>([\d.]+)<\/answer>/g)];
    expect(sets).toHaveLength(50);
    for (const [, , m, v, answer] of sets) expect(Number(answer)).toBe(0.5 * m * v * v);
    // Every value set is one of the item's answers.
    const ids = xml.match(/<fieldlabel>original_answer_ids<\/fieldlabel>\s*<fieldentry>([\d,]+)</)[1];
    expect(ids).toBe(sets.map(([, id]) => id).join(','));
  });

  test('calculation with a fixed answer produces a numerical_question', () => {
    const xml = createQTIItem({ ...calcQuestion, stem: 'What is 1/3?', calculationFormula: '1/3', calculationVariables: [] }, 0);
    expect(xml).toContain('<fieldentry>numerical_question</fieldentry>');
    expect(xml).toMatch(
      /<or>\s*<varequal respident="response1">0\.33<\/varequal>\s*<and>\s*<vargte respident="response1">0\.325<\/vargte>\s*<varlte respident="response1">0\.335<\/varlte>\s*<\/and>\s*<\/or>/
    );

    const range = createQTIItem({ ...calcQuestion, stem: 'Between?', calculationFormula: '11', calculationVariables: [], calculationTolerance: { mode: 'range', min: 10, max: 12 } }, 0);
    expect(range).toMatch(/<conditionvar>\s*<vargte respident="response1">10<\/vargte>\s*<varlte respident="response1">12<\/varlte>\s*<\/conditionvar>/);
    expect(range).not.toContain('<varequal');
  });

  test('a calculation question Canvas cannot represent produces nothing', () => {
    expect(createQTIItem({ ...calcQuestion, calculationFormula: 'sinh(m) * v' }, 0)).toBe('');
  });

  // Issue #144: a question may have two to eight options.
  test('multiple choice exports every option it has', () => {
    const five = {
      ...mcQuestion,
      options: { ...mcQuestion.options, E: { text: 'Argon', feedback: 'wrong' } },
      correctAnswer: 'E',
    };
    const xml = createQTIItem(five, 0);
    expect((xml.match(/<response_label /g) || []).length).toBe(5);
    expect(xml).toContain('Argon');
    const ids = xml.match(/<fieldentry>([\d,]+)<\/fieldentry>/)[1].split(',');
    expect(ids).toHaveLength(5);
    expect(xml).toContain(`<varequal respident="response1">${ids[4]}</varequal>`);

    const two = {
      ...mcQuestion,
      options: { A: { text: 'True', feedback: '' }, B: { text: 'False', feedback: 'wrong' } },
      correctAnswer: 'A',
    };
    expect((createQTIItem(two, 0).match(/<response_label /g) || []).length).toBe(2);
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
  test('emits one <item> per question across mixed types', () => {
    const xml = createQTIExport('Mixed Quiz', prepareQTIQuestions([
      mcQuestion,
      fibQuestion,
      openQuestion,
      calcQuestion,
    ]).items);
    expect((xml.match(/<item /g) || []).length).toBe(4);
    expect(xml).toContain('multiple_choice_question');
    expect(xml).toContain('short_answer_question');
    expect(xml).toContain('essay_question');
    expect(xml).toContain('calculated_question');
    expect(xml).toContain('</questestinterop>');
  });

  test('writes only what prepareQTIQuestions kept: not a calculation question Canvas cannot represent', () => {
    const xml = createQTIExport('Mixed Quiz', prepareQTIQuestions([mcQuestion, { ...calcQuestion, calculationFormula: 'sinh(m) * v' }]).items);
    expect((xml.match(/<item /g) || []).length).toBe(1);
    expect(xml).not.toContain('calculated_question');
  });
});

describe('prepareQTIQuestions', () => {
  test('keeps the order, works out each calculation once, and lists what is left out by position', () => {
    const unsupported = { ...calcQuestion, calculationFormula: 'sinh(m) * v' };
    const { items, leftOut } = prepareQTIQuestions([mcQuestion, unsupported, calcQuestion, fibQuestion]);

    expect(items.map((item) => item.question)).toEqual([mcQuestion, calcQuestion, fibQuestion]);
    expect(items[0].calculation).toBeNull();
    expect(items[1].calculation).toMatchObject({ type: 'calculated_question', formula: '0.5*m*v^2' });
    expect(leftOut).toEqual([{ index: 1, reason: "The formula uses sinh(), which Canvas doesn't support." }]);

    // The prepared value sets are the ones written.
    const xml = createQTIExport('Quiz', items, 'g1', new Map());
    const first = items[1].calculation.valueSets[0];
    expect(xml).toContain(`<var name="m">${first.values.m}</var>`);
  });

  test('a question that cannot be read is left out, not a failed export', () => {
    const broken = { ...calcQuestion, calculationVariables: [{ name: 'm', min: 5, max: 1, integerOnly: true }], stem: 'Twice {{m}}?', calculationFormula: '2*m' };
    const { items, leftOut } = prepareQTIQuestions([broken]);
    expect(items).toEqual([]);
    expect(leftOut).toEqual([{ index: 0, reason: expect.stringMatching(/^GRASP can't draw values for this question: /) }]);
  });
});

describe('leftOutSummary', () => {
  test('lists positions and reasons, and stays small however many are left out', () => {
    expect(leftOutSummary([{ index: 2, reason: 'Because.' }])).toEqual({ count: 1, questions: [{ index: 2, reason: 'Because.' }] });

    const many = Array.from({ length: 200 }, (_, index) => ({ index, reason: `Reason ${index} ${'é'.repeat(40)}` }));
    const summary = leftOutSummary(many);
    expect(summary.count).toBe(200);
    expect(summary.questions.length).toBeGreaterThan(0);
    expect(summary.questions.length).toBeLessThan(200);
    expect(summary.questions[0]).toEqual(many[0]);
    expect(encodeURIComponent(JSON.stringify(summary)).length).toBeLessThanOrEqual(2000);
  });
});
