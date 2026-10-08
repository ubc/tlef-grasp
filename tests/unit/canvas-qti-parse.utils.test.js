// The speed tests below catch quadratic blow-ups (old code took 20-40 s);
// their limits leave room for slow, coverage-instrumented CI runners.
jest.setTimeout(30000);

/**
 * Canvas Classic Quizzes QTI parser (utils/canvas-qti-parse.js, #140).
 *
 * The XML comes from the fixture builders, which mirror real Canvas exports, so
 * these tests also pin the builders' output. Each rule is a trap from the real
 * exports or from Canvas's exporter: the correct answer is the scoring
 * condition's, fill-in blanks accept every label, meta reads only <quiz>'s own
 * children, and damaged XML fails loudly.
 */

const {
  parseCanvasQuiz,
  CANVAS_QUESTION_TYPES,
  PARSE_WARNINGS,
  MAX_SLOTS_PER_QUIZ,
  MAX_ITEMS_PER_QUIZ,
  MAX_XML_DEPTH,
} = require('../../src/utils/canvas-qti-parse');
const { CanvasImportError } = require('../../src/utils/canvas-qti-package');
const {
  quizXml,
  groupSection,
  mcItem,
  numericalItem,
  fimbItem,
  shortAnswerItem,
  calculatedItem,
  otherItem,
  metaXml,
} = require('../fixtures/canvas-qti/items');

const QUIZ = 'gquiz0001';

function parse(slots, { meta = {}, quiz = {} } = {}) {
  return parseCanvasQuiz({
    ident: QUIZ,
    xml: quizXml({ ident: QUIZ, title: 'Synthetic Quiz', slots, ...quiz }),
    metaXml: meta === null ? null : metaXml({ ident: QUIZ, title: 'Synthetic Quiz', ...meta }),
  });
}

// The single standalone item of a one-slot quiz.
function parseItem(itemXml, options) {
  return parse([itemXml], options).slots[0].item;
}

function badXmlError(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a BAD_XML error');
}

const EMPTY_ITEM_PARTS = {
  choices: [],
  correctChoiceIdents: [],
  choiceFeedbackHtml: {},
  feedbackHtml: { general: null, correct: null, incorrect: null },
  numericAnswers: [],
  blanks: [],
  shortAnswers: [],
  rawWarnings: [],
};

describe('parseCanvasQuiz: quiz and slots', () => {
  test('reads a group and an interleaved standalone item in document order', () => {
    const quiz = parse([
      groupSection({
        ident: 'ggroup1',
        title: 'Q01',
        items: [mcItem({ ident: 'gitem1', title: 'Q01' }), mcItem({ ident: 'gitem2', title: 'Q01' })],
      }),
      mcItem({ ident: 'gitem3', title: 'Q02' }),
      groupSection({ ident: 'ggroup3', title: 'Q03', items: [mcItem({ ident: 'gitem4' })] }),
    ]);

    expect(quiz.ident).toBe(QUIZ);
    expect(quiz.title).toBe('Synthetic Quiz');
    expect(quiz.flavour).toBe('classic');
    expect(quiz.slots.map((slot) => [slot.kind, slot.ident])).toEqual([
      ['group', 'ggroup1'],
      ['item', 'gitem3'],
      ['group', 'ggroup3'],
    ]);
    const [group, standalone] = quiz.slots;
    expect(group).toMatchObject({ kind: 'group', ident: 'ggroup1', title: 'Q01', pick: 1, pointsPerItem: 1, sourceBankRef: null });
    expect(group.items.map((item) => item.ident)).toEqual(['gitem1', 'gitem2']);
    expect(standalone.item.ident).toBe('gitem3');
  });

  test('reads pick, a 0-point group and a question-bank group with no items', () => {
    const quiz = parse([
      groupSection({ ident: 'gpick', title: 'Q01', pick: 2, pointsPerItem: 0, items: [mcItem({ ident: 'g1' }), mcItem({ ident: 'g2' })] }),
      groupSection({ ident: 'gbank', title: 'Bank pick', pick: 3, pointsPerItem: 2, sourceBankRef: 'gbankref01' }),
    ]);

    expect(quiz.slots[0]).toMatchObject({ pick: 2, pointsPerItem: 0, sourceBankRef: null });
    expect(quiz.slots[1]).toEqual({
      kind: 'group',
      ident: 'gbank',
      title: 'Bank pick',
      pick: 3,
      pointsPerItem: 2,
      sourceBankRef: 'gbankref01',
      items: [],
    });
  });

  test('defaults pick to 1 and points per item to null when the selection leaves them out', () => {
    const xml = quizXml({ slots: [groupSection({ ident: 'gplain', items: [mcItem({ ident: 'g1' })] })] })
      .replace(/<selection_number>1<\/selection_number>\s*/, '')
      .replace(/<selection_extension>[\s\S]*?<\/selection_extension>\s*/, '');
    const [group] = parseCanvasQuiz({ ident: QUIZ, xml, metaXml: null }).slots;

    expect(group.pick).toBe(1);
    expect(group.pointsPerItem).toBeNull();
  });

  test('flattens items of nested sections into their top-level group', () => {
    const quiz = parse([
      groupSection({
        ident: 'gouter',
        title: 'Outer',
        items: [
          mcItem({ ident: 'ga' }),
          groupSection({ ident: 'ginner', title: 'Inner', items: [mcItem({ ident: 'gb' }), mcItem({ ident: 'gc' })] }),
        ],
      }),
    ]);

    expect(quiz.slots).toHaveLength(1);
    expect(quiz.slots[0].ident).toBe('gouter');
    expect(quiz.slots[0].items.map((item) => item.ident)).toEqual(['ga', 'gb', 'gc']);
  });

  test('takes the ident from the assessment when none is passed', () => {
    const quiz = parseCanvasQuiz({ xml: quizXml({ ident: 'gfromxml', slots: [] }), metaXml: null });
    expect(quiz.ident).toBe('gfromxml');
    expect(quiz.slots).toEqual([]);
  });

  test('gives an item or group without an ident a positional one', () => {
    const xml = quizXml({
      slots: [groupSection({ ident: 'gx', items: [mcItem({ ident: 'gfirst' })] }), mcItem({ ident: 'gsecond' })],
    })
      .replace('<section ident="gx"', '<section')
      .replace('<item ident="gsecond"', '<item');
    const quiz = parseCanvasQuiz({ ident: QUIZ, xml, metaXml: null });

    expect(quiz.slots.map((slot) => slot.ident)).toEqual(['group-1', 'item-2']);
    expect(quiz.slots[1].item.ident).toBe('item-2');
  });

  test('reads elements written with a namespace prefix', () => {
    const plain = quizXml({ ident: QUIZ, title: 'Prefixed', slots: [mcItem({ ident: 'gp1', correct: '1002' })] });
    const prefixed = plain.replace(/<(\/?)([A-Za-z_][\w]*)(?=[\s>/])/g, '<$1qti:$2');
    const quiz = parseCanvasQuiz({ ident: QUIZ, xml: prefixed, metaXml: null });

    expect(quiz.title).toBe('Prefixed');
    expect(quiz.slots[0].item.correctChoiceIdents).toEqual(['1002']);
    expect(quiz.slots[0].item.choices).toHaveLength(4);
  });
});

