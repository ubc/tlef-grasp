// Synthetic Canvas Classic Quizzes QTI 1.2 XML for tests (#140).
//
// The output mirrors what Canvas writes, checked against real quiz exports:
// two-space indentation, question HTML entity-escaped inside <mattext> with its
// continuation lines left at column 0, item metadata in the order question_type,
// points_possible, original_answer_ids, assessment_question_identifierref,
// <decvar>, respcondition continue="No", groups as <section>s with
// selection_ordering, one response_lid per fill-in blank, and numerical answers
// as <or><varequal/><and><vargte/><varlte/></and></or>.
//
// Shapes with no real sample are written the way Canvas's QTI exporter does, as
// far as we know it: true/false, short answer, per-answer feedback, general
// feedback, several numerical answers, range-only and exclusive-bound numerical
// answers, question-bank groups and nested sections. Their builders say so.
//
// Every builder returns a string and has no side effects. Text is synthetic.

const MC = 'multiple_choice_question';
const TF = 'true_false_question';
const MA = 'multiple_answers_question';

const DEFAULT_STEM = '<div>\n<p>Which synthetic statement is correct?</p>\n</div>';

function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}

function attrs(map = {}) {
  return Object.entries(map)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
    .join('');
}

// Indents markup lines only. A line that does not start with a tag continues a
// <mattext> value; Canvas leaves those at column 0 and indenting them would
// change the text.
function indent(xml, by = 2) {
  const pad = ' '.repeat(by);
  return xml
    .split('\n')
    .map((line) => (/^\s*</.test(line) ? pad + line : line))
    .join('\n');
}

function el(name, attributes, children = []) {
  const kids = children.filter(Boolean);
  const open = `<${name}${attrs(attributes)}`;
  if (!kids.length) return `${open}/>`;
  return `${open}>\n${kids.map((child) => indent(child)).join('\n')}\n</${name}>`;
}

function textEl(name, attributes, text) {
  return `<${name}${attrs(attributes)}>${escapeText(text)}</${name}>`;
}

// Canvas prints whole-number floats as "1.0".
function canvasNumber(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value.toFixed(1) : String(value);
  return String(value);
}

function metaField(label, entry) {
  return el('qtimetadatafield', {}, [textEl('fieldlabel', {}, label), textEl('fieldentry', {}, entry)]);
}

function material(text, texttype = 'text/html') {
  return el('material', {}, [textEl('mattext', { texttype }, text)]);
}

const decvar = () =>
  el('outcomes', {}, [el('decvar', { maxvalue: '100', minvalue: '0', varname: 'SCORE', vartype: 'Decimal' })]);

const scoreSet = (value = '100') => textEl('setvar', { action: 'Set', varname: 'SCORE' }, value);

const feedbackRef = (linkrefid) => el('displayfeedback', { feedbacktype: 'Response', linkrefid });

// <other/> condition that only shows feedback (general_fb / general_incorrect_fb).
const otherFeedback = (linkrefid) =>
  el('respcondition', { continue: 'Yes' }, [el('conditionvar', {}, [el('other')]), feedbackRef(linkrefid)]);

// Feedback is HTML; pass { text } for a plain-text comment.
function itemFeedback(ident, value) {
  const mattext =
    typeof value === 'string'
      ? textEl('mattext', { texttype: 'text/html' }, value)
      : textEl('mattext', { texttype: 'text/plain' }, value.text);
  return el('itemfeedback', { ident }, [el('flow_mat', {}, [el('material', {}, [mattext])])]);
}

// generalFeedback: { general, correct, incorrect } -> itemfeedback elements.
function generalFeedbackItems(generalFeedback = {}) {
  return [
    generalFeedback.general && itemFeedback('general_fb', generalFeedback.general),
    generalFeedback.correct && itemFeedback('correct_fb', generalFeedback.correct),
    generalFeedback.incorrect && itemFeedback('general_incorrect_fb', generalFeedback.incorrect),
  ];
}

