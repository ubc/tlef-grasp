// The speed tests below catch quadratic blow-ups (old code took 20-40 s);
// their limits leave room for slow, coverage-instrumented CI runners.
jest.setTimeout(30000);

/**
 * Canvas quiz mapper (utils/canvas-qti-map.js, #140): parsed Canvas Classic
 * quizzes -> GRASP question drafts, slots, names and skip reasons.
 *
 * Inputs are built the real way: the fixture builders write Canvas-shaped QTI
 * and the real parser reads it, so every test goes through the same path an
 * upload does. Numerical drafts are checked against the CalculationQuestion
 * rules saveQuestion runs, and the displayed answer a student would see.
 */

const {
  mapCanvasQuizzes,
  compareQuizCreationOrder,
} = require('../../src/utils/canvas-qti-map');
const { parseCanvasQuiz } = require('../../src/utils/canvas-qti-parse');
const CalculationQuestion = require('../../src/models/questions/CalculationQuestion');
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
const REMOTE = 'https://canvas.example.test/assessment_questions/11/files/22/download?verifier=synthetic22';
const REMOTE_2 = 'https://canvas.example.test/assessment_questions/11/files/23/download?verifier=synthetic23';
const BUNDLED = '$IMS-CC-FILEBASE$/assessment_questions/synthetic.png?canvas_download=1';

function quizOf(slots, { ident = QUIZ, title = 'Synthetic Quiz', meta = {}, newQuizzes = false } = {}) {
  return parseCanvasQuiz({
    ident,
    xml: quizXml({ ident, title, slots, newQuizzes }),
    metaXml: metaXml({ ident, title, newQuizzes, ...meta }),
  });
}

function mapSlots(slots, options) {
  return mapCanvasQuizzes([quizOf(slots, options)])[0];
}

// The one draft of a quiz holding a single standalone item.
function onlyDraft(itemXml, options) {
  const quiz = mapSlots([itemXml], options);
  expect(quiz.skipped).toEqual([]);
  return quiz.slots[0].questions[0];
}

function onlySkip(itemXml, options) {
  const quiz = mapSlots([itemXml], options);
  expect(quiz.slots[0].questions).toEqual([]);
  return quiz.slots[0].skipped[0];
}

const choices = (texts) => texts.map((text, i) => ({ ident: String(1001 + i), text }));
const htmlChoices = (htmls) => htmls.map((html, i) => ({ ident: String(1001 + i), html }));
const NO_SHUFFLE = { meta: { shuffleAnswers: false } };

describe('mapCanvasQuizzes: slots, names and provenance', () => {
  test('makes one slot per group and per standalone item, named after the quiz', () => {
    const quiz = mapSlots([
      groupSection({ ident: 'ggroup1', title: 'Q01', items: [mcItem({ ident: 'gitem1' }), mcItem({ ident: 'gitem2' })] }),
      mcItem({ ident: 'gitem3' }),
      groupSection({ ident: 'ggroup3', title: '  ', items: [mcItem({ ident: 'gitem4' })] }),
      groupSection({ ident: 'ggroup4', title: 'q01', items: [mcItem({ ident: 'gitem5' })] }),
      groupSection({ ident: 'ggroup5', title: 'Rate   laws', items: [mcItem({ ident: 'gitem6' })] }),
    ]);

    expect(quiz.slots.map(({ ident, position, name }) => ({ ident, position, name }))).toEqual([
      { ident: 'ggroup1', position: 1, name: 'Synthetic Quiz – Q01' },
      { ident: 'gitem3', position: 2, name: 'Synthetic Quiz – Question 2' },
      { ident: 'ggroup3', position: 3, name: 'Synthetic Quiz – Q03' },
      // Names are unique ignoring case, as the service compares them.
      { ident: 'ggroup4', position: 4, name: 'Synthetic Quiz – q01 (2)' },
      { ident: 'ggroup5', position: 5, name: 'Synthetic Quiz – Rate laws' },
    ]);
    expect(quiz.slots[0].questions.map((q) => [q.itemIdent, q.slotIdent])).toEqual([
      ['gitem1', 'ggroup1'],
      ['gitem2', 'ggroup1'],
    ]);
    expect(quiz.slots[1].questions[0].source).toEqual({
      kind: 'canvas-classic',
      quizIdent: QUIZ,
      itemIdent: 'gitem3',
      slotIdent: 'gitem3',
    });
    expect(quiz.slots[0].questions[1].source).toEqual({
      kind: 'canvas-classic',
      quizIdent: QUIZ,
      itemIdent: 'gitem2',
      slotIdent: 'ggroup1',
    });
  });

  test('makes quiz titles unique across the file and names slots after the unique title', () => {
    const quizzes = mapCanvasQuizzes([
      quizOf([groupSection({ ident: 'ga', title: 'Q01', items: [mcItem({ ident: 'ga1' })] })], { ident: 'gq1', title: 'Unit Quiz' }),
      quizOf([groupSection({ ident: 'gb', title: 'Q01', items: [mcItem({ ident: 'gb1' })] })], { ident: 'gq2', title: 'unit quiz' }),
      quizOf([mcItem({ ident: 'gc1' })], { ident: 'gq3', title: '  Unit   Quiz ' }),
    ]);

    expect(quizzes.map((quiz) => [quiz.ident, quiz.title, quiz.quizSettings.name])).toEqual([
      ['gq1', 'Unit Quiz', 'Unit Quiz'],
      ['gq2', 'unit quiz (2)', 'unit quiz (2)'],
      ['gq3', 'Unit Quiz (3)', 'Unit Quiz (3)'],
    ]);
    expect(quizzes.map((quiz) => quiz.slots[0].name)).toEqual([
      'Unit Quiz – Q01',
      'unit quiz (2) – Q01',
      'Unit Quiz (3) – Question 1',
    ]);
  });

  test('returns an empty list for anything that is not an array', () => {
    expect(mapCanvasQuizzes(null)).toEqual([]);
    expect(mapCanvasQuizzes({ slots: [] })).toEqual([]);
  });

  test('numbers repeated slot names past a group whose own title already took a number', () => {
    const quiz = mapSlots(['G', 'G (3)', 'G', 'G', 'g', 'G (3)'].map((title, i) =>
      groupSection({ ident: `gdup${i}`, title, items: [mcItem({ ident: `gdupitem${i}` })] })));

    expect(quiz.slots.map((slot) => slot.name)).toEqual([
      'Synthetic Quiz – G',
      'Synthetic Quiz – G (3)',
      'Synthetic Quiz – G (2)',
      'Synthetic Quiz – G (4)',
      'Synthetic Quiz – g (5)',
      'Synthetic Quiz – G (3) (2)',
    ]);
  });

  // A slot name used to cost one probe per earlier slot with the same title,
  // so a small upload could block the server for minutes. Built from one
  // parsed group so only the mapper is timed.
  test('names 20,000 groups that share a title in well under two seconds', () => {
    const parsed = quizOf([groupSection({ ident: 'gsame', title: 'G' })]);
    const slots = Array.from({ length: 20000 }, (_, i) => ({ ...parsed.slots[0], ident: `gsame${i}` }));

    const start = performance.now();
    const [quiz] = mapCanvasQuizzes([{ ...parsed, slots }]);
    const elapsed = performance.now() - start;

    expect(quiz.slots.slice(0, 3).map((slot) => slot.name)).toEqual([
      'Synthetic Quiz – G',
      'Synthetic Quiz – G (2)',
      'Synthetic Quiz – G (3)',
    ]);
    expect(quiz.slots[19999].name).toBe('Synthetic Quiz – G (20000)');
    expect(elapsed).toBeLessThan(10000);
  });

  test('titles 20,000 quizzes that share a title in well under two seconds', () => {
    const parsed = quizOf([]);
    const quizzes = Array.from({ length: 20000 }, (_, i) => ({ ...parsed, ident: `gsamequiz${i}` }));

    const start = performance.now();
    const mapped = mapCanvasQuizzes(quizzes);
    const elapsed = performance.now() - start;

    expect(mapped.slice(0, 2).map((quiz) => quiz.title)).toEqual(['Synthetic Quiz', 'Synthetic Quiz (2)']);
    expect(mapped[19999].title).toBe('Synthetic Quiz (20000)');
    expect(elapsed).toBeLessThan(10000);
  });
});