describe('parseCanvasQuiz: multiple choice', () => {
  test('reads the real Canvas MC shape into the item model', () => {
    const item = parseItem(
      mcItem({
        ident: 'gmc1',
        title: 'Q01',
        stemHtml: '<div>\n<p>Pick the larger&nbsp;value: 3 &lt; 4?</p>\n</div>',
        choices: [
          { ident: '701', text: 'a < b & c' },
          { ident: '708', html: '<p>x<sup>2</sup></p>' },
        ],
        correct: '708',
        points: 2,
      }),
    );

    expect(item).toEqual({
      ...EMPTY_ITEM_PARTS,
      ident: 'gmc1',
      title: 'Q01',
      questionType: 'multiple_choice_question',
      pointsPossible: 2,
      // XML entities are decoded once; the HTML's own entities stay for the HTML converter.
      stemHtml: '<div>\n<p>Pick the larger&nbsp;value: 3 &lt; 4?</p>\n</div>',
      stemTexttype: 'text/html',
      choices: [
        { ident: '701', text: 'a < b & c', texttype: 'text/plain' },
        { ident: '708', text: '<p>x<sup>2</sup></p>', texttype: 'text/html' },
      ],
      correctChoiceIdents: ['708'],
    });
  });

  test('takes the correct answer from the scoring condition, not the first answer-comment condition', () => {
    const item = parseItem(
      mcItem({
        ident: 'gfb',
        choices: [
          { ident: '11', text: 'Option one' },
          { ident: '12', text: 'Option two' },
          { ident: '13', text: 'Option three' },
        ],
        correct: '13',
        answerFeedback: { 11: '<p>Not this one.</p>', 13: { text: 'Yes: 1 < 2' } },
        generalFeedback: { general: '<p>General.</p>', correct: '<p>Well done.</p>', incorrect: '<p>Try again.</p>' },
      }),
    );

    expect(item.correctChoiceIdents).toEqual(['13']);
    expect(item.choiceFeedbackHtml).toEqual({ 11: '<p>Not this one.</p>', 13: 'Yes: 1 &lt; 2' });
    expect(item.feedbackHtml).toEqual({ general: '<p>General.</p>', correct: '<p>Well done.</p>', incorrect: '<p>Try again.</p>' });
    expect(item.rawWarnings).toEqual([]);
  });

  test('reports no correct answer and several correct answers as Canvas scores them', () => {
    const choices = [
      { ident: '21', text: 'One' },
      { ident: '22', text: 'Two' },
      { ident: '23', text: 'Three' },
    ];
    expect(parseItem(mcItem({ ident: 'gnone', choices, correct: null })).correctChoiceIdents).toEqual([]);
    // Choice order wins over scoring-condition order; repeats collapse.
    expect(parseItem(mcItem({ ident: 'gtwo', choices, correct: ['23', '21', '23'] })).correctChoiceIdents).toEqual(['21', '23']);
  });

  test('ignores a condition whose setvar awards nothing and counts Add on any variable', () => {
    const choices = [
      { ident: '31', text: 'One' },
      { ident: '32', text: 'Two' },
    ];
    const zero = mcItem({ ident: 'gzero', choices, correct: '31' }).replace('>100</setvar>', '>0</setvar>');
    expect(parseItem(zero).correctChoiceIdents).toEqual([]);

    const added = mcItem({ ident: 'gadd', choices, correct: '32' }).replace(
      '<setvar action="Set" varname="SCORE">100</setvar>',
      '<setvar varname="POINTS" action="Add">1.5</setvar>',
    );
    expect(parseItem(added).correctChoiceIdents).toEqual(['32']);

    const subtracted = mcItem({ ident: 'gsub', choices, correct: '32' }).replace('action="Set"', 'action="Subtract"');
    expect(parseItem(subtracted).correctChoiceIdents).toEqual([]);
  });

  test('flags duplicate choice idents and a scored answer that is not an option', () => {
    const duplicate = parseItem(
      mcItem({
        ident: 'gdup',
        choices: [
          { ident: '41', text: 'One' },
          { ident: '41', text: 'Also one' },
        ],
        correct: '41',
      }),
    );
    expect(duplicate.correctChoiceIdents).toEqual(['41']);
    expect(duplicate.rawWarnings).toEqual([PARSE_WARNINGS.DUPLICATE_CHOICE_IDENT]);

    const unknown = parseItem(mcItem({ ident: 'gunk', correct: '9999' }));
    expect(unknown.correctChoiceIdents).toEqual([]);
    expect(unknown.rawWarnings).toEqual([PARSE_WARNINGS.UNKNOWN_CORRECT_CHOICE]);
  });

  test('flags a second answer area and reads only the first', () => {
    const doubled = mcItem({ ident: 'gtwolids', correct: '1001' }).replace(
      '</response_lid>',
      '</response_lid>\n<response_lid ident="response2"><render_choice><response_label ident="7"/></render_choice></response_lid>',
    );
    const item = parseItem(doubled);

    expect(item.choices.map((choice) => choice.ident)).toEqual(['1001', '1002', '1003', '1004']);
    expect(item.rawWarnings).toEqual([PARSE_WARNINGS.EXTRA_RESPONSE_AREAS]);
  });

  test('reads true/false as two plain choices', () => {
    const item = parseItem(mcItem({ ident: 'gtf', type: 'true_false_question', correct: '1002' }));

    expect(item.questionType).toBe('true_false_question');
    expect(item.choices).toEqual([
      { ident: '1001', text: 'True', texttype: 'text/plain' },
      { ident: '1002', text: 'False', texttype: 'text/plain' },
    ]);
    expect(item.correctChoiceIdents).toEqual(['1002']);
  });

  test('reads every multiple-answers correct choice and ignores the negated ones', () => {
    const item = parseItem(
      mcItem({
        ident: 'gma',
        type: 'multiple_answers_question',
        choices: [
          { ident: '51', text: 'One' },
          { ident: '52', text: 'Two' },
          { ident: '53', text: 'Three' },
        ],
        correct: ['52', '53'],
      }),
    );

    expect(item.questionType).toBe('multiple_answers_question');
    expect(item.correctChoiceIdents).toEqual(['52', '53']);
  });

  test('reads a CDATA stem and a stem written as raw child elements', () => {
    const cdata = mcItem({ ident: 'gcdata', stemHtml: 'PLACEHOLDER' }).replace(
      '<mattext texttype="text/html">PLACEHOLDER</mattext>',
      '<mattext texttype="text/html"><![CDATA[<p>Uses <b>CDATA</b> & raw text</p>]]></mattext>',
    );
    expect(parseItem(cdata).stemHtml).toBe('<p>Uses <b>CDATA</b> & raw text</p>');

    const elements = mcItem({ ident: 'gelem', stemHtml: 'PLACEHOLDER' }).replace(
      '<mattext texttype="text/html">PLACEHOLDER</mattext>',
      '<mattext texttype="text/html"><p>Look <img src="a.png"/></p></mattext>',
    );
    expect(parseItem(elements).stemHtml).toBe('<p>Look <img src="a.png"/></p>');
  });
});