function itemShell({
  ident,
  title,
  type,
  points = 1,
  answerIds = [],
  calculatorType,
  scoringAlgorithm,
  presentation,
  resprocessing,
  extra = [],
}) {
  return el('item', { ident, title }, [
    el('itemmetadata', {}, [
      el('qtimetadata', {}, [
        metaField('question_type', type),
        metaField('points_possible', canvasNumber(points)),
        metaField('original_answer_ids', answerIds.join(',')),
        metaField('assessment_question_identifierref', `aq_${ident}`),
        calculatorType && metaField('calculator_type', calculatorType),
        scoringAlgorithm && metaField('scoring_algorithm', scoringAlgorithm),
      ]),
    ]),
    el('presentation', {}, presentation),
    resprocessing && el('resprocessing', {}, resprocessing),
    ...extra,
  ]);
}

/**
 * Multiple choice, true/false or multiple answers.
 * choices: [{ ident, text }] (text/plain) or [{ ident, html }] (text/html); `texttype` overrides.
 * correct: one choice ident or an array; omitted -> the first choice; null or [] -> none.
 *   Canvas writes one scoring condition for MC; an array for MC/TF writes one per ident
 *   (no real sample; it is how an export with two correct answers would read).
 * answerFeedback: { [choiceIdent]: html | { text } } -> continue="Yes" conditions before the
 *   scoring one, as Canvas's exporter writes answer comments (no real sample).
 * generalFeedback: { general, correct, incorrect } -> general_fb / correct_fb /
 *   general_incorrect_fb (no real sample).
 * shuffle: true writes render_choice shuffle="Yes" (New Quizzes).
 */
function mcItem({
  ident,
  title = 'Question',
  stemHtml = DEFAULT_STEM,
  choices,
  correct,
  answerFeedback = {},
  generalFeedback = {},
  type = MC,
  points = 1,
  calculatorType,
  scoringAlgorithm,
  shuffle = false,
} = {}) {
  const options =
    choices ||
    (type === TF
      ? [{ ident: '1001', text: 'True' }, { ident: '1002', text: 'False' }]
      : [
        { ident: '1001', text: 'Synthetic option one' },
        { ident: '1002', text: 'Synthetic option two' },
        { ident: '1003', text: 'Synthetic option three' },
        { ident: '1004', text: 'Synthetic option four' },
      ]);
  let correctIdents;
  if (correct === undefined) correctIdents = [options[0].ident];
  else correctIdents = correct === null ? [] : [].concat(correct);

  const labels = options.map((choice) =>
    el('response_label', { ident: choice.ident }, [
      material(
        choice.html !== undefined ? choice.html : choice.text,
        choice.texttype || (choice.html !== undefined ? 'text/html' : 'text/plain'),
      ),
    ]));

  const answerConditions = options
    .filter((choice) => answerFeedback[choice.ident] !== undefined)
    .map((choice) =>
      el('respcondition', { continue: 'Yes' }, [
        el('conditionvar', {}, [textEl('varequal', { respident: 'response1' }, choice.ident)]),
        feedbackRef(`${choice.ident}_fb`),
      ]));

  let scoring;
  if (type === MA) {
    // One condition: every correct answer chosen and every other one not, in answer order.
    scoring = correctIdents.length
      ? [
        el('respcondition', { continue: 'No' }, [
          el('conditionvar', {}, [
            el(
              'and',
              {},
              options.map((choice) =>
                (correctIdents.includes(choice.ident)
                  ? textEl('varequal', { respident: 'response1' }, choice.ident)
                  : el('not', {}, [textEl('varequal', { respident: 'response1' }, choice.ident)]))),
            ),
          ]),
          scoreSet(),
          generalFeedback.correct && feedbackRef('correct_fb'),
        ]),
      ]
      : [];
  } else {
    scoring = correctIdents.map((id) =>
      el('respcondition', { continue: 'No' }, [
        el('conditionvar', {}, [textEl('varequal', { respident: 'response1' }, id)]),
        scoreSet(),
        generalFeedback.correct && feedbackRef('correct_fb'),
      ]));
  }

  return itemShell({
    ident,
    title,
    type,
    points,
    answerIds: options.map((choice) => choice.ident),
    calculatorType,
    scoringAlgorithm,
    presentation: [
      material(stemHtml),
      el('response_lid', { ident: 'response1', rcardinality: type === MA ? 'Multiple' : 'Single' }, [
        el('render_choice', shuffle ? { shuffle: 'Yes' } : {}, labels),
      ]),
    ],
    resprocessing: [
      decvar(),
      generalFeedback.general && otherFeedback('general_fb'),
      ...answerConditions,
      ...scoring,
      generalFeedback.incorrect && otherFeedback('general_incorrect_fb'),
    ],
    extra: [
      ...generalFeedbackItems(generalFeedback),
      ...options
        .filter((choice) => answerFeedback[choice.ident] !== undefined)
        .map((choice) => itemFeedback(`${choice.ident}_fb`, answerFeedback[choice.ident])),
    ],
  });
}