describe('mapCanvasQuizzes: [SMILES] tags in Canvas text', () => {
  // RichText draws [SMILES]...[/SMILES] as a <canvas> and trusts its content.
  // Imported text keeps the characters but breaks the tag with U+200B.
  const TAG = '[SMILES]CCO[/SMILES]';
  const BROKEN = '[\u200BSMILES]CCO[\u200B/SMILES]';
  const LOWER_TAG = '[smiles]C=O[/Smiles]';
  const LOWER_BROKEN = '[\u200Bsmiles]C=O[\u200B/Smiles]';

  test('breaks the tag in quiz titles, slot names, notes, question titles and skipped titles', () => {
    const quiz = mapSlots([
      groupSection({
        ident: 'gsmiles',
        title: `Group ${LOWER_TAG}`,
        pick: 2,
        items: [
          numericalItem({ ident: 'gsmnum1', title: `Check ${TAG}`, answers: [{ exact: '2' }] }),
          numericalItem({ ident: 'gsmnum2', title: 'Question', answers: [{ exact: '3' }] }),
          otherItem({ ident: 'gsmmatch', title: `Matching ${TAG}`, type: 'matching_question' }),
        ],
      }),
    ], { title: `Unit ${TAG}` });
    const slotName = `Unit ${BROKEN} – Group ${LOWER_BROKEN}`;

    expect(quiz.title).toBe(`Unit ${BROKEN}`);
    expect(quiz.quizSettings.name).toBe(`Unit ${BROKEN}`);
    expect(quiz.slots[0].name).toBe(slotName);
    expect(quiz.slots[0].questions.map((question) => question.payload.title)).toEqual([`Check ${BROKEN}`, slotName]);
    expect(quiz.skipped).toEqual([{
      itemIdent: 'gsmmatch',
      slotName,
      itemTitle: `Matching ${BROKEN}`,
      canvasType: 'matching_question',
      reason: "Matching questions aren't supported in GRASP.",
    }]);
    expect(quiz.notes).toEqual([`Canvas picked 2 questions from 'Group ${LOWER_BROKEN}'; GRASP gives one question per objective.`]);
  });

  test('breaks the tag in fill-in titles and accepted answers', () => {
    const fimb = onlyDraft(fimbItem({
      ident: 'gsmfimb',
      title: `Blank ${TAG}`,
      stemHtml: '<div>Write [x1].</div>',
      blanks: [{ id: 'x1', answers: [TAG, ` ${LOWER_TAG} `] }],
    }));
    const short = onlyDraft(shortAnswerItem({ ident: 'gsmshort', answers: [`${LOWER_TAG} ether`] }));

    expect(fimb.payload.title).toBe(`Blank ${BROKEN}`);
    expect(fimb.payload.correctAnswer).toBe(BROKEN);
    expect(fimb.payload.acceptableAnswers).toEqual([BROKEN, LOWER_BROKEN]);
    expect(short.payload.correctAnswer).toBe(`${LOWER_BROKEN} ether`);
    expect(short.payload.acceptableAnswers).toEqual([`${LOWER_BROKEN} ether`]);
  });

  test('still finds a blank named "smiles" after the stem has its tags broken', () => {
    const draft = onlyDraft(fimbItem({
      ident: 'gsmblank',
      stemHtml: '<div>Write the code for the synthetic compound: [smiles].</div>',
      blanks: [{ id: 'smiles', answers: ['CCO'] }],
    }));

    expect(draft.payload.stem).toBe('Write the code for the synthetic compound: _________.');
    expect(draft.warnings).toEqual([]);
  });

  test('breaks the tag in image alt texts and captions', () => {
    const src = '$IMS-CC-FILEBASE$/grasp/aaaaaaaaaaaaaaaaaaaaaaa2-ring.png';
    const draft = onlyDraft(mcItem({
      ident: 'gsmalt',
      stemHtml: `<div><p>Which ring?</p><p><img src="${src}" alt="Ring ${TAG}"></p><p><em>Ring ${TAG}</em></p>`
        + `<p><img src="${BUNDLED}" alt="Chain ${LOWER_TAG}"></p></div>`,
      choices: htmlChoices([`<p><img src="${REMOTE}" alt="Option ${TAG}"></p>`, '<p>Bravo</p>']),
    }), NO_SHUFFLE);

    expect(draft.stemImages).toEqual([
      { src, kind: 'bundled', caption: `Image 1: Ring ${BROKEN}`, altText: `Ring ${BROKEN}` },
      { src: BUNDLED, kind: 'bundled', caption: 'Image 2', altText: `Chain ${LOWER_BROKEN}` },
    ]);
    expect(draft.optionImages).toEqual({ A: { src: REMOTE, kind: 'remote', caption: `Option ${BROKEN}` } });
  });

  test('keeps the tag broken in converted text: prompt, options, feedback and description', () => {
    const quiz = mapSlots([mcItem({
      ident: 'gsmconv',
      stemHtml: `<div><p>Draw ${TAG}</p></div>`,
      choices: choices([`Ethanol ${LOWER_TAG}`, 'Bravo']),
      answerFeedback: { 1001: `<p>See ${TAG}</p>` },
      generalFeedback: { general: `<p>Also ${LOWER_TAG}</p>` },
    })], { meta: { shuffleAnswers: false, description: `<p>Read ${TAG}</p>` } });
    const { payload } = quiz.slots[0].questions[0];

    expect(payload.title).toBe(`Draw ${BROKEN}`);
    expect(payload.options).toEqual({
      A: { text: `Ethanol ${LOWER_BROKEN}`, feedback: `See ${BROKEN}\n\nAlso ${LOWER_BROKEN}` },
      B: { text: 'Bravo', feedback: `Also ${LOWER_BROKEN}` },
    });
    expect(quiz.quizSettings.description).toBe(`Read ${BROKEN}`);
  });
});

describe('mapCanvasQuizzes: quiz settings and creation order', () => {
  test('takes the GRASP quiz settings from assessment_meta', () => {
    const quiz = mapSlots([mcItem({ ident: 'gitem1' })], {
      meta: {
        description: '<p>Read <strong>every</strong> question.</p><p>Bring $5 or $6.</p>',
        timeLimit: 45,
        cantGoBack: true,
        dueAt: '2026-05-18T06:59:59',
        unlockAt: '2026-05-11T07:00:00',
      },
    });

    expect(quiz.quizSettings).toEqual({
      name: 'Synthetic Quiz',
      // Plain text: GRASP shows the description as is, so "$" stays "$".
      description: 'Read every question.\nBring $5 or $6.',
      timeLimitMinutes: 45,
      disablePreviousNavigation: true,
    });
    // Classic exports write UTC without a zone.
    expect(quiz.order).toEqual({
      dueAt: '2026-05-18T06:59:59.000Z',
      unlockAt: '2026-05-11T07:00:00.000Z',
      position: 1,
    });
    expect(quiz.flavour).toBe('classic');
  });

  test('rounds a fractional Canvas time limit up to whole minutes', () => {
    expect(mapSlots([], { meta: { timeLimit: 22.5 } }).quizSettings.timeLimitMinutes).toBe(23);
  });

  test('defaults to a 60-minute limit, free navigation and no dates', () => {
    const quiz = mapSlots([mcItem({ ident: 'gitem1' })], { meta: { description: '' } });

    expect(quiz.quizSettings).toEqual({
      name: 'Synthetic Quiz',
      description: '',
      timeLimitMinutes: 60,
      disablePreviousNavigation: false,
    });
    expect(quiz.order).toEqual({ dueAt: null, unlockAt: null, position: 1 });
  });

  test('reads New Quizzes dates with a zone and ignores dates it cannot read', () => {
    const [zoned, broken] = mapCanvasQuizzes([
      quizOf([], { ident: 'gq1', meta: { dueAt: '2025-10-24T18:30:00Z' } }),
      quizOf([], { ident: 'gq2', meta: { dueAt: 'soon', unlockAt: '2025-09-01T08:00:00-07:00' } }),
    ]);

    expect(zoned.order.dueAt).toBe('2025-10-24T18:30:00.000Z');
    expect(broken.order).toEqual({ dueAt: null, unlockAt: '2025-09-01T15:00:00.000Z', position: 2 });
  });

  test('orders quizzes by due date, else unlock date, then the rest in manifest order', () => {
    const quizzes = mapCanvasQuizzes([
      quizOf([], { ident: 'gnodates', title: 'No dates' }),
      quizOf([], { ident: 'gmarch', title: 'March', meta: { dueAt: '2026-03-02T07:59:59' } }),
      quizOf([], { ident: 'gunlock', title: 'Unlock only', meta: { unlockAt: '2026-02-16T08:00:00' } }),
      quizOf([], { ident: 'gmarch2', title: 'March again', meta: { dueAt: '2026-03-02T07:59:59' } }),
      quizOf([], { ident: 'gjanuary', title: 'January', meta: { dueAt: '2026-01-05T07:59:59Z' } }),
    ]);

    expect([...quizzes].sort(compareQuizCreationOrder).map((quiz) => quiz.ident)).toEqual([
      'gjanuary',
      'gunlock',
      'gmarch',
      'gmarch2',
      'gnodates',
    ]);
  });
});