describe('parseCanvasQuiz: numerical, calculated, fill-in and other types', () => {
  test('reads the real exact-with-margin shape as written', () => {
    const item = parseItem(
      numericalItem({ ident: 'gnum', title: 'Q07', answers: [{ exact: '-512.4', min: '-512.6', max: '-512.2' }] }),
    );

    expect(item).toEqual({
      ...EMPTY_ITEM_PARTS,
      ident: 'gnum',
      title: 'Q07',
      questionType: 'numerical_question',
      pointsPossible: 1,
      stemHtml: '<div>\n<p>Synthetic numerical question.</p>\n</div>',
      stemTexttype: 'text/html',
      numericAnswers: [{ exact: '-512.4', min: '-512.6', max: '-512.2' }],
    });
  });

  test('reads exact-only, range-only, exclusive-bound and several answers', () => {
    const item = parseItem(
      numericalItem({
        ident: 'gnums',
        answers: [
          { exact: '3.0' },
          { min: '1.5', max: '2.5' },
          { exact: '19', min: '18.95', max: '19.05', minExclusive: true, maxExclusive: true },
          { min: '7' },
        ],
      }),
    );

    expect(item.numericAnswers).toEqual([
      { exact: '3.0', min: null, max: null },
      { exact: null, min: '1.5', max: '2.5' },
      { exact: '19', min: '18.95', max: '19.05' },
      { exact: null, min: '7', max: null },
    ]);
  });

  test('flags numerical answer feedback, which has no choice to attach to, and reads general feedback', () => {
    const item = parseItem(
      numericalItem({
        ident: 'gnumfb',
        answers: [{ exact: '2.0', min: '2.0', max: '2.0', feedback: '<p>Close.</p>' }],
        generalFeedback: { general: '<p>Units are kJ.</p>' },
      }),
    );

    expect(item.feedbackHtml).toEqual({ general: '<p>Units are kJ.</p>', correct: null, incorrect: null });
    expect(item.rawWarnings).toEqual([PARSE_WARNINGS.FEEDBACK_NOT_READ]);
  });

  test('reads a formula question without inventing numeric answers from its <other/> condition', () => {
    const item = parseItem(calculatedItem({ ident: 'gcalc', title: 'Q04' }));

    expect(item.questionType).toBe('calculated_question');
    expect(item.numericAnswers).toEqual([]);
    expect(item.choices).toEqual([]);
    expect(item.stemHtml).toBe('<div>\n<p>Double [x].</p>\n</div>');
  });

  test('accepts every label of a fill-in blank although scoring names only the first', () => {
    const item = parseItem(
      fimbItem({
        ident: 'gfimb',
        title: 'Name_1A',
        stemHtml: '<div>The synthetic compound is [x1] <br></div>',
        blanks: [{ id: 'x1', answers: ['synthane', 'synth ane', ' 1-synthane ', 'synthyl', 'synth-yl'] }],
      }),
    );

    expect(item.questionType).toBe('fill_in_multiple_blanks_question');
    expect(item.blanks).toEqual([{ id: 'x1', answers: ['synthane', 'synth ane', '1-synthane', 'synthyl', 'synth-yl'] }]);
    expect(item.choices).toEqual([]);
    expect(item.correctChoiceIdents).toEqual([]);
  });

  test('reads one blank per response_lid and falls back to the lid label for the blank id', () => {
    const xml = fimbItem({
      ident: 'gfimb2',
      blanks: [
        { id: 'first', answers: ['alpha'] },
        { id: 'second', answers: ['beta', 'gamma'] },
      ],
    }).replace('ident="response_second"', 'ident="lid2"');
    const item = parseItem(xml);

    expect(item.blanks).toEqual([
      { id: 'first', answers: ['alpha'] },
      { id: 'second', answers: ['beta', 'gamma'] },
    ]);
  });

  test('keeps only the scored option of each dropdown', () => {
    const item = parseItem(
      fimbItem({
        ident: 'gdrop',
        type: 'multiple_dropdowns_question',
        blanks: [
          { id: 'A', answers: ['Acid', 'Base', 'Salt'], correct: 1 },
          { id: 'B', answers: ['Acid', 'Base', 'Salt'], correct: 2 },
        ],
      }),
    );

    expect(item.blanks).toEqual([
      { id: 'A', answers: ['Base'] },
      { id: 'B', answers: ['Salt'] },
    ]);
  });

  test('matches dropdown scoring to its blank when blanks reuse option idents', () => {
    const options = [
      { ident: '1', text: 'Acid' },
      { ident: '2', text: 'Base' },
    ];
    const item = parseItem(
      fimbItem({
        ident: 'gdropshared',
        type: 'multiple_dropdowns_question',
        blanks: [
          { id: 'A', answers: options, correct: 0 },
          { id: 'B', answers: options, correct: 1 },
        ],
      }),
    );

    expect(item.blanks).toEqual([
      { id: 'A', answers: ['Acid'] },
      { id: 'B', answers: ['Base'] },
    ]);
  });

  test('skips answers negated at any depth and reads the others wherever they sit', () => {
    const xml = shortAnswerItem({ ident: 'gnested', answers: ['PLACEHOLDER'] }).replace(
      '<varequal respident="response1">PLACEHOLDER</varequal>',
      '<or><and><not><or><varequal respident="response1">negated</varequal></or></not>'
        + '<varequal respident="response1">kept</varequal></and><not/>'
        + '<varequal respident="response1">also kept</varequal></or>',
    );
    expect(parseItem(xml).shortAnswers).toEqual(['kept', 'also kept']);
  });

  test('reads every short-answer varequal in the scoring condition', () => {
    const item = parseItem(
      shortAnswerItem({ ident: 'gshort', answers: ['synthane', 'Synthane ', 'synth-ane'], generalFeedback: { correct: '<p>Yes.</p>' } }),
    );

    expect(item.questionType).toBe('short_answer_question');
    expect(item.shortAnswers).toEqual(['synthane', 'Synthane', 'synth-ane']);
    expect(item.feedbackHtml.correct).toBe('<p>Yes.</p>');
    expect(item.rawWarnings).toEqual([]);
  });

  test('reads the type and stem of unsupported types and a null type when it is missing', () => {
    const essay = parseItem(otherItem({ ident: 'gessay', type: 'essay_question' }));
    expect(essay.questionType).toBe('essay_question');
    expect(essay.stemHtml).toBe('<div>\n<p>Explain the synthetic result.</p>\n</div>');
    expect(essay.numericAnswers).toEqual([]);
    expect(essay.shortAnswers).toEqual([]);

    const untyped = otherItem({ ident: 'guntyped', type: 'text_only_question' }).replace(
      /<qtimetadatafield>\s*<fieldlabel>question_type<\/fieldlabel>[\s\S]*?<\/qtimetadatafield>/,
      '',
    );
    expect(parseItem(untyped).questionType).toBeNull();
  });

  test('reads points as a number, or null when Canvas left them blank', () => {
    expect(parseItem(mcItem({ ident: 'gp0', points: 0 })).pointsPossible).toBe(0);
    expect(parseItem(mcItem({ ident: 'gpx', points: '' })).pointsPossible).toBeNull();
  });
});