/**
 * Numerical question. answers: [{ exact, min, max, minExclusive, maxExclusive, id, feedback }],
 * values as strings (written as-is). One scoring condition per answer.
 *   exact + bounds: the real Canvas shape (<or> exact, <and> bounds </and></or>).
 *   exact only: a lone <varequal> (no real sample).
 *   bounds only: <vargte>/<varlte> directly in the condition, as Canvas writes a range
 *     answer (no real sample). minExclusive/maxExclusive write vargt/varlt.
 * feedback on an answer becomes a displayfeedback inside its scoring condition.
 */
function numericalItem({
  ident,
  title = 'Question',
  stemHtml = '<div>\n<p>Synthetic numerical question.</p>\n</div>',
  answers = [{ exact: '1.0', min: '1.0', max: '1.0' }],
  generalFeedback = {},
  points = 1,
  calculatorType,
} = {}) {
  const withIds = answers.map((answer, index) => ({ ...answer, id: answer.id || String(2001 + index) }));
  const conditions = withIds.map((answer) => {
    const hasBounds = answer.min != null || answer.max != null;
    const bounds = [
      answer.min != null && textEl(answer.minExclusive ? 'vargt' : 'vargte', { respident: 'response1' }, answer.min),
      answer.max != null && textEl(answer.maxExclusive ? 'varlt' : 'varlte', { respident: 'response1' }, answer.max),
    ];
    let tests;
    if (answer.exact != null && hasBounds) {
      tests = [el('or', {}, [textEl('varequal', { respident: 'response1' }, answer.exact), el('and', {}, bounds)])];
    } else if (answer.exact != null) {
      tests = [textEl('varequal', { respident: 'response1' }, answer.exact)];
    } else {
      tests = bounds;
    }
    return el('respcondition', { continue: 'No' }, [
      el('conditionvar', {}, tests),
      scoreSet(),
      answer.feedback && feedbackRef(`${answer.id}_fb`),
    ]);
  });
  return itemShell({
    ident,
    title,
    type: 'numerical_question',
    points,
    answerIds: withIds.map((answer) => answer.id),
    calculatorType,
    presentation: [
      material(stemHtml),
      el('response_str', { ident: 'response1', rcardinality: 'Single' }, [
        el('render_fib', { fibtype: 'Decimal' }, [el('response_label', { ident: 'answer1' })]),
      ]),
    ],
    resprocessing: [
      decvar(),
      generalFeedback.general && otherFeedback('general_fb'),
      ...conditions,
      generalFeedback.incorrect && otherFeedback('general_incorrect_fb'),
    ],
    extra: [
      ...generalFeedbackItems(generalFeedback),
      ...withIds.filter((answer) => answer.feedback).map((answer) => itemFeedback(`${answer.id}_fb`, answer.feedback)),
    ],
  });
}

/**
 * Fill in multiple blanks (or, with type 'multiple_dropdowns_question', dropdowns).
 * blanks: [{ id, answers: [text | { ident, text }], correct = 0 }]. As in real exports the
 * scoring condition of each blank names one label only (index `correct`), with
 * setvar Add 100/blanks.
 */