describe('mapCanvasQuizzes: multiple choice', () => {
  test('puts the prompt in title, the generator stem in stem, and letters the seeded shuffle', () => {
    const item = mcItem({
      ident: 'gshuffle02',
      stemHtml: '<div><p>Which <em>synthetic</em> option is right?</p></div>',
      choices: choices(['Alpha', 'Bravo', 'Charlie', 'Delta']),
      correct: '1002',
    });
    const draft = onlyDraft(item);

    // FNV-1a("gshuffle02") seeds mulberry32; Fisher-Yates gives Canvas order
    // [3, 2, 0, 1] (checked against an independent implementation).
    expect(draft.payload).toEqual({
      questionType: 'multiple-choice',
      title: 'Which synthetic option is right?',
      stem: 'Select the best answer:',
      bloom: 'Understand',
      options: {
        A: { text: 'Delta', feedback: '' },
        B: { text: 'Charlie', feedback: '' },
        C: { text: 'Alpha', feedback: '' },
        D: { text: 'Bravo', feedback: '' },
      },
      correctAnswer: 'D',
    });
    expect(draft.stemImages).toEqual([]);
    expect(draft.optionImages).toEqual({});
    expect(draft.warnings).toEqual([]);
    // Same item, same letters, every time.
    expect(onlyDraft(item)).toEqual(draft);
  });

  test('shuffles eight options and follows the correct one to its new letter', () => {
    const draft = onlyDraft(mcItem({
      ident: 'gshuffle01',
      choices: choices(['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8']),
      correct: '1001',
    }));

    // Canvas order [6, 0, 1, 3, 7, 5, 4, 2].
    expect(Object.entries(draft.payload.options).map(([letter, option]) => `${letter}=${option.text}`)).toEqual([
      'A=o7', 'B=o1', 'C=o2', 'D=o4', 'E=o8', 'F=o6', 'G=o5', 'H=o3',
    ]);
    expect(draft.payload.correctAnswer).toBe('B');
  });

  test('never shuffles true/false, whatever its labels', () => {
    // gshuffle01 swaps two options when it may.
    const standard = onlyDraft(mcItem({ ident: 'gshuffle01', type: 'true_false_question', correct: '1002' }));
    const relabelled = onlyDraft(mcItem({ ident: 'gshuffle01', type: 'true_false_question', choices: choices(['Yes', 'No']) }));

    expect(standard.payload.options).toEqual({ A: { text: 'True', feedback: '' }, B: { text: 'False', feedback: '' } });
    expect(standard.payload.correctAnswer).toBe('B');
    expect(relabelled.payload.options).toEqual({ A: { text: 'Yes', feedback: '' }, B: { text: 'No', feedback: '' } });
    expect(relabelled.payload.correctAnswer).toBe('A');
  });

  test('keeps Canvas order when the quiz turned answer shuffling off', () => {
    const draft = onlyDraft(
      mcItem({ ident: 'gshuffle01', choices: choices(['Alpha', 'Bravo', 'Charlie', 'Delta']), correct: '1002' }),
      NO_SHUFFLE,
    );

    expect(Object.values(draft.payload.options).map((option) => option.text)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
    expect(draft.payload.correctAnswer).toBe('B');
  });

  // Seeded orders of four options: gshuffle01 [0, 2, 3, 1], gshuffle02
  // [3, 2, 0, 1], gref03 [2, 3, 1, 0], gref04 [0, 1, 3, 2], gref05 [3, 2, 1, 0].
  // Every one moves some option, so a missed phrase fails at least one ident.
  const SHUFFLING_IDENTS = ['gshuffle01', 'gshuffle02', 'gref03', 'gref04', 'gref05'];

  test.each([
    ['All of the above'],
    ['None of these'],
    ['Both A and B'],
    ['Only option C'],
    ['All the above'],
    ['All of the answers above'],
    ['None of the other options above'],
    ['Both (A) and (B)'],
    ['Both a and b'],
    ['A, B, and C'],
    ['a, b and c'],
    ['Neither a nor b'],
  ])('keeps Canvas order when an option says "%s"', (text) => {
    for (const ident of SHUFFLING_IDENTS) {
      const draft = onlyDraft(mcItem({
        ident,
        choices: choices(['Alpha', 'Bravo', 'Charlie', text]),
        correct: '1004',
      }));

      expect([ident, ...Object.values(draft.payload.options).map((option) => option.text)])
        .toEqual([ident, 'Alpha', 'Bravo', 'Charlie', text]);
      expect(draft.payload.correctAnswer).toBe('D');
    }
  });

  test('still shuffles options that only look like references to other options', () => {
    const draft = onlyDraft(mcItem({
      ident: 'gshuffle02',
      choices: choices(['Vitamin A and B12', 'Plan B', 'A catalyst and a base', 'All reactions above 300 K']),
      correct: '1002',
    }));

    // Canvas order [3, 2, 0, 1], as in the first test.
    expect(Object.values(draft.payload.options).map((option) => option.text)).toEqual([
      'All reactions above 300 K',
      'A catalyst and a base',
      'Vitamin A and B12',
      'Plan B',
    ]);
    expect(draft.payload.correctAnswer).toBe('D');
  });

  test('puts options that are bare letters at their own letter instead of shuffling them', () => {
    // A stem picture labels structures A to D; GRASP draws its own letter
    // beside each option, so text "B" must sit at key B.
    const inOrder = onlyDraft(mcItem({ ident: 'gshuffle02', choices: choices(['A', 'B', 'C', 'D']), correct: '1001' }));
    const scrambled = onlyDraft(mcItem({ ident: 'gshuffle02', choices: choices(['(c)', 'A.', 'd)', 'B']), correct: '1004' }));
    const shuffleOff = onlyDraft(mcItem({ ident: 'glabel01', choices: choices(['b', 'a']), correct: '1002' }), NO_SHUFFLE);

    expect(inOrder.payload.options).toEqual({
      A: { text: 'A', feedback: '' },
      B: { text: 'B', feedback: '' },
      C: { text: 'C', feedback: '' },
      D: { text: 'D', feedback: '' },
    });
    expect(inOrder.payload.correctAnswer).toBe('A');
    expect(inOrder.warnings).toEqual([]);
    expect(scrambled.payload.options).toEqual({
      A: { text: 'A.', feedback: '' },
      B: { text: 'B', feedback: '' },
      C: { text: '(c)', feedback: '' },
      D: { text: 'd)', feedback: '' },
    });
    expect(scrambled.payload.correctAnswer).toBe('B');
    expect(shuffleOff.payload.options).toEqual({ A: { text: 'a', feedback: '' }, B: { text: 'b', feedback: '' } });
    expect(shuffleOff.payload.correctAnswer).toBe('A');
  });

  test.each([
    ['skip a letter', ['B', 'E', 'A', 'C']],
    ['go past the last option', ['C', 'B', 'D']],
    ['repeat a letter', ['B', 'A', '(b)']],
    // E/Z isomer answers: "E" is no label of two options.
    ['go past the last option beside another option', ['E', 'Z']],
    ['repeat a letter beside another option', ['B', 'Both', '(b)']],
  ])('keeps Canvas order for bare letters that %s', (_, texts) => {
    for (const ident of SHUFFLING_IDENTS) {
      const draft = onlyDraft(mcItem({ ident, choices: choices(texts), correct: '1002' }));

      expect([ident, ...Object.values(draft.payload.options).map((option) => option.text)]).toEqual([ident, ...texts]);
      expect(draft.payload.correctAnswer).toBe('B');
    }
  });

  // A stem picture labels structures A to D (or "Which is more acidic, A or
  // B?"): every bare letter must sit at its own letter, whatever the other
  // options say, and those keep their Canvas order in the letters left over.
  test.each([
    ['A, B, C, D, Cannot be determined', ['A', 'B', 'C', 'D', 'Cannot be determined'], 4, ['A', 'B', 'C', 'D', 'Cannot be determined'], 'E'],
    ['A, B, Both', ['A', 'B', 'Both'], 0, ['A', 'B', 'Both'], 'A'],
    ['B, A, They are equally acidic', ['B', 'A', 'They are equally acidic'], 0, ['A', 'B', 'They are equally acidic'], 'B'],
    ['Neither, (c), A., Both', ['Neither', '(c)', 'A.', 'Both'], 1, ['A.', 'Neither', '(c)', 'Both'], 'C'],
    ['B, Both, Neither', ['B', 'Both', 'Neither'], 2, ['Both', 'B', 'Neither'], 'C'],
  ])('puts each bare letter of "%s" at its own letter and never shuffles the set', (_, texts, correctIndex, expected, letter) => {
    for (const ident of SHUFFLING_IDENTS) {
      const draft = onlyDraft(mcItem({ ident, choices: choices(texts), correct: String(1001 + correctIndex) }));

      expect([ident, ...Object.values(draft.payload.options).map((option) => option.text)]).toEqual([ident, ...expected]);
      expect(draft.payload.correctAnswer).toBe(letter);
      expect(draft.warnings).toEqual([]);
    }
  });

  test('puts bare letters at their own letter when another option is only a picture', () => {
    const draft = onlyDraft(mcItem({
      ident: 'gshuffle02',
      choices: htmlChoices(['<p>B</p>', '<p>A</p>', `<p><img src="${REMOTE}" alt="c.png"></p>`]),
      correct: '1001',
    }));

    expect(Object.values(draft.payload.options).map((option) => option.text)).toEqual(['A', 'B', '']);
    expect(draft.optionImages).toEqual({ C: { src: REMOTE, kind: 'remote', caption: '' } });
    expect(draft.payload.correctAnswer).toBe('B');
  });

  test('keeps Canvas order for a multiple choice whose options are True and False', () => {
    const draft = onlyDraft(mcItem({ ident: 'gshuffle01', choices: choices(['True', 'False']), correct: '1001' }));

    expect(draft.payload.options).toEqual({ A: { text: 'True', feedback: '' }, B: { text: 'False', feedback: '' } });
  });

  test.each([
    ['no correct answer', { correct: null }, 'Canvas marks no answer as correct; GRASP multiple choice needs exactly one.'],
    ['two correct answers', { correct: ['1001', '1002'] }, 'Canvas marks 2 answers as correct; GRASP multiple choice needs exactly one.'],
    ['one option', { choices: choices(['Alone']) }, 'GRASP multiple choice needs 2 to 8 answer options; this one has 1.'],
    [
      'nine options',
      { choices: choices(['1', '2', '3', '4', '5', '6', '7', '8', '9']) },
      'GRASP multiple choice needs 2 to 8 answer options; this one has 9.',
    ],
    [
      'two options with one Canvas id',
      { choices: [{ ident: '1001', text: 'Alpha' }, { ident: '1001', text: 'Bravo' }] },
      'Two answer options share the same Canvas answer id, so the correct one cannot be told apart.',
    ],
    ['an empty option', { choices: htmlChoices(['<p>Alpha</p>', '<p>&nbsp;</p>']) }, 'An answer option is empty.'],
    ['no question text', { stemHtml: '<div><p> </p></div>' }, 'The question has no text.'],
  ])('skips a question with %s', (_, overrides, reason) => {
    expect(onlySkip(mcItem({ ident: 'gbad1', title: 'Q07 variant', ...overrides }))).toEqual({
      itemIdent: 'gbad1',
      slotName: 'Synthetic Quiz – Question 1',
      itemTitle: 'Q07 variant',
      canvasType: 'multiple_choice_question',
      reason,
    });
  });

  test('keeps equation-only options as LaTeX text', () => {
    const equation = (latex) =>
      `<p><img class="equation_image" title="${latex}" src="https://canvas.example.test/equation_images/x" alt="LaTeX: ${latex}" data-equation-content="${latex}"></p>`;
    const draft = onlyDraft(mcItem({ ident: 'geq1', choices: htmlChoices([equation('x^2'), equation('x^3')]) }), NO_SHUFFLE);

    expect(draft.payload.options).toEqual({ A: { text: '\\(x^2\\)', feedback: '' }, B: { text: '\\(x^3\\)', feedback: '' } });
  });

  test('keeps "<" and ">" in plain-text options', () => {
    const draft = onlyDraft(mcItem({ ident: 'gplain1', choices: choices(['a < b', 'b > c']) }), NO_SHUFFLE);

    expect(draft.payload.options).toEqual({ A: { text: 'a < b', feedback: '' }, B: { text: 'b > c', feedback: '' } });
  });

  test('a stem that is only an image gets a short prompt and keeps the image as a reference', () => {
    const draft = onlyDraft(mcItem({ ident: 'gimg1', stemHtml: `<div><p><img src="${REMOTE}" alt="q1.png"></p></div>` }));

    expect(draft.payload.title).toBe('Use the image below to answer.');
    expect(draft.stemImages).toEqual([{ src: REMOTE, kind: 'remote', caption: '', altText: '' }]);
  });

  test('a stem that is only images gets the plural prompt', () => {
    const draft = onlyDraft(mcItem({
      ident: 'gimg2',
      stemHtml: `<div><p><img src="${REMOTE}" alt="a.png"><img src="${REMOTE_2}" alt="b.png"></p></div>`,
    }));

    expect(draft.payload.title).toBe('Use the images below to answer.');
    expect(draft.stemImages.map((image) => image.caption)).toEqual(['Image 1', 'Image 2']);
  });

  test('numbers stem images in the text and captions them "Image N", never with the Canvas alt', () => {
    const draft = onlyDraft(mcItem({
      ident: 'gimg3',
      stemHtml: `<div><p>Look at the structure.</p><p><img src="${BUNDLED}" alt="Ethanol, the answer"></p><p>Name it.</p></div>`,
    }));

    expect(draft.payload.title).toBe('Look at the structure.\n(Image 1)\nName it.');
    expect(draft.stemImages).toEqual([
      { src: BUNDLED, kind: 'bundled', caption: 'Image 1', altText: 'Ethanol, the answer' },
    ]);
  });

  test('turns option images into references, captioned only by descriptive alt text', () => {
    const draft = onlyDraft(mcItem({
      ident: 'goptimg',
      choices: htmlChoices([
        `<p><img src="${REMOTE}" alt="AnsOpt.jpg"></p>`,
        `<p>Ring <img src="${REMOTE_2}" alt="Skeletal formula of a ring"></p>`,
        `<p><img src="${BUNDLED}" alt="LaTeX: x^2"></p>`,
        `<p><img src="${REMOTE_2}" alt="first"><img src="${REMOTE}" alt="second"></p>`,
      ]),
    }), NO_SHUFFLE);

    expect(draft.payload.options).toEqual({
      A: { text: '', feedback: '' },
      B: { text: 'Ring', feedback: '' },
      C: { text: '', feedback: '' },
      D: { text: '', feedback: '' },
    });
    expect(draft.optionImages).toEqual({
      A: { src: REMOTE, kind: 'remote', caption: '' },
      B: { src: REMOTE_2, kind: 'remote', caption: 'Skeletal formula of a ring' },
      C: { src: BUNDLED, kind: 'bundled', caption: '' },
      D: { src: REMOTE_2, kind: 'remote', caption: '' },
    });
    expect(draft.warnings).toEqual(['Option D: Only the first of its 2 images was kept.']);
  });

  test('builds option feedback from the answer comment, correct or incorrect feedback, then general feedback', () => {
    const draft = onlyDraft(mcItem({
      ident: 'gfb1',
      choices: choices(['Alpha', 'Bravo', 'Charlie']),
      correct: '1002',
      answerFeedback: { 1001: '<p>Alpha is <em>tempting</em>.</p>', 1002: { text: 'Bravo fits.' } },
      generalFeedback: { general: '<p>See part 2.</p>', correct: '<p>Well done.</p>', incorrect: '<p>Review rates.</p>' },
    }), NO_SHUFFLE);

    expect(draft.payload.options).toEqual({
      A: { text: 'Alpha', feedback: 'Alpha is tempting.\n\nReview rates.\n\nSee part 2.' },
      B: { text: 'Bravo', feedback: 'Bravo fits.\n\nWell done.\n\nSee part 2.' },
      C: { text: 'Charlie', feedback: 'Review rates.\n\nSee part 2.' },
    });
    expect(draft.payload.correctAnswer).toBe('B');
    expect(draft.warnings).toEqual([]);
  });

  // RichText renders the text between two "$" as math, and a "$" it cannot
  // close stops it rendering the math after it. Each field alone keeps its one
  // "$"; joined, they are escaped as the converter does for one field.
  test('escapes lone "$" again when joining feedback brings two together', () => {
    const draft = onlyDraft(mcItem({
      ident: 'gfbdollar1',
      choices: choices(['Alpha', 'Bravo', 'Charlie']),
      correct: '1002',
      answerFeedback: { 1003: '<p>That one costs $5.</p>' },
      generalFeedback: { general: '<p>The budget was $20.</p>' },
    }), NO_SHUFFLE);

    expect(draft.payload.options).toEqual({
      A: { text: 'Alpha', feedback: 'The budget was $20.' },
      B: { text: 'Bravo', feedback: 'The budget was $20.' },
      C: { text: 'Charlie', feedback: 'That one costs \\(\\$\\)5.\n\nThe budget was \\(\\$\\)20.' },
    });
  });

  test('escapes a lone "$" again when another joined feedback field has math', () => {
    const draft = onlyDraft(mcItem({
      ident: 'gfbdollar2',
      choices: choices(['Alpha', 'Bravo', 'Charlie']),
      correct: '1002',
      answerFeedback: { 1001: '<p>Bring $1 or $2.</p>', 1003: '<p>That one costs $5.</p>' },
      generalFeedback: { general: '<p>Recall K<sub>a</sub> is small.</p>', correct: '<p>Yes, $3.</p>' },
    }), NO_SHUFFLE);

    expect(draft.payload.options).toEqual({
      // The converter already escaped these two; nothing lone is left.
      A: { text: 'Alpha', feedback: 'Bring \\(\\$\\)1 or \\(\\$\\)2.\n\nRecall K\\({}_{\\text{a}}\\) is small.' },
      B: { text: 'Bravo', feedback: 'Yes, \\(\\$\\)3.\n\nRecall K\\({}_{\\text{a}}\\) is small.' },
      C: { text: 'Charlie', feedback: 'That one costs \\(\\$\\)5.\n\nRecall K\\({}_{\\text{a}}\\) is small.' },
    });
  });

  test('keeps a lone "$" when the feedback it joins has no other "$" and no math, or nothing is joined', () => {
    const draft = onlyDraft(mcItem({
      ident: 'gfbdollar3',
      choices: choices(['Alpha', 'Bravo', 'Charlie']),
      correct: '1002',
      answerFeedback: { 1001: '<p>That one costs $5.</p>', 1002: '<p>Costs $4, as it should.</p>' },
      generalFeedback: { incorrect: '<p>See part 2.</p>' },
    }), NO_SHUFFLE);

    expect(draft.payload.options).toEqual({
      A: { text: 'Alpha', feedback: 'That one costs $5.\n\nSee part 2.' },
      B: { text: 'Bravo', feedback: 'Costs $4, as it should.' },
      C: { text: 'Charlie', feedback: 'See part 2.' },
    });
  });

  test('drops images from feedback with a warning', () => {
    const draft = onlyDraft(mcItem({
      ident: 'gfb2',
      generalFeedback: { general: `<p>Compare with <img src="${REMOTE}" alt="key.png"> this.</p>` },
    }), NO_SHUFFLE);

    expect(draft.payload.options.A.feedback).toBe('Compare with this.');
    expect(draft.warnings).toEqual(['Images in Canvas feedback were not imported (GRASP feedback is text only).']);
  });

  test('warns about options that differ only in capital letters, which the editor refuses', () => {
    const draft = onlyDraft(mcItem({ ident: 'gcase1', choices: choices(['Q = (a/Bc)d', 'Q = (A/bC)d', 'Q = xyz']) }));

    expect(draft.warnings).toEqual([
      "Two answer options differ only in capital letters; GRASP's editor asks you to change one before you can save edits.",
    ]);
  });

  test('warns about identical options, but not when different pictures tell them apart', () => {
    const identical = onlyDraft(mcItem({ ident: 'gsame1', choices: choices(['Same', 'Same', 'Other']) }));
    const pictures = onlyDraft(mcItem({
      ident: 'gsame2',
      choices: htmlChoices([`<p><img src="${REMOTE}" alt="1.png"></p>`, `<p><img src="${REMOTE_2}" alt="1.png"></p>`]),
    }));
    const captioned = onlyDraft(mcItem({
      ident: 'gsame3',
      choices: htmlChoices([`<p>Ring <img src="${REMOTE}" alt="1.png"></p>`, `<p>ring <img src="${REMOTE_2}" alt="2.png"></p>`]),
    }));

    expect(identical.warnings).toEqual(['Two answer options are identical.']);
    expect(pictures.warnings).toEqual([]);
    // Each picture is its own upload, so the editor sees them as different.
    expect(captioned.warnings).toEqual([]);
  });

  test('passes on conversion losses and parser doubts as Draft reasons', () => {
    const draft = onlyDraft(mcItem({
      ident: 'glossy1',
      stemHtml: '<div><p>Watch this.</p><iframe src="https://video.example.test/embed/1"></iframe></div>',
      choices: htmlChoices(['<p>Alpha <video src="clip.mp4"></video></p>', '<p>Bravo</p>']),
      // Canvas scores an answer id that is not among the options.
      correct: ['1001', '9999'],
    }), NO_SHUFFLE);

    expect(draft.payload.title).toBe('Watch this.');
    expect(draft.payload.correctAnswer).toBe('A');
    expect(draft.warnings).toEqual([
      'Question text: Embedded media was removed.',
      'Option A: Embedded media was removed.',
      'Canvas scores an answer that is not one of the options.',
    ]);
  });
});

describe('mapCanvasQuizzes: numerical', () => {
  const numericalDraft = (answers, extra = {}) => onlyDraft(numericalItem({ ident: 'gnum1', answers, ...extra }));

  test.each([
    ['exact with margin 0', { exact: '3.0', min: '3.0', max: '3.0' }, '3', { mode: 'absolute', value: 0 }, 1, '3'],
    // Float subtraction would give 0.20000000000004547.
    ['exact with margin 0.2', { exact: '-512.4', min: '-512.6', max: '-512.2' }, '-512.4', { mode: 'absolute', value: 0.2 }, 1, '-512.4'],
    ['a New Quizzes-style integer', { exact: '27', min: '27', max: '27' }, '27', { mode: 'absolute', value: 0 }, 0, '27'],
    ['a small margin', { exact: '0.0123', min: '0.0118', max: '0.0128' }, '0.0123', { mode: 'absolute', value: 0.0005 }, 4, '0.0123'],
    ['trailing zeros', { exact: '-0.50', min: '-0.75', max: '-0.25' }, '-0.5', { mode: 'absolute', value: 0.25 }, 2, '-0.5'],
    ['asymmetric bounds', { exact: '2.5', min: '2.0', max: '3.5' }, '2.5', { mode: 'range', min: 2, max: 3.5 }, 1, '2.5'],
    ['an exact answer only', { exact: '7.25' }, '7.25', { mode: 'absolute', value: 0 }, 2, '7.25'],
    ['a range only (midpoint shown)', { min: '1', max: '2' }, '1.5', { mode: 'range', min: 1, max: 2 }, 1, '1.5'],
    ['e-notation with a plus sign', { exact: '+1.5e-7' }, '0.00000015', { mode: 'absolute', value: 0 }, 8, '0.00000015'],
    ['a typographic minus', { exact: '\u22122.5' }, '-2.5', { mode: 'absolute', value: 0 }, 1, '-2.5'],
    ['a very large value', { exact: '6.022e23' }, '6.022e23', { mode: 'absolute', value: 0 }, 3, '6.022 × 10^23'],
  ])('maps %s to a fixed-answer calculation', (_, answer, formula, tolerance, decimals, shown) => {
    const draft = numericalDraft([answer]);
    const { payload } = draft;

    expect(payload).toEqual({
      questionType: 'calculation',
      title: 'Synthetic Quiz – Question 1',
      stem: 'Synthetic numerical question.',
      bloom: 'Understand',
      calculationFormula: formula,
      calculationVariables: [],
      calculationAnswerDecimals: decimals,
      calculationTolerance: tolerance,
    });
    expect(draft.warnings).toEqual([]);
    // What saveQuestion checks, and what the student is shown as the answer.
    const normalized = CalculationQuestion.normalizeTolerance(payload.calculationTolerance);
    expect(normalized).toEqual(tolerance);
    expect(() => CalculationQuestion.validateCalculationDefinition({
      formula: payload.calculationFormula,
      variableSpecs: payload.calculationVariables,
      stem: payload.stem,
      tolerance: normalized,
    })).not.toThrow();
    const value = CalculationQuestion.evaluateCalculationFormula(payload.calculationFormula, {});
    expect(CalculationQuestion.formatAnswerForDisplay(value, payload.calculationAnswerDecimals)).toBe(shown);
  });

  test('widens a range that leaves out the exact answer, with a warning', () => {
    const draft = numericalDraft([{ exact: '5', min: '1', max: '2' }]);

    expect(draft.payload.calculationFormula).toBe('5');
    expect(draft.payload.calculationTolerance).toEqual({ mode: 'range', min: 1, max: 5 });
    expect(draft.warnings).toEqual([
      "Canvas accepted the exact answer or a range that doesn't include it; GRASP accepts everything between the two.",
    ]);
  });

  test.each([
    ['no answer', [], 'No correct answer is set.'],
    [
      'two answers',
      [{ exact: '1.0', min: '1.0', max: '1.0' }, { exact: '2.0', min: '2.0', max: '2.0' }],
      'Canvas accepts several different answers; GRASP numerical questions take one answer and one tolerance.',
    ],
    ['a word', [{ exact: 'ten' }], "The answer isn't a number."],
    ['a thousands comma', [{ exact: '1,000' }], "The answer isn't a number."],
    // Refused before any arithmetic: 10^999999999 would never finish.
    ['an absurd exponent', [{ exact: '1e999999999' }], "The answer isn't a number."],
    ['a lower bound only', [{ min: '1' }], 'Only one bound of the answer range is set.'],
    ['an exact answer and an upper bound', [{ exact: '5', max: '6' }], 'Only one bound of the answer range is set.'],
    ['an empty range', [{ min: '3', max: '1' }], "The answer range's lowest value is above its highest value."],
  ])('skips a numerical question with %s', (_, answers, reason) => {
    expect(onlySkip(numericalItem({ ident: 'gnum2', answers }))).toEqual({
      itemIdent: 'gnum2',
      slotName: 'Synthetic Quiz – Question 1',
      itemTitle: 'Question',
      canvasType: 'numerical_question',
      reason,
    });
  });

  test('splits "{{" and "}}" in the stem so a fixed-answer save accepts it', () => {
    const { payload } = numericalDraft([{ exact: '2' }], { stemHtml: '<div><p>Use {{x}} and {{{y}}} as printed.</p></div>' });

    expect(payload.stem).toBe('Use { {x} } and { { {y} } } as printed.');
    expect(() => CalculationQuestion.validateCalculationDefinition({
      formula: payload.calculationFormula,
      variableSpecs: [],
      stem: payload.stem,
      tolerance: null,
    })).not.toThrow();
  });

  test.each([
    ['a descriptive Canvas title', 'Synthetic_Sign_Check', 'Synthetic_Sign_Check'],
    ['the group title', 'rate LAWS', 'Synthetic Quiz – Rate laws'],
    ['"Question"', 'Question', 'Synthetic Quiz – Rate laws'],
    ['"Question 4"', 'question 4', 'Synthetic Quiz – Rate laws'],
    ['a stale question number', 'Q08', 'Synthetic Quiz – Rate laws'],
    ['an empty title', '', 'Synthetic Quiz – Rate laws'],
  ])('titles a numerical question with %s as %s', (_, title, expected) => {
    const quiz = mapSlots([groupSection({ ident: 'grates', title: 'Rate laws', items: [numericalItem({ ident: 'gnum3', title })] })]);

    expect(quiz.slots[0].questions[0].payload.title).toBe(expected);
  });

  test('warns once when Canvas feedback is dropped, whether general or attached to the answer', () => {
    const general = numericalDraft([{ exact: '2' }], { generalFeedback: { general: '<p>Show your work.</p>' } });
    const perAnswer = numericalDraft([{ exact: '2', feedback: '<p>Close enough.</p>' }]);

    expect(general.warnings).toEqual(['Canvas feedback was not imported (GRASP has no feedback for this question type).']);
    expect(perAnswer.warnings).toEqual(['Canvas feedback was not imported (GRASP has no feedback for this question type).']);
  });
});

describe('mapCanvasQuizzes: fill in the blank', () => {
  test('turns a one-blank fill-in into GRASP fill-in, replacing only the declared blank', () => {
    const draft = onlyDraft(fimbItem({
      ident: 'gfimb1',
      title: 'SYN_1A_blank',
      stemHtml: '<div>[A] reacts with [x1] to give [B].</div>',
      blanks: [{ id: 'x1', answers: ['synthetic ether', 'Synthetic Ether', ' syntheticether '] }],
    }));

    expect(draft.payload).toEqual({
      questionType: 'fill-in-the-blank',
      title: 'SYN_1A_blank',
      stem: '[A] reacts with _________ to give [B].',
      bloom: 'Understand',
      correctAnswer: 'synthetic ether',
      acceptableAnswers: ['synthetic ether', 'syntheticether'],
    });
    expect(draft.warnings).toEqual([]);
  });

  test('appends the blank when the stem never shows it, and warns when it shows twice', () => {
    const missing = onlyDraft(fimbItem({ ident: 'gfimb2', stemHtml: '<div>Name the compound.</div>' }));
    const twice = onlyDraft(fimbItem({ ident: 'gfimb3', stemHtml: '<div>[x1] and again [x1].</div>' }));

    expect(missing.payload.stem).toBe('Name the compound. _________');
    expect(missing.warnings).toEqual([]);
    expect(twice.payload.stem).toBe('_________ and again _________.');
    expect(twice.warnings).toEqual(['The blank appears more than once in the question; GRASP takes one answer for all of them.']);
  });

  // KaTeX refuses a raw "_" in converted math and shows the whole table or
  // superscript as red source; \verb|_________| renders (checked with the
  // client's KaTeX auto-render) and keeps the nine underscores the editors need.
  test.each([
    [
      'a table cell',
      '<div><p>Fill the table.</p><table><tr><th>Species</th><th>Charge</th></tr><tr><td>Na</td><td>[x1]</td></tr></table></div>',
      'Fill the table.\n\\[\\begin{array}{|c|c|}\\hline \\text{Species} & \\text{Charge} \\\\ \\hline \\text{Na} & \\text{\\verb|_________|} \\\\ \\hline \\end{array}\\]',
    ],
    [
      'a superscript',
      '<p>The iron ion in this compound is Fe<sup>[x1]</sup>.</p>',
      'The iron ion in this compound is Fe\\({}^{\\text{\\verb|_________|}}\\).',
    ],
    [
      'the middle of a cell, beside a subscript',
      '<table><tr><td>charge [x1] here</td><td>K<sub>a</sub></td></tr></table>',
      '\\[\\begin{array}{|c|c|}\\hline \\text{charge \\verb|_________| here} & \\text{K}_{\\text{a}} \\\\ \\hline \\end{array}\\]',
    ],
    ['math the author typed', '<p>Solve \\(x = [x1]\\) for x.</p>', 'Solve \\(x = \\verb|_________|\\) for x.'],
  ])('writes a blank inside %s so the math still renders', (_, stemHtml, stem) => {
    const draft = onlyDraft(fimbItem({ ident: 'gfimbmath', stemHtml, blanks: [{ id: 'x1', answers: ['+1'] }] }));

    expect(draft.payload.stem).toBe(stem);
    expect(draft.payload.stem.split('_________')).toHaveLength(2);
    expect(draft.warnings).toEqual([]);
  });

  test('writes only the blanks inside math with \\verb, and plain ones before or after math as is', () => {
    const repeated = onlyDraft(fimbItem({ ident: 'gfimbmath2', stemHtml: '<p>[x1] then Fe<sup>[x1]</sup> and [x1].</p>' }));
    const beforeTable = onlyDraft(fimbItem({
      ident: 'gfimbmath3',
      stemHtml: '<div><p>Name [x1].</p><table><tr><td>a_b</td></tr></table></div>',
    }));

    expect(repeated.payload.stem).toBe('_________ then Fe\\({}^{\\text{\\verb|_________|}}\\) and _________.');
    expect(repeated.warnings).toEqual(['The blank appears more than once in the question; GRASP takes one answer for all of them.']);
    expect(beforeTable.payload.stem).toBe('Name _________.\n\\[\\begin{array}{|c|}\\hline \\text{a\\_b} \\\\ \\hline \\end{array}\\]');
  });

  test('skips a fill-in with two blanks', () => {
    const skip = onlySkip(fimbItem({
      ident: 'gfimb4',
      blanks: [{ id: 'x1', answers: ['one'] }, { id: 'x2', answers: ['two'] }],
    }));

    expect(skip).toEqual({
      itemIdent: 'gfimb4',
      slotName: 'Synthetic Quiz – Question 1',
      itemTitle: 'Question',
      canvasType: 'fill_in_multiple_blanks_question',
      reason: 'GRASP fill-in-the-blank questions have one blank; this one has 2.',
    });
  });

  test('turns a short answer into fill-in with a blank appended', () => {
    const draft = onlyDraft(shortAnswerItem({ ident: 'gshort1', answers: ['synthanol', 'Synthanol', 'synthetic alcohol'] }));

    expect(draft.payload).toEqual({
      questionType: 'fill-in-the-blank',
      title: 'Synthetic Quiz – Question 1',
      stem: 'Name the synthetic compound. _________',
      bloom: 'Understand',
      correctAnswer: 'synthanol',
      acceptableAnswers: ['synthanol', 'synthetic alcohol'],
    });
  });

  test('keeps a short-answer stem that already has the blank', () => {
    const draft = onlyDraft(shortAnswerItem({
      ident: 'gshort2',
      stemHtml: '<div><p>The _________ is the synthetic answer.</p></div>',
      generalFeedback: { general: '<p>Check spelling.</p>' },
    }));

    expect(draft.payload.stem).toBe('The _________ is the synthetic answer.');
    expect(draft.warnings).toEqual(['Canvas feedback was not imported (GRASP has no feedback for this question type).']);
  });

  test('skips a short answer with no accepted answer', () => {
    expect(onlySkip(shortAnswerItem({ ident: 'gshort3', answers: [] })).reason).toBe('No correct answer is set.');
  });
});

describe('mapCanvasQuizzes: skipped items', () => {
  test.each([
    [
      'multiple answers',
      mcItem({ ident: 'gskip1', type: 'multiple_answers_question', correct: ['1001', '1003'] }),
      'multiple_answers_question',
      "Multiple-answer questions aren't supported in GRASP yet.",
    ],
    [
      'multiple dropdowns',
      fimbItem({ ident: 'gskip1', type: 'multiple_dropdowns_question' }),
      'multiple_dropdowns_question',
      "Multiple-dropdown questions aren't supported in GRASP.",
    ],
    ['matching', otherItem({ ident: 'gskip1', type: 'matching_question' }), 'matching_question', "Matching questions aren't supported in GRASP."],
    [
      'essay',
      otherItem({ ident: 'gskip1', type: 'essay_question' }),
      'essay_question',
      "Essay questions aren't imported yet: GRASP needs a sample answer and grading criteria for them.",
    ],
    ['file upload', otherItem({ ident: 'gskip1', type: 'file_upload_question' }), 'file_upload_question', "File-upload questions aren't supported in GRASP."],
    ['text only', otherItem({ ident: 'gskip1', type: 'text_only_question' }), 'text_only_question', 'Text-only item with no question to answer.'],
    ['an unknown type', otherItem({ ident: 'gskip1', type: 'hot_spot_question' }), 'hot_spot_question', 'Unknown Canvas question type (hot_spot_question).'],
    ['no type', otherItem({ ident: 'gskip1', type: '' }), null, 'Unknown Canvas question type (none).'],
  ])('skips %s with its reason', (_, itemXml, canvasType, reason) => {
    const quiz = mapSlots([itemXml]);
    const skip = { itemIdent: 'gskip1', slotName: 'Synthetic Quiz – Question 1', itemTitle: 'Question', canvasType, reason };

    expect(quiz.slots[0]).toEqual({
      ident: 'gskip1',
      position: 1,
      name: 'Synthetic Quiz – Question 1',
      questions: [],
      skipped: [skip],
      notes: [],
    });
    expect(quiz.skipped).toEqual([skip]);
  });

  test('reports a group that draws from a question bank the export does not include', () => {
    const quiz = mapSlots([groupSection({ ident: 'gbank', title: 'Bank pick', pick: 2, sourceBankRef: 'gbankref01' })]);

    expect(quiz.skipped).toEqual([{
      itemIdent: null,
      slotName: 'Synthetic Quiz – Bank pick',
      itemTitle: '',
      canvasType: null,
      reason: "This group draws questions from a question bank, which a quiz export doesn't include. Import the bank's questions separately when that's supported.",
    }]);
    expect(quiz.notes).toEqual([]);
  });

  test('skips every item of a New Quizzes export and makes no notes', () => {
    const quiz = mapSlots(
      [mcItem({ ident: 'gnq1', title: '' }), numericalItem({ ident: 'gnq2', title: '' })],
      { newQuizzes: true, meta: { description: '<p>See <a href="$IMS-CC-FILEBASE$/x.pdf">the table</a>.</p>' } },
    );

    expect(quiz.flavour).toBe('new-quizzes');
    expect(quiz.slots.flatMap((slot) => slot.questions)).toEqual([]);
    expect(quiz.skipped).toEqual([
      { itemIdent: 'gnq1', slotName: 'Synthetic Quiz – Question 1', itemTitle: '', canvasType: 'multiple_choice_question', reason: "New Quizzes exports aren't supported yet (#147)." },
      { itemIdent: 'gnq2', slotName: 'Synthetic Quiz – Question 2', itemTitle: '', canvasType: 'numerical_question', reason: "New Quizzes exports aren't supported yet (#147)." },
    ]);
    expect(quiz.notes).toEqual([]);
  });

  test('imports the supported variants of a mixed group and lists the rest', () => {
    const quiz = mapSlots([groupSection({
      ident: 'gmixed',
      title: 'Q10',
      items: [mcItem({ ident: 'gmix1' }), mcItem({ ident: 'gmix2', type: 'multiple_answers_question' }), mcItem({ ident: 'gmix3' })],
    })]);

    expect(quiz.slots[0].questions.map((q) => q.itemIdent)).toEqual(['gmix1', 'gmix3']);
    expect(quiz.slots[0].skipped.map((s) => [s.itemIdent, s.slotName])).toEqual([['gmix2', 'Synthetic Quiz – Q10']]);
  });
});

describe('mapCanvasQuizzes: notes', () => {
  test('notes picks above one, unscored slots and what the description loses', () => {
    const quiz = mapSlots([
      groupSection({ ident: 'gpick', title: 'Q01', pick: 2, items: [mcItem({ ident: 'g1' }), mcItem({ ident: 'g2' })] }),
      // Nothing imported from these two, so nothing to note.
      groupSection({ ident: 'gpickessay', title: 'Q02', pick: 3, items: [otherItem({ ident: 'g3' })] }),
      groupSection({ ident: 'gzeroessay', title: 'Q03', pointsPerItem: 0, items: [otherItem({ ident: 'g4' })] }),
      groupSection({ ident: 'gzero', title: 'Q04', pointsPerItem: 0, items: [mcItem({ ident: 'g5', points: 1 })] }),
      mcItem({ ident: 'g6', points: 0 }),
      // The group's points override its item's 0.
      groupSection({ ident: 'gscored', title: 'Q06', pointsPerItem: 1, items: [mcItem({ ident: 'g7', points: 0 })] }),
    ], {
      meta: {
        description: `<p>Use the <a href="$IMS-CC-FILEBASE$/Canvas_Quizzes/table.pdf">data table</a>.</p><p><img src="${REMOTE}" alt="x"></p>`,
      },
    });

    expect(quiz.quizSettings.description).toBe('Use the data table.');
    expect(quiz.slots[0].notes).toEqual(["Canvas picked 2 questions from 'Q01'; GRASP gives one question per objective."]);
    expect(quiz.slots.slice(1).flatMap((slot) => slot.notes)).toEqual([]);
    expect(quiz.notes).toEqual([
      'The quiz description linked a file, which was not imported.',
      'The quiz description had an image, which was not imported.',
      'Canvas gives no points for Q04 and Question 5; in GRASP their questions count like any other.',
      "Canvas picked 2 questions from 'Q01'; GRASP gives one question per objective.",
    ]);
  });

  test('names a single unscored slot in the singular', () => {
    const quiz = mapSlots([groupSection({ ident: 'gzero', title: 'Q01', pointsPerItem: 0, items: [mcItem({ ident: 'g1' })] })]);

    expect(quiz.notes).toEqual(['Canvas gives no points for Q01; in GRASP its questions count like any other.']);
  });

  test("falls back to the items' own points when a group sets none", () => {
    const quiz = mapSlots([
      groupSection({ ident: 'gmixedpts', title: 'Q01', pointsPerItem: null, items: [mcItem({ ident: 'g1', points: 0 }), mcItem({ ident: 'g2', points: 1 })] }),
      groupSection({ ident: 'gnopts', title: 'Q02', pointsPerItem: null, items: [mcItem({ ident: 'g3', points: 0 }), mcItem({ ident: 'g4', points: 0 })] }),
    ]);

    expect(quiz.notes).toEqual(['Canvas gives no points for Q02; in GRASP its questions count like any other.']);
  });
});

describe('mapCanvasQuizzes: stem image captions from a GRASP export', () => {
  test("moves the caption paragraph GRASP's QTI export writes under an image back to the caption", () => {
    const src = '$IMS-CC-FILEBASE$/grasp/aaaaaaaaaaaaaaaaaaaaaaa1-cell.png';
    const draft = onlyDraft(mcItem({
      ident: 'gcap1',
      stemHtml: `<div><p>Which organelle is shown?</p><p><img src="${src}" alt="Cell diagram"></p><p><em>Cell diagram</em></p></div>`,
    }));

    expect(draft.payload.title).toBe('Which organelle is shown?');
    expect(draft.stemImages).toEqual([{ src, kind: 'bundled', caption: 'Cell diagram', altText: 'Cell diagram' }]);
  });

  test('leaves an italic paragraph that does not repeat the alt text in the question', () => {
    const draft = onlyDraft(mcItem({
      ident: 'gcap2',
      stemHtml: `<div><p>Which organelle?</p><p><img src="${BUNDLED}" alt="Cell diagram"></p><p><em>Ignore the labels.</em></p></div>`,
    }));

    expect(draft.payload.title).toBe('Which organelle?\n(Image 1)\nIgnore the labels.');
    expect(draft.stemImages).toEqual([{ src: BUNDLED, kind: 'bundled', caption: 'Image 1', altText: 'Cell diagram' }]);
  });
});

describe('mapCanvasQuizzes: no URL in what gets saved or reported', () => {
  test('keeps remote and bundled sources out of payloads, warnings, skips and notes', () => {
    const quiz = mapSlots([
      mcItem({
        ident: 'gurl1',
        stemHtml: `<div><p>See <a href="https://canvas.example.test/courses/1/files/3/download?verifier=s3">the notes</a>.</p><p><img src="${REMOTE}" alt="Diagram from https://canvas.example.test/courses/1/files/4"></p></div>`,
        choices: htmlChoices([`<p><img src="${REMOTE}" alt="Copied from www.example.test today"></p>`, `<p><img src="${BUNDLED}" alt="b"></p>`]),
      }),
      numericalItem({ ident: 'gurl2', stemHtml: `<div><p>Read the chart.</p><p><img src="${BUNDLED}" alt="chart"></p></div>`, answers: [{ exact: '4' }] }),
      calculatedItem({ ident: 'gurl3', stemHtml: `<div><p>Double [x].</p><p><img src="${REMOTE}" alt="x"></p></div>` }),
    ], { meta: { shuffleAnswers: false, description: `<p><a href="${REMOTE}">Key</a></p>` } });

    const drafts = quiz.slots.flatMap((slot) => slot.questions);
    const reported = JSON.stringify({
      payloads: drafts.map((draft) => draft.payload),
      warnings: drafts.map((draft) => draft.warnings),
      altTexts: drafts.flatMap((draft) => draft.stemImages.map((image) => image.altText)),
      captions: drafts.flatMap((draft) => Object.values(draft.optionImages).map((image) => image.caption)),
      skipped: quiz.skipped,
      notes: quiz.notes,
      settings: quiz.quizSettings,
    });

    expect(drafts).toHaveLength(3);
    expect(reported).not.toMatch(/canvas\.example\.test|verifier|IMS-CC-FILEBASE|www\./);
    expect(drafts[0].warnings).toEqual(['Question text: A linked file was not imported.']);
    // The sources themselves stay on the image references for the service.
    expect(drafts[0].stemImages.map((image) => image.src)).toEqual([REMOTE]);
    expect(drafts[0].optionImages.A.src).toBe(REMOTE);
  });
});

describe('mapCanvasQuizzes: formula (calculated) questions', () => {
  // The real shape: a pH question with one variable sampled to 3 decimals, a
  // base-10 log, an absolute tolerance, and Canvas's precomputed answers.
  const PH = {
    title: 'Q05',
    stemHtml: '<div><p>What is the pH of a [x] M aqueous solution of HCl? [A] stays as written.</p></div>',
    formula: '-1.0*log(x,10)',
    variables: [{ name: 'x', min: '0.03', max: '0.9', scale: 3 }],
    varSets: [
      { ident: '4700', vars: { x: '0.088' }, answer: '1.06' },
      { ident: '522', vars: { x: '0.5' }, answer: '0.3' },
    ],
    tolerance: '0.05',
    decimalPlaces: 2,
  };
  const calcDraft = (extra = {}) => onlyDraft(calculatedItem({ ident: 'gcalc1', ...extra }));
  const calcSkip = (extra = {}) => onlySkip(calculatedItem({ ident: 'gcalc2', ...extra })).reason;
  const MISMATCH = "For Canvas's sample values x = 3.0, GRASP's formula gives 9 where Canvas recorded 7.0. Check the formula.";

  // What saveQuestion checks, then a student attempt: sampled values render
  // into the stem and the formula evaluates at them.
  function expectUsable(payload) {
    const tolerance = CalculationQuestion.normalizeTolerance(payload.calculationTolerance);
    expect(() => CalculationQuestion.validateCalculationDefinition({
      formula: payload.calculationFormula,
      variableSpecs: payload.calculationVariables,
      stem: payload.stem,
      tolerance,
    })).not.toThrow();
    const values = CalculationQuestion.generateVariableValues(payload.calculationVariables);
    const rendered = CalculationQuestion.renderCalculationTemplate(payload.stem, values, payload.calculationVariables);
    expect([...rendered.unknownPlaceholderNames]).toEqual([]);
    expect(Number.isFinite(CalculationQuestion.evaluateCalculationFormula(payload.calculationFormula, values))).toBe(true);
    return rendered;
  }

  test('maps a real-shaped pH question to a calculation question with a variable', () => {
    const draft = calcDraft(PH);

    expect(draft.payload).toEqual({
      questionType: 'calculation',
      // "Q05" is a stale question number, so the slot name is used, as for every type.
      title: 'Synthetic Quiz – Question 1',
      stem: 'What is the pH of a {{x}} M aqueous solution of HCl? [A] stays as written.',
      bloom: 'Understand',
      calculationFormula: '-1.0*log10(x)',
      calculationVariables: [{ name: 'x', min: 0.03, max: 0.9, decimals: 3 }],
      calculationAnswerDecimals: 2,
      calculationTolerance: { mode: 'absolute', value: 0.05 },
    });
    expect(draft.warnings).toEqual([]);
    expect(draft.stemImages).toEqual([]);
    const rendered = expectUsable(draft.payload);
    expect([...rendered.referencedVariableNames]).toEqual(['x']);
    expect(CalculationQuestion.evaluateCalculationFormula(draft.payload.calculationFormula, { x: 0.088 })).toBeCloseTo(1.0555, 4);
  });

  test.each([
    ['an absolute margin', '1.0', { mode: 'absolute', value: 1 }],
    ['a percent margin', '3%', { mode: 'percent', value: 3 }],
    ['a decimal margin', '0.002', { mode: 'absolute', value: 0.002 }],
    ['no margin', '0.0', { mode: 'absolute', value: 0 }],
  ])('maps %s', (_, tolerance, expected) => {
    expect(calcDraft({ tolerance }).payload.calculationTolerance).toEqual(expected);
  });

  test('treats a missing tolerance as exact', () => {
    const xml = calculatedItem({ ident: 'gcalcnotol' }).replace(/<answer_tolerance>[^<]*<\/answer_tolerance>/, '');
    expect(onlyDraft(xml).payload.calculationTolerance).toEqual({ mode: 'absolute', value: 0 });
  });

  test('samples a variable with scale 0 as whole numbers and keeps other scales as decimals', () => {
    const draft = calcDraft({
      stemHtml: '<div><p>[w] moles from [x] K to [z] K over [y] L.</p></div>',
      formula: 'w*0.08206*(z-x)/y',
      variables: [
        { name: 'w', min: '0.2', max: '15.0', scale: 1 },
        { name: 'x', min: '600.0', max: '900.0', scale: 0 },
        { name: 'y', min: '6.0', max: '65.0', scale: 1 },
        { name: 'z', min: '300.0', max: '550.0', scale: 0 },
      ],
      varSets: [{ ident: '1', vars: { w: '1.7', x: '781.0', y: '40.8', z: '400.0' }, answer: '-1.30' }],
      tolerance: '0.05',
      decimalPlaces: 2,
    });

    expect(draft.payload.calculationVariables).toEqual([
      { name: 'w', min: 0.2, max: 15, decimals: 1 },
      { name: 'x', min: 600, max: 900, integerOnly: true },
      { name: 'y', min: 6, max: 65, decimals: 1 },
      { name: 'z', min: 300, max: 550, integerOnly: true },
    ]);
    expect(draft.warnings).toEqual([]);
    expectUsable(draft.payload);
  });

  test('keeps a variable the stem shows but the formula ignores, as 3 of the real questions do', () => {
    const draft = calcDraft({
      stemHtml: '<div><p>Mix [x] mL of [y] M acid with [x] mL of [y] M base.</p></div>',
      formula: '14+log(sqrt(y*5.5556*10^-10/2))',
      variables: [{ name: 'x', min: '25.0', max: '200.0', scale: 2 }, { name: 'y', min: '0.1', max: '0.8', scale: 2 }],
      varSets: [{ ident: '1', vars: { x: '80.02', y: '0.15' }, answer: '8.81' }],
      tolerance: '0.05',
      decimalPlaces: 2,
    });

    expect(draft.payload.stem).toBe('Mix {{x}} mL of {{y}} M acid with {{x}} mL of {{y}} M base.');
    expect(draft.warnings).toEqual([]);
    expectUsable(draft.payload);
  });

  test('tells a declared [a] from a chemistry [A] and splits braces GRASP would read as placeholders', () => {
    const draft = calcDraft({
      stemHtml: '<div><p>[A] is [a] M; {{a}} and {a} are printed; \\(\\frac{a}{2}\\) and {b} too.</p></div>',
      formula: '2*a',
      variables: [{ name: 'a', min: '1.0', max: '9.0', scale: 0 }],
      varSets: [{ ident: '1', vars: { a: '3.0' }, answer: '6.0' }],
    });

    expect(draft.payload.stem).toBe('[A] is {{a}} M; { { a} } and { a} are printed; \\(\\frac{ a}{2}\\) and {b} too.');
    const rendered = expectUsable(draft.payload);
    expect(rendered.text).toMatch(/^\[A\] is \d M; \{ \{ a\} \} and \{ a\} are printed; \\\(\\frac\{ a\}\{2\}\\\) and \{b\} too\.$/);
  });

  test.each([
    ['a base-10 log', 'log(x)', { x: '1000.0' }, '3.0', 'log10(x)'],
    ['a two-argument log', 'log(x, 3)', { x: '81.0' }, '4.0', '(ln(x)/ln(3))'],
    ['e as a power', 'e^x', { x: '2.0' }, '7.0', 'E^x'],
    ['a factorial and pi', 'fact(x)*pi()', { x: '3.0' }, '19.0', 'fac(x)*PI'],
    ['implicit multiplication', '5x', { x: '3.0' }, '15.0', '5*x'],
  ])('translates %s and confirms it against the recorded answer', (_, formula, vars, answer, translated) => {
    const draft = calcDraft({ formula, varSets: [{ ident: '1', vars, answer }] });

    expect(draft.payload.calculationFormula).toBe(translated);
    expect(draft.warnings).toEqual([]);
  });

  test('combines several formula lines into one', () => {
    const draft = calcDraft({
      formulas: ['k = 2*x', 'm = k + 1', 'm * k'],
      varSets: [{ ident: '1', vars: { x: '3.0' }, answer: '42.0' }],
    });

    expect(draft.payload.calculationFormula).toBe('((2*x)+1)*(2*x)');
    expect(draft.warnings).toEqual([]);
    expectUsable(draft.payload);
  });

  test("saves a Draft with both numbers when GRASP's formula disagrees with Canvas's recorded answers", () => {
    const draft = calcDraft({
      formula: 'x*3',
      varSets: [{ ident: '1', vars: { x: '2.0' }, answer: '6.0' }, { ident: '2', vars: { x: '3.0' }, answer: '7.0' }],
    });

    expect(draft.payload.calculationFormula).toBe('x*3');
    expect(draft.warnings).toEqual([MISMATCH]);
  });

  test('warns when the formula gives no number for a recorded value set', () => {
    const draft = calcDraft({
      formula: 'sqrt(x)',
      variables: [{ name: 'x', min: '-5.0', max: '5.0', scale: 0 }],
      varSets: [{ ident: '1', vars: { x: '-4.0' }, answer: '2.0' }],
    });

    expect(draft.warnings).toEqual([
      "For Canvas's sample values x = -4.0, GRASP's formula gives no number (a division by zero, or a log or root of a negative number) where Canvas recorded 2.0. Check the formula.",
    ]);
  });

  test('accepts a recorded answer that Canvas rounded, and warns when no value set can be checked', () => {
    // 100*(-1+60)/(2*60) = 49.1666…, recorded as 49.0 at 0 decimal places.
    const rounded = calcDraft({
      formula: '100*(y+x)/(2*x)',
      variables: [{ name: 'x', min: '45.0', max: '100.0', scale: 0 }, { name: 'y', min: '-45.0', max: '45.0', scale: 0 }],
      varSets: [{ ident: '1', vars: { x: '60.0', y: '-1.0' }, answer: '49.0' }],
    });
    expect(rounded.warnings).toEqual([]);

    const unchecked = calcDraft({ varSets: [] });
    expect(unchecked.warnings).toEqual(["Canvas gave no sample values for this formula, so GRASP's version of it could not be checked."]);
  });

  test.each([
    ['a list function', { formula: 'mean(x, 2)' }, "The formula uses mean(), which GRASP doesn't support."],
    ['an undeclared name', { formula: '2*k' }, 'The formula uses "k", which isn\'t one of the question\'s variables.'],
    ['a variable used like a function', { formula: 'x(2)' }, 'The formula uses the variable "x" like a function.'],
    ['no formula', { formulas: [''] }, 'The formula question has no formula.'],
    ['formula lines that do not define values', { formulas: ['2*x', 'x'] }, 'The formula has several lines; GRASP can only combine them when every line but the last reads "name = expression".'],
    ['an answer line with an equals sign', { formulas: ['k = 2*x', 'y = k'] }, 'The formula has several lines; GRASP can only combine them when every line but the last reads "name = expression".'],
    ['a variable name GRASP cannot use', { variables: [{ name: 'x-1', min: '1.0', max: '9.0', scale: 0 }], formula: '2' }, 'The variable name "x-1" isn\'t one GRASP can use: letters, digits and underscores, starting with a letter.'],
    ['a variable named after a constant', { variables: [{ name: 'e', min: '1.0', max: '9.0', scale: 0 }], formula: '2*e' }, 'The variable "e" is named after a math constant, which GRASP reserves.'],
    ['two variables with one name', { variables: [{ name: 'x', min: '1.0', max: '9.0', scale: 0 }, { name: 'x', min: '1.0', max: '2.0', scale: 0 }] }, 'Two variables are both named "x".'],
    ['a range that is not numbers', { variables: [{ name: 'x', min: 'one', max: '9.0', scale: 0 }] }, 'The range of the variable "x" isn\'t a pair of numbers.'],
    ['an empty range', { variables: [{ name: 'x', min: '9.0', max: '1.0', scale: 0 }] }, 'The range of the variable "x" has its lowest value above its highest.'],
    ['too many variable decimals', { variables: [{ name: 'x', min: '1.0', max: '9.0', scale: 9 }] }, 'The variable "x" is sampled to 9 decimal places; GRASP supports 0 to 8.'],
    ['no whole number in an integer range', { variables: [{ name: 'x', min: '1.2', max: '1.8', scale: 0 }] }, 'There is no whole number between 1.2 and 1.8 for the variable "x".'],
    ['a tolerance that is not a number', { tolerance: 'close' }, 'The answer tolerance "close" isn\'t a number of 0 or more.'],
    ['a negative tolerance', { tolerance: '-1' }, 'The answer tolerance "-1" isn\'t a number of 0 or more.'],
    ['a percent tolerance above 100', { tolerance: '150%' }, 'The answer tolerance is 150%; GRASP percent tolerances go up to 100%.'],
    ['too many answer decimals', { decimalPlaces: 13 }, 'The answer is shown to 13 decimal places; GRASP supports 0 to 12.'],
  ])('skips a formula question with %s', (_, extra, reason) => {
    expect(calcSkip(extra)).toBe(reason);
  });

  test('skips a formula question whose answer precision is missing', () => {
    const xml = calculatedItem({ ident: 'gcalcnodp' }).replace(' decimal_places="0"', '');
    expect(onlySkip(xml).reason).toBe('The answer is shown to an unknown number of decimal places; GRASP supports 0 to 12.');
  });

  test('skips a formula question with no <calculated> block', () => {
    const xml = calculatedItem({ ident: 'gcalcnoblock' }).replace(/<itemproc_extension>[\s\S]*<\/itemproc_extension>/, '');
    expect(onlySkip(xml).reason).toBe('The formula question has no formula.');
  });

  test('skips, with its reason, a formula GRASP itself would refuse to save', () => {
    // Parses here but not in expr-eval: a dangling operator.
    expect(calcSkip({ formula: 'x+' })).toMatch(/^GRASP can't use the formula: /);
  });

  test('warns once when Canvas feedback is dropped and keeps the Canvas title or the slot name like a numerical question', () => {
    const withFeedback = calcDraft({ generalFeedback: { general: '<p>Use pH = -log[H+].</p>' } });
    expect(withFeedback.warnings).toEqual(['Canvas feedback was not imported (GRASP has no feedback for this question type).']);

    const quiz = mapSlots([groupSection({ ident: 'gcalcgroup', title: 'Acids', items: [calculatedItem({ ident: 'gcalc3', title: 'Question 2' })] })]);
    expect(quiz.slots[0].questions[0].payload.title).toBe('Synthetic Quiz – Acids');
  });

  test('counts an imported formula question in the picks note and the points check', () => {
    const quiz = mapSlots([
      groupSection({ ident: 'gpickcalc', title: 'Q01', pick: 2, items: [calculatedItem({ ident: 'g1' }), calculatedItem({ ident: 'g2' })] }),
      groupSection({ ident: 'gzerocalc', title: 'Q02', pointsPerItem: 0, items: [calculatedItem({ ident: 'g3' })] }),
    ]);

    expect(quiz.skipped).toEqual([]);
    expect(quiz.notes).toEqual([
      'Canvas gives no points for Q02; in GRASP its questions count like any other.',
      "Canvas picked 2 questions from 'Q01'; GRASP gives one question per objective.",
    ]);
  });
});