describe('parseCanvasQuiz: assessment_meta.xml', () => {
  test('reads the quiz settings from the direct children of <quiz>, not the nested assignment', () => {
    const quiz = parse([], {
      meta: {
        title: 'Assignment 02',
        description: '<p>Bring a ruler.&nbsp;<a href="$IMS-CC-FILEBASE$/Canvas_Quizzes/sheet.pdf">data sheet</a></p>',
        shuffleAnswers: false,
        cantGoBack: true,
        timeLimit: 45,
        dueAt: '2030-03-04T07:59:00',
        unlockAt: '2030-02-18T21:00:00',
        lockAt: '2030-03-05T07:59:00',
        assignment: { title: 'Assignment title', dueAt: '2030-01-01T00:00:00' },
      },
    });

    expect(quiz.title).toBe('Assignment 02');
    expect(quiz.meta).toEqual({
      description: '<p>Bring a ruler.&nbsp;<a href="$IMS-CC-FILEBASE$/Canvas_Quizzes/sheet.pdf">data sheet</a></p>',
      shuffleAnswers: false,
      cantGoBack: true,
      timeLimitMinutes: 45,
      dueAt: '2030-03-04T07:59:00',
      unlockAt: '2030-02-18T21:00:00',
      lockAt: '2030-03-05T07:59:00',
    });
  });

  test('leaves settings Canvas did not write unset', () => {
    const quiz = parse([], { meta: { shuffleAnswers: null, assignment: { dueAt: '2030-01-01T00:00:00' } } });

    expect(quiz.meta).toEqual({
      description: '<p>Synthetic instructions.</p>',
      shuffleAnswers: null,
      cantGoBack: false,
      timeLimitMinutes: null,
      dueAt: null,
      unlockAt: null,
      lockAt: null,
    });
  });

  test('reads New Quizzes empty date elements as null', () => {
    const quiz = parse([], { meta: { newQuizzes: true, dueAt: '2030-09-10T19:00:00Z', timeLimit: 30 } });

    expect(quiz.meta).toMatchObject({ dueAt: '2030-09-10T19:00:00Z', unlockAt: null, lockAt: null, timeLimitMinutes: 30 });
  });

  test('falls back to the assessment title and default settings without a meta file', () => {
    const quiz = parseCanvasQuiz({ ident: QUIZ, xml: quizXml({ title: 'From the assessment', slots: [] }), metaXml: null });

    expect(quiz.title).toBe('From the assessment');
    expect(quiz.meta).toEqual({
      description: '',
      shuffleAnswers: null,
      cantGoBack: false,
      timeLimitMinutes: null,
      dueAt: null,
      unlockAt: null,
      lockAt: null,
    });
  });

  test('names a quiz with no title anywhere "Untitled quiz"', () => {
    const quiz = parseCanvasQuiz({ ident: QUIZ, xml: quizXml({ title: '', slots: [] }), metaXml: '<notquiz/>' });
    expect(quiz.title).toBe('Untitled quiz');
  });
});