function fimbItem({
  ident,
  title = 'Question',
  stemHtml,
  blanks = [{ id: 'x1', answers: ['synthetic answer'] }],
  type = 'fill_in_multiple_blanks_question',
  points = 1,
} = {}) {
  let nextIdent = 3001;
  const withIdents = blanks.map((blank) => ({
    ...blank,
    answers: blank.answers.map((answer) =>
      (typeof answer === 'string' ? { ident: String(nextIdent++), text: answer } : answer)),
  }));
  const stem = stemHtml || `<div>The synthetic answer is ${blanks.map((b) => `[${b.id}]`).join(' and ')}</div>`;
  return itemShell({
    ident,
    title,
    type,
    points,
    answerIds: withIdents.flatMap((blank) => blank.answers.map((answer) => answer.ident)),
    presentation: [
      material(stem),
      ...withIdents.map((blank) =>
        el('response_lid', { ident: `response_${blank.id}` }, [
          el('material', {}, [textEl('mattext', {}, blank.id)]),
          el(
            'render_choice',
            {},
            blank.answers.map((answer) =>
              el('response_label', { ident: answer.ident }, [material(answer.text, 'text/plain')])),
          ),
        ])),
    ],
    resprocessing: [
      decvar(),
      ...withIdents
        .filter((blank) => blank.answers.length)
        .map((blank) =>
          el('respcondition', {}, [
            el('conditionvar', {}, [
              textEl('varequal', { respident: `response_${blank.id}` }, blank.answers[blank.correct || 0].ident),
            ]),
            textEl('setvar', { varname: 'SCORE', action: 'Add' }, (100 / withIdents.length).toFixed(2)),
          ])),
    ],
  });
}

/**
 * Short answer (no real sample): every accepted answer is a <varequal> in one scoring
 * condition, as Canvas's exporter writes it.
 */
function shortAnswerItem({
  ident,
  title = 'Question',
  stemHtml = '<div>\n<p>Name the synthetic compound.</p>\n</div>',
  answers = ['synthetic answer'],
  generalFeedback = {},
  points = 1,
} = {}) {
  return itemShell({
    ident,
    title,
    type: 'short_answer_question',
    points,
    answerIds: answers.map((_, index) => String(5001 + index)),
    presentation: [
      material(stemHtml),
      el('response_str', { ident: 'response1', rcardinality: 'Single' }, [
        el('render_fib', {}, [el('response_label', { ident: 'answer1', rshuffle: 'No' })]),
      ]),
    ],
    resprocessing: [
      decvar(),
      generalFeedback.general && otherFeedback('general_fb'),
      el('respcondition', { continue: 'No' }, [
        el('conditionvar', {}, answers.map((answer) => textEl('varequal', { respident: 'response1' }, answer))),
        scoreSet(),
        generalFeedback.correct && feedbackRef('correct_fb'),
      ]),
      generalFeedback.incorrect && otherFeedback('general_incorrect_fb'),
    ],
    extra: generalFeedbackItems(generalFeedback),
  });
}

/**
 * Formula question, real shape: an <other/> scoring condition plus itemproc_extension.
 * variables: [{ name, min, max, scale }]; varSets: [{ ident, vars: { name: value }, answer }].
 */