describe('parseCanvasQuiz: New Quizzes', () => {
  test('detects a New Quizzes export from external_assignment_id and tolerates its XML declaration', () => {
    const xml = quizXml({
      newQuizzes: true,
      timeLimit: 30,
      slots: [
        // No calculator_type here, so only the assessment attribute can mark the flavour.
        mcItem({ ident: '0a1b2c3d4e5f60718293a4b5c6d7e8f9', title: '', shuffle: true }),
        numericalItem({ ident: 'f9e8d7c6b5a4938271605f4e3d2c1b0a', title: '', answers: [{ exact: '19', min: '19', max: '19' }] }),
      ],
    });
    expect(xml.startsWith('<?xml version="1.0"?>\n')).toBe(true);
    const quiz = parseCanvasQuiz({ ident: QUIZ, xml, metaXml: metaXml({ newQuizzes: true }) });

    expect(quiz.flavour).toBe('new-quizzes');
    expect(quiz.slots.map((slot) => slot.kind)).toEqual(['item', 'item']);
    expect(quiz.slots[0].item.title).toBe('');
    expect(quiz.slots[0].item.correctChoiceIdents).toEqual(['1001']);
    expect(quiz.slots[1].item.numericAnswers).toEqual([{ exact: '19', min: '19', max: '19' }]);
  });

  test('detects New Quizzes from an item calculator_type alone', () => {
    const quiz = parse([mcItem({ ident: 'gcalcflag', calculatorType: 'none' })]);
    expect(quiz.flavour).toBe('new-quizzes');
  });
});

describe('parseCanvasQuiz: damaged input', () => {
  const meta = metaXml({ ident: QUIZ, title: 'Assignment 03' });
  const good = quizXml({ ident: QUIZ, slots: [mcItem({ ident: 'gok' })] });

  test('strips a UTF-8 byte-order mark', () => {
    const quiz = parseCanvasQuiz({ ident: QUIZ, xml: `﻿${good}`, metaXml: `﻿${meta}` });
    expect(quiz.title).toBe('Assignment 03');
    expect(quiz.slots[0].item.ident).toBe('gok');
  });

  test.each([
    ['cut short', good.slice(0, good.indexOf('</resprocessing>')), '<resprocessing> is never closed; the file may be cut short'],
    ['mismatched tags', good.replace('</presentation>', '</material>'), '</material> does not close <presentation>'],
    ['a stray close tag', `${good}</extra>`, '</extra> has no opening tag'],
    ['a raw "<" in text', good.replace('<fieldentry>1.0</fieldentry>', '<fieldentry>1 < 2</fieldentry>'), 'a "<" that does not start a valid tag'],
    ['an unclosed comment', good.replace('<section ident="root_section">', '<!-- note <section ident="root_section">'), 'unclosed comment'],
    ['a DTD with entities', good.replace('<questestinterop', '<!DOCTYPE q [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]>\n<questestinterop'), 'DTD declarations are not allowed'],
    ['no XML at all', 'This is not XML.', 'there are no XML elements'],
  ])('rejects a quiz file with %s as BAD_XML naming the quiz', (_label, xml, detail) => {
    const err = badXmlError(() => parseCanvasQuiz({ ident: QUIZ, xml, metaXml: meta }));

    expect(err).toBeInstanceOf(CanvasImportError);
    expect(err.code).toBe('BAD_XML');
    expect(err.status).toBe(400);
    expect(err.message).toContain('The Canvas quiz "Assignment 03" could not be read');
    expect(err.message).toContain(detail);
  });

  test('gives the line of the problem', () => {
    const lines = good.split('\n');
    const at = lines.findIndex((line) => line.includes('</presentation>'));
    const err = badXmlError(() =>
      parseCanvasQuiz({ ident: QUIZ, xml: good.replace('</presentation>', '</material>'), metaXml: meta }));
    expect(err.message).toContain(`line ${at + 1}: </material> does not close <presentation>`);
  });

  test('rejects well-formed XML that has no assessment, naming the quiz by ident without meta', () => {
    const err = badXmlError(() =>
      parseCanvasQuiz({ ident: QUIZ, xml: '<?xml version="1.0"?>\n<questestinterop><objectbank ident="b"/></questestinterop>', metaXml: null }));

    expect(err).toBeInstanceOf(CanvasImportError);
    expect(err.code).toBe('BAD_XML');
    expect(err.message).toBe(
      `The Canvas quiz "${QUIZ}" could not be read: its quiz file has no assessment in it. Export the quiz from Canvas again and re-upload it.`,
    );
  });

  test('rejects an empty quiz file', () => {
    const err = badXmlError(() => parseCanvasQuiz({ ident: QUIZ, xml: '  ', metaXml: meta }));
    expect(err.code).toBe('BAD_XML');
    expect(err.message).toContain('its quiz file is empty');
  });

  test('reads a damaged meta file leniently instead of failing the quiz', () => {
    const quiz = parseCanvasQuiz({ ident: QUIZ, xml: good, metaXml: meta.slice(0, meta.indexOf('<scoring_policy>')) });
    expect(quiz.title).toBe('Assignment 03');
    expect(quiz.meta.shuffleAnswers).toBe(true);
  });

  // The structure check cannot vouch for a damaged file, so only one too small
  // to nest deeply is read; Canvas writes about 70 elements.
  test('reads a meta file with more elements than Canvas writes only when it is undamaged', () => {
    const big = meta.replace('<scoring_policy>', `${'<extra/>'.repeat(2 * MAX_XML_DEPTH)}<scoring_policy>`);
    expect(parseCanvasQuiz({ ident: QUIZ, xml: good, metaXml: big }).title).toBe('Assignment 03');

    const damaged = parseCanvasQuiz({ ident: QUIZ, xml: good, metaXml: big.slice(0, big.lastIndexOf('<scoring_policy>')) });
    expect(damaged.title).toBe('Synthetic Quiz');
    expect(damaged.meta.shuffleAnswers).toBeNull();
  });

  // It used to overflow the call stack, and htmlparser2 alone spends minutes on
  // a few MB of such nesting.
  test('ignores a meta file nested 20,000 deep, as if it were missing', () => {
    const deep = `${'<x>'.repeat(20000)}${meta.replace(/^<\?xml[^>]*\?>\n/, '')}${'</x>'.repeat(20000)}`;

    const started = performance.now();
    const quiz = parseCanvasQuiz({ ident: QUIZ, xml: good, metaXml: deep });
    const elapsed = performance.now() - started;

    expect(quiz.title).toBe('Synthetic Quiz');
    expect(quiz.meta).toEqual({
      description: '',
      shuffleAnswers: null,
      cantGoBack: false,
      timeLimitMinutes: null,
      dueAt: null,
      unlockAt: null,
      lockAt: null,
    });
    expect(elapsed).toBeLessThan(10000);
  });
});