function calculatedItem({
  ident,
  title = 'Question',
  stemHtml = '<div>\n<p>Double [x].</p>\n</div>',
  formula = '2*x',
  variables = [{ name: 'x', min: '1.0', max: '9.0', scale: 0 }],
  varSets = [{ ident: '4001', vars: { x: '3' }, answer: '6' }],
  tolerance = '0.0',
  decimalPlaces = 0,
  points = 1,
} = {}) {
  return itemShell({
    ident,
    title,
    type: 'calculated_question',
    points,
    answerIds: varSets.map((set) => set.ident),
    presentation: [
      material(stemHtml),
      el('response_str', { ident: 'response1', rcardinality: 'Single' }, [
        el('render_fib', { fibtype: 'Decimal' }, [el('response_label', { ident: 'answer1' })]),
      ]),
    ],
    resprocessing: [
      decvar(),
      el('respcondition', { title: 'correct' }, [
        el('conditionvar', {}, [el('other')]),
        textEl('setvar', { varname: 'SCORE', action: 'Set' }, '100'),
      ]),
      el('respcondition', { title: 'incorrect' }, [
        el('conditionvar', {}, [el('not', {}, [el('other')])]),
        textEl('setvar', { varname: 'SCORE', action: 'Set' }, '0'),
      ]),
    ],
    extra: [
      el('itemproc_extension', {}, [
        el('calculated', {}, [
          textEl('answer_tolerance', {}, tolerance),
          el('formulas', { decimal_places: String(decimalPlaces) }, [textEl('formula', {}, formula)]),
          el(
            'vars',
            {},
            variables.map((v) =>
              el('var', { name: v.name, scale: String(v.scale) }, [textEl('min', {}, v.min), textEl('max', {}, v.max)])),
          ),
          el(
            'var_sets',
            {},
            varSets.map((set) =>
              el('var_set', { ident: set.ident }, [
                ...Object.entries(set.vars).map(([name, value]) => textEl('var', { name }, value)),
                textEl('answer', {}, set.answer),
              ])),
          ),
        ]),
      ]),
    ],
  });
}

/**
 * Any other Canvas type (essay, matching, file upload, text only, unknown). Only the
 * metadata and stem are realistic; essays get Canvas's free-text response box.
 */
function otherItem({
  ident,
  title = 'Question',
  type = 'essay_question',
  stemHtml = '<div>\n<p>Explain the synthetic result.</p>\n</div>',
  points = 1,
} = {}) {
  const freeText = type === 'essay_question' || type === 'file_upload_question';
  return itemShell({
    ident,
    title,
    type,
    points,
    presentation: [
      material(stemHtml),
      freeText &&
        el('response_str', { ident: 'response1', rcardinality: 'Single' }, [
          el('render_fib', {}, [el('response_label', { ident: 'answer1', rshuffle: 'No' })]),
        ]),
    ],
    resprocessing: [
      decvar(),
      freeText && el('respcondition', { continue: 'No' }, [el('conditionvar', {}, [el('other')])]),
    ],
  });
}

/**
 * A question group. items: item XML strings (a nested groupSection string makes a nested
 * section, which Canvas does not write). sourceBankRef writes <sourcebank_ref> before
 * selection_number, as a group linked to a question bank exports (no real sample).
 */
function groupSection({ ident, title = 'Q01', pick = 1, pointsPerItem = 1, items = [], sourceBankRef = null } = {}) {
  return el('section', { ident, title }, [
    el('selection_ordering', {}, [
      el('selection', {}, [
        sourceBankRef !== null && textEl('sourcebank_ref', {}, sourceBankRef),
        textEl('selection_number', {}, String(pick)),
        pointsPerItem !== null &&
          el('selection_extension', {}, [textEl('points_per_item', {}, canvasNumber(pointsPerItem))]),
      ]),
    ]),
    ...items,
  ]);
}

/**
 * The quiz file. slots: groupSection / item strings in quiz order.
 * newQuizzes: the New Quizzes variant (no encoding in the declaration,
 * external_assignment_id, qmd_timelimit).
 */
function quizXml({
  ident = 'gquiz0001',
  title = 'Synthetic Quiz',
  slots = [],
  newQuizzes = false,
  maxAttempts = 1,
  timeLimit = null,
} = {}) {
  const declaration = newQuizzes ? '<?xml version="1.0"?>' : '<?xml version="1.0" encoding="UTF-8"?>';
  const body = el(
    'questestinterop',
    {
      xmlns: 'http://www.imsglobal.org/xsd/ims_qtiasiv1p2',
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'xsi:schemaLocation':
        'http://www.imsglobal.org/xsd/ims_qtiasiv1p2 http://www.imsglobal.org/xsd/ims_qtiasiv1p2p1.xsd',
    },
    [
      el('assessment', { ident, title, external_assignment_id: newQuizzes ? '9001' : null }, [
        el('qtimetadata', {}, [
          newQuizzes && timeLimit !== null && metaField('qmd_timelimit', String(timeLimit)),
          metaField('cc_maxattempts', String(maxAttempts)),
        ]),
        el('section', { ident: 'root_section' }, slots),
      ]),
    ],
  );
  return `${declaration}\n${body}\n`;
}