describe('parseCanvasQuiz: nesting Canvas never writes', () => {
  const nested = (count, name = 'span') => `${`<${name}>`.repeat(count)}x${`</${name}>`.repeat(count)}`;
  // Raw child elements in a stem's mattext are read back as HTML and add to
  // the file's depth.
  const withStem = (inner) => mcItem({ ident: 'gstem', stemHtml: 'PLACEHOLDER' }).replace(
    '<mattext texttype="text/html">PLACEHOLDER</mattext>',
    `<mattext texttype="text/html">${inner}</mattext>`,
  );

  function expectRefused(slots, detail) {
    const started = performance.now();
    const err = badXmlError(() => parse(slots));
    const elapsed = performance.now() - started;

    expect(err).toBeInstanceOf(CanvasImportError);
    expect(err.code).toBe('BAD_XML');
    expect(err.message).toContain('The Canvas quiz "Synthetic Quiz" could not be read: its quiz file is not valid XML');
    expect(err.message).toContain(detail);
    expect(elapsed).toBeLessThan(10000);
  }

  test('reads markup nested exactly 100 elements deep and refuses one level more', () => {
    expect(MAX_XML_DEPTH).toBe(100);
    // questestinterop > assessment > section > item > presentation > material > mattext
    const spans = MAX_XML_DEPTH - 7;
    expect(parseItem(withStem(nested(spans))).stemHtml).toBe(nested(spans));
    expectRefused([withStem(nested(spans + 1))], '<span> is nested more than 100 elements deep');
  });

  // The first used to overflow the call stack (a RangeError, which the route
  // reports as a generic 500). The second took 3.5 s: every test walked up
  // through all 4,000 levels looking for a <not>.
  test.each([
    ['20,000 nested elements in a stem', () => withStem(nested(20000, 'a')), '<a> is nested more than 100'],
    [
      '4,000 nested <and>s around 100,000 answers',
      () => shortAnswerItem({ ident: 'gdeep', answers: ['PLACEHOLDER'] }).replace(
        '<varequal respident="response1">PLACEHOLDER</varequal>',
        nested(4000, 'and').replace('x', Array.from({ length: 100000 }, (_, i) => `<varequal>${i}</varequal>`).join('')),
      ),
      '<and> is nested more than 100',
    ],
  ])('refuses %s as BAD_XML quickly', (_label, item, detail) => {
    expectRefused([item()], detail);
  });

  // The structure check has to see the tags htmlparser2 sees. With each of
  // these it used to see a balanced file, while htmlparser2 nested 20,000
  // elements (to it, `<a\u00a0b="1">` is a tag named `a\u00a0b="1"`, which
  // `</a>` does not close) and the parser overflowed the call stack.
  test.each([
    ['a no-break space inside a tag', '<a\u00a0b="1"></a>'.repeat(20000), 'a "<" that does not start a valid tag'],
    ['a vertical tab inside a tag', '<a\u000bb="1"></a>'.repeat(20000), 'a "<" that does not start a valid tag'],
    ['a ">" in a processing instruction', `<?x >${'<a>'.repeat(20000)}?>`, '<a> is nested more than 100'],
    ['the empty comment "<!-->"', `<!-->${'<a>'.repeat(20000)}-->`, '<a> is nested more than 100'],
    ['the declaration "<!>"', '<a><!></a>'.repeat(20000), '<a> is nested more than 100'],
    ['the declaration "<!->"', '<a><!-></a>'.repeat(20000), '<a> is nested more than 100'],
  ])('refuses nesting hidden behind %s', (_label, inner, detail) => {
    expectRefused([withStem(inner)], detail);
  });

  // Each of these is read one at a time, walking its own subtree, so nesting
  // them repeated the work (and the text) once per level: 85 options nested
  // around one 1,000,000-element answer (a 3.8 MB file) took 15 s and returned
  // 324 MB of text.
  test.each([
    ['item', (xml) => xml.replace('<presentation>', `<presentation>${mcItem({ ident: 'ginner' })}`)],
    ['itemmetadata', (xml) => xml.replace('<qtimetadata>', '<qtimetadata><itemmetadata/>')],
    ['qtimetadatafield', (xml) => xml.replace('<fieldentry>1.0</fieldentry>', '<fieldentry>1.0<qtimetadatafield/></fieldentry>')],
    ['fieldlabel', (xml) => xml.replace('<fieldlabel>points_possible</fieldlabel>', '<fieldlabel>points_possible<fieldlabel/></fieldlabel>')],
    ['response_lid', (xml) => xml.replace('<render_choice>', '<render_choice><response_lid ident="inner"/>')],
    ['response_label', (xml) => xml.replace('<response_label ident="1002">', '<response_label ident="1002"><response_label ident="inner"/>')],
    ['varequal', (xml) => xml.replace('>1001</varequal>', '>1001<varequal/></varequal>')],
  ])('refuses a <%s> inside another one', (name, nest) => {
    const xml = nest(mcItem({ ident: 'gouter' }));
    expect(xml).not.toBe(mcItem({ ident: 'gouter' }));
    expectRefused([xml], `<${name}> is inside another <${name}>`);
  });
});

describe('parseCanvasQuiz: big questions are read in linear time', () => {
  // Each of these used to cost work that grew with the square of the question
  // (5 s to 40 s here), on every preview and commit. Now each parse takes a few
  // hundred ms. All stay under the 20 MB quiz file limit.
  const MB20 = 20 * 1024 * 1024;
  const range = (count) => Array.from({ length: count }, (_, i) => String(i));

  function timedItem(itemXml) {
    const xml = quizXml({ ident: QUIZ, slots: [itemXml] });
    expect(xml.length).toBeLessThan(MB20);
    const started = performance.now();
    const quiz = parseCanvasQuiz({ ident: QUIZ, xml, metaXml: null });
    return { item: quiz.slots[0].item, elapsed: performance.now() - started };
  }

  const varequal = (id) => `<varequal respident="response1">${id}</varequal>`;

  // The real MC shape with `count` bare options in place of its only one, ONLY.
  function wideMcItem(ident, count, answerFeedback = {}) {
    return mcItem({ ident, choices: [{ ident: 'ONLY', text: 'x' }], correct: 'ONLY', answerFeedback }).replace(
      /<response_label ident="ONLY">[\s\S]*?<\/response_label>/,
      range(count).map((id) => `<response_label ident="${id}"/>`).join(''),
    );
  }

  test('reads a 16,000-blank dropdown question quickly', () => {
    const blanks = range(16000).map((i) => ({ id: `b${i}`, answers: [`Option ${i}`] }));
    const { item, elapsed } = timedItem(fimbItem({ ident: 'gdrops', type: 'multiple_dropdowns_question', blanks }));

    expect(item.blanks).toEqual(blanks);
    expect(elapsed).toBeLessThan(10000);
  });

  test('reads a 200,000-option question with every option scored quickly', () => {
    // One scoring condition naming every option.
    const { item, elapsed } = timedItem(
      wideMcItem('gwide', 200000).replace(varequal('ONLY'), range(200000).map(varequal).join('')),
    );

    expect(item.choices).toHaveLength(200000);
    expect(item.correctChoiceIdents).toEqual(range(200000));
    expect(item.rawWarnings).toEqual([]);
    expect(elapsed).toBeLessThan(10000);
  });

  test('matches one answer comment naming each of 200,000 options quickly', () => {
    // Option 0 is the correct one; the comment's condition names every option.
    const { item, elapsed } = timedItem(
      wideMcItem('gcomments', 200000, { ONLY: '<p>Comment.</p>' })
        .replace(
          /<conditionvar>\s*<varequal respident="response1">ONLY<\/varequal>\s*<\/conditionvar>\s*<displayfeedback/,
          `<conditionvar>${range(200000).map(varequal).join('')}</conditionvar><displayfeedback`,
        )
        .replace(varequal('ONLY'), varequal('0')),
    );

    expect(item.correctChoiceIdents).toEqual(['0']);
    expect(item.choiceFeedbackHtml).toEqual(Object.fromEntries(range(200000).map((id) => [id, '<p>Comment.</p>'])));
    expect(item.rawWarnings).toEqual([]);
    expect(elapsed).toBeLessThan(10000);
  });

  test('tells 150,000 scoring conditions from 150,000 other conditions quickly', () => {
    const { item, elapsed } = timedItem(
      wideMcItem('gconditions', 4).replace(
        '<respcondition continue="No">',
        `${'<respcondition continue="Yes"/>'.repeat(150000)}${'<respcondition continue="No"><setvar>100</setvar></respcondition>'.repeat(150000)}<respcondition continue="No">`,
      ).replace(varequal('ONLY'), varequal('0')),
    );

    expect(item.choices.map((choice) => choice.ident)).toEqual(['0', '1', '2', '3']);
    expect(item.correctChoiceIdents).toEqual(['0']);
    expect(item.rawWarnings).toEqual([]);
    expect(elapsed).toBeLessThan(10000);
  });
});

describe('parseCanvasQuiz: per-quiz caps', () => {
  // Bare elements keep these quizzes small; one parse costs milliseconds.
  const emptyGroup = (n) => `<section ident="ggroup${n}" title="G"/>`;
  const bareItem = (n) => `<item ident="gitem${n}" title="Q"/>`;
  const many = (count, build, from = 1) => Array.from({ length: count }, (_, i) => build(from + i));
  const group = (ident, items) => groupSection({ ident, title: 'G', items });

  function expectTooMany(slots, cap) {
    const err = badXmlError(() => parse(slots));
    expect(err).toBeInstanceOf(CanvasImportError);
    expect({ code: err.code, status: err.status, message: err.message }).toEqual({
      code: 'TOO_LARGE',
      status: 413,
      message: `This quiz has more than ${cap} questions or groups, which is too many to import.`,
    });
  }

  test('are 2000 slots and 5000 questions', () => {
    expect([MAX_SLOTS_PER_QUIZ, MAX_ITEMS_PER_QUIZ]).toEqual([2000, 5000]);
  });

  test('reads a quiz of exactly 2000 slots holding exactly 5000 questions', () => {
    const quiz = parse([...many(1999, emptyGroup), group('gbig', many(5000, bareItem))]);

    expect(quiz.slots).toHaveLength(2000);
    expect(quiz.slots[1999].items).toHaveLength(5000);
  });

  test.each([
    ['2001 groups', () => many(2001, emptyGroup)],
    ['2000 groups and a standalone question', () => [...many(2000, emptyGroup), bareItem(1)]],
    ['2001 standalone questions', () => many(2001, bareItem)],
  ])('refuses %s as more than 2000 slots', (_label, slots) => {
    expectTooMany(slots(), 2000);
  });

  test.each([
    ['5001 questions in one group', () => [group('gbig', many(5001, bareItem))]],
    ['a standalone question and 5000 in a group', () => [bareItem(1), group('gbig', many(5000, bareItem, 2))]],
    ['questions in a nested section', () => [group('gouter', [...many(4000, bareItem), group('ginner', many(1001, bareItem, 4001))])]],
  ])('refuses %s as more than 5000 questions', (_label, slots) => {
    expectTooMany(slots(), 5000);
  });
});

describe('CANVAS_QUESTION_TYPES', () => {
  test('names the Canvas Classic question types', () => {
    expect(CANVAS_QUESTION_TYPES).toEqual({
      MULTIPLE_CHOICE: 'multiple_choice_question',
      TRUE_FALSE: 'true_false_question',
      MULTIPLE_ANSWERS: 'multiple_answers_question',
      NUMERICAL: 'numerical_question',
      CALCULATED: 'calculated_question',
      FILL_IN_MULTIPLE_BLANKS: 'fill_in_multiple_blanks_question',
      MULTIPLE_DROPDOWNS: 'multiple_dropdowns_question',
      SHORT_ANSWER: 'short_answer_question',
      MATCHING: 'matching_question',
      ESSAY: 'essay_question',
      FILE_UPLOAD: 'file_upload_question',
      TEXT_ONLY: 'text_only_question',
    });
    expect(Object.isFrozen(CANVAS_QUESTION_TYPES)).toBe(true);
  });
});