/**
 * assessment_meta.xml. Null dates / timeLimit / shuffleAnswers are left out, as Canvas
 * does (New Quizzes writes empty date elements instead). It includes the nested
 * <assignment> block, whose own <title> and dates must not be read as the quiz's;
 * `assignment` overrides its title and dueAt.
 */
function metaXml({
  ident = 'gquiz0001',
  title = 'Synthetic Quiz',
  description = '<p>Synthetic instructions.</p>',
  shuffleAnswers = true,
  cantGoBack = false,
  timeLimit = null,
  dueAt = null,
  unlockAt = null,
  lockAt = null,
  newQuizzes = false,
  assignment = {},
} = {}) {
  const date = (name, value) => {
    if (value !== null && value !== undefined) return textEl(name, {}, value);
    return newQuizzes ? el(name) : null;
  };
  const dates = newQuizzes
    ? [date('due_at', dueAt), date('lock_at', lockAt), date('unlock_at', unlockAt)]
    : [date('lock_at', lockAt), date('unlock_at', unlockAt), date('due_at', dueAt)];
  const assignmentTitle = assignment.title !== undefined ? assignment.title : title;
  const assignmentDue = assignment.dueAt !== undefined ? assignment.dueAt : dueAt;
  const rootAttrs = newQuizzes
    ? {
      xmlns: 'http://canvas.instructure.com/xsd/cccv1p0',
      'xmlns:xsi': 'http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd',
      identifier: ident,
    }
    : {
      identifier: ident,
      xmlns: 'http://canvas.instructure.com/xsd/cccv1p0',
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'xsi:schemaLocation': 'http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd',
    };
  const body = el('quiz', rootAttrs, [
    textEl('title', {}, title),
    textEl('description', {}, description),
    ...dates,
    shuffleAnswers !== null && textEl('shuffle_answers', {}, String(shuffleAnswers)),
    textEl('scoring_policy', {}, 'keep_highest'),
    newQuizzes ? el('hide_results') : textEl('hide_results', {}, ''),
    textEl('quiz_type', {}, 'assignment'),
    textEl('points_possible', {}, '1.0'),
    textEl('show_correct_answers', {}, 'true'),
    textEl('could_be_locked', {}, 'true'),
    timeLimit !== null && textEl('time_limit', {}, String(timeLimit)),
    textEl('allowed_attempts', {}, '3'),
    textEl('one_question_at_a_time', {}, 'false'),
    textEl('cant_go_back', {}, String(cantGoBack)),
    textEl('available', {}, 'true'),
    el('assignment', { identifier: `a_${ident}` }, [
      textEl('title', {}, assignmentTitle),
      assignmentDue !== null ? textEl('due_at', {}, assignmentDue) : null,
      textEl('workflow_state', {}, 'published'),
      textEl('quiz_identifierref', {}, ident),
      textEl('points_possible', {}, '1.0'),
      textEl('grading_type', {}, 'points'),
      textEl('submission_types', {}, 'online_quiz'),
    ]),
    textEl('assignment_group_identifierref', {}, `ag_${ident}`),
  ]);
  return `${newQuizzes ? '<?xml version="1.0"?>' : '<?xml version="1.0" encoding="UTF-8"?>'}\n${body}\n`;
}

module.exports = {
  quizXml,
  groupSection,
  mcItem,
  numericalItem,
  fimbItem,
  shortAnswerItem,
  calculatedItem,
  otherItem,
  metaXml,
};
