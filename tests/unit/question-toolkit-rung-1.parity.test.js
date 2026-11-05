// Temporary parity test for the swap onto @ubc/genai-toolkit-questions, rung 1.
//
// The oracle is the parent commit's code (e3a075e), copied verbatim from
// src/models/questions/MultipleChoiceQuestion.js and MultipleAnswerQuestion.js:
// normalizeOptions and both validateAndNormalize methods, with the
// multiple-answer copy calling the copied normalizeOptions. About 5,000 seeded
// inputs per type go through the oracle and the new validateAndNormalize. They
// must agree exactly: the same result with its keys in the same order, or the
// same thrown error. All text is fabricated.
//
// The next swap PR that merges deletes this file (for rungs 1 to 3, rung 4's).

const NewMultipleChoiceQuestion = require('../../src/models/questions/MultipleChoiceQuestion');
const NewMultipleAnswerQuestion = require('../../src/models/questions/MultipleAnswerQuestion');
const { QUESTION_TYPES } = require('../../src/constants/app-constants');
const {
  MC_OPTION_KEYS,
  MC_MIN_OPTIONS,
  optionKeysOf,
  answerKeysOf,
} = require('../../src/utils/mc-options');

const INPUTS = 5000;

// ---- Oracle: copied verbatim from e3a075e ---------------------------------------

const Oracle = (() => {
  class MultipleChoiceQuestion {
    // The generated options, trimmed, once their semantics check out: at
    // least MC_MIN_OPTIONS, lettered consecutively from A, no two alike.
    // Multiple answer checks its options the same way.
    static normalizeOptions(rawOptions, typeLabel = "multiple-choice") {
        const trimOption = (opt) => ({
            text: String(opt?.text || "").trim(),
            feedback: String(opt?.feedback || "").trim(),
        });

        const keys = optionKeysOf(rawOptions);
        if (keys.length < MC_MIN_OPTIONS) {
            throw new Error(`A ${typeLabel} question needs at least ${MC_MIN_OPTIONS} answer options.`);
        }
        const expectedKeys = MC_OPTION_KEYS.slice(0, keys.length);
        if (keys.some((key, i) => key !== expectedKeys[i])) {
            throw new Error(`Answer options must be lettered consecutively from A (got ${keys.join(", ")}).`);
        }

        const options = Object.fromEntries(keys.map((key) => [key, trimOption(rawOptions[key])]));

        const optionTexts = keys.map((k) => options[k].text.toLowerCase());
        if (new Set(optionTexts).size < keys.length) {
            throw new Error("Two or more answer options have identical or near-identical text.");
        }
        return { keys, options };
    }

    // Shape (options keyed by letter, each {text, feedback}; correctAnswer one of
    // the letters) is guaranteed by the JSON schema. We only check semantics the
    // schema can't express (consecutive lettering, distinct options) and
    // normalize the result.
    static validateAndNormalize(data) {
        const { keys, options } = MultipleChoiceQuestion.normalizeOptions(data.options);

        const correctAnswer = String(data.correctAnswer || "").trim().toUpperCase();
        if (!keys.includes(correctAnswer)) {
            throw new Error(`correctAnswer must be one of ${keys.join(", ")}.`);
        }
        const missingFeedback = keys.filter(
            (k) => k !== correctAnswer && !options[k].feedback
        );
        if (missingFeedback.length > 0) {
            throw new Error(
                `Incorrect option(s) ${missingFeedback.join(", ")} are missing feedback explaining the misconception.`
            );
        }

        return {
            type: QUESTION_TYPES.MULTIPLE_CHOICE,
            questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
            question: data.question.trim(),
            // scratchwork is intentionally omitted — used only for chain-of-thought during generation
            options,
            correctAnswer,
            explanation: data.explanation != null ? String(data.explanation) : "",
        };
    }
  }

  class MultipleAnswerQuestion {
    // Shape (options keyed by letter; correctAnswers a list of those letters)
    // is guaranteed by the JSON schema. We check what it can't express: the
    // options' lettering and distinctness, one correct option up to all but
    // one, and feedback on every incorrect option. The stored question keeps
    // the correct letters in correctAnswer, as every multiple-answer question
    // does.
    static validateAndNormalize(data) {
        const { keys, options } = MultipleChoiceQuestion.normalizeOptions(
            data.options,
            "multiple-answer"
        );

        const listed = Array.isArray(data.correctAnswers) ? data.correctAnswers : [];
        const unknown = listed.filter(
            (letter) => !keys.includes(String(letter ?? "").trim().toUpperCase())
        );
        if (unknown.length > 0) {
            throw new Error(`correctAnswers must list only ${keys.join(", ")} (got ${unknown.join(", ")}).`);
        }
        const correctAnswer = answerKeysOf(listed);
        if (correctAnswer.length === 0) {
            throw new Error("correctAnswers must list at least one correct option.");
        }
        if (correctAnswer.length === keys.length) {
            throw new Error("Every option is marked correct; at least one option must be incorrect.");
        }

        const missingFeedback = keys.filter(
            (k) => !correctAnswer.includes(k) && !options[k].feedback
        );
        if (missingFeedback.length > 0) {
            throw new Error(
                `Incorrect option(s) ${missingFeedback.join(", ")} are missing feedback explaining the misconception.`
            );
        }

        return {
            type: QUESTION_TYPES.MULTIPLE_ANSWER,
            questionType: QUESTION_TYPES.MULTIPLE_ANSWER,
            question: data.question.trim(),
            // scratchwork is intentionally omitted — used only for chain-of-thought during generation
            options,
            correctAnswer,
            explanation: data.explanation != null ? String(data.explanation) : "",
        };
    }
  }

  return { MultipleChoiceQuestion, MultipleAnswerQuestion };
})();

// ---- Seeded inputs --------------------------------------------------------------

// xorshift32, local to this file so the inputs depend on nothing under test.
function makeRandom(seed) {
  let state = seed >>> 0 || 1;
  const next = () => {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    return state / 4294967296;
  };
  return {
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (probability) => next() < probability,
    pick: (list) => list[Math.floor(next() * list.length)],
  };
}

// Parsed JSON can hold what String() refuses, so the order of checks can show.
const UNPRINTABLE = JSON.parse('{"toString":1}');
const ALSO_UNPRINTABLE = JSON.parse('{"toString":1,"valueOf":2}');
const OWN_PROTO = JSON.parse('{"__proto__":{"text":"Hidden","feedback":"Hidden"}}');

const TEXTS = [
  'Alpha',
  'alpha',
  '  ALPHA  ',
  '',
  '   ',
  ' Beta﻿',
  ' beta\n',
  'İ',
  'i̇',
  'ß',
  'SS',
  'ΑΣ',
  'ας',
  'ασ',
];
const NON_STRINGS = [
  0,
  1,
  -1,
  1.5,
  true,
  false,
  null,
  [],
  ['Alpha'],
  [[]],
  {},
  { text: 'Nested' },
  UNPRINTABLE,
  ALSO_UNPRINTABLE,
  [UNPRINTABLE],
  OWN_PROTO,
];
const FIELD_VALUES = [...TEXTS, ...NON_STRINGS];
const OPTION_VALUES = [
  'A bare option',
  '',
  0,
  1,
  true,
  false,
  null,
  [],
  ['Listed'],
  {},
  { text: 'Text only' },
  { feedback: 'Feedback only' },
  UNPRINTABLE,
  OWN_PROTO,
];
const OPTION_LISTS = [
  null,
  'A',
  7,
  true,
  false,
  [],
  ['A bare option', 'Another bare option'],
  [{ text: 'First', feedback: 'Why not' }, { text: 'Second', feedback: 'Why not' }],
  Array.from({ length: 12 }, (_, i) => ({ text: `Listed ${i}`, feedback: 'Why not' })),
  {},
  { a: { text: 'Lower', feedback: 'Why not' }, b: { text: 'Case', feedback: 'Why not' } },
];
const EXTRA_KEYS = ['I', 'Z', 'a', '0', 'length', 'toString'];
const STEMS = ['', '   ', null, 5, true, [], {}, ['A listed stem'], UNPRINTABLE];
const EXPLANATIONS = ['', 0, false, true, null, 12.5, [], {}, ['Listed'], UNPRINTABLE];
const WHOLE_RESPONSES = [null, 7, 0, true, false, 'A bare response', '', [], [{ options: {} }], {}];
const BAD_LETTERS = [
  'a',
  ' b ',
  'c\n',
  'Z',
  'I',
  '',
  '  ',
  null,
  0,
  1,
  7,
  true,
  false,
  [],
  ['A'],
  ['A', 'B'],
  {},
  UNPRINTABLE,
  [UNPRINTABLE],
];

const LETTERS = MC_OPTION_KEYS;

function validOptions(count) {
  return Object.fromEntries(
    LETTERS.slice(0, count).map((key, i) => [
      key,
      { text: `Option ${i + 1}`, feedback: `Why option ${i + 1} is a misconception.` },
    ])
  );
}

const isEntry = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

// One of the response's option objects, if it still has any.
function someOption(r, data) {
  if (!isEntry(data.options)) return null;
  const entries = Object.values(data.options).filter(isEntry);
  return entries.length > 0 ? r.pick(entries) : null;
}

const SHARED_CHANGES = [
  (r, data) => {
    data.options = r.pick(OPTION_LISTS);
  },
  (r, data) => {
    if (isEntry(data.options)) delete data.options[r.pick(LETTERS)];
  },
  (r, data) => {
    if (isEntry(data.options)) {
      data.options[r.pick(EXTRA_KEYS)] = { text: 'An extra option', feedback: 'Why not' };
    }
  },
  (r, data) => {
    if (isEntry(data.options)) data.options[r.pick(LETTERS)] = r.pick(OPTION_VALUES);
  },
  // Two options alike once trimmed and lower-cased.
  (r, data) => {
    const [first, second] = [someOption(r, data), someOption(r, data)];
    if (first && second && first !== second) second.text = `  ${String(first.text).toUpperCase()} `;
  },
  (r, data) => {
    const option = someOption(r, data);
    if (option) option.text = r.pick(FIELD_VALUES);
  },
  (r, data) => {
    const option = someOption(r, data);
    if (option) option.feedback = r.pick(FIELD_VALUES);
  },
  (r, data) => {
    const option = someOption(r, data);
    if (option) delete option[r.pick(['text', 'feedback'])];
  },
  (r, data) => {
    data.question = r.pick(STEMS);
  },
  (_r, data) => {
    delete data.question;
  },
  (r, data) => {
    data.explanation = r.pick(EXPLANATIONS);
  },
  (_r, data) => {
    delete data.explanation;
  },
];

const MULTIPLE_CHOICE_CHANGES = [
  ...SHARED_CHANGES,
  (r, data) => {
    data.correctAnswer = r.pick(BAD_LETTERS);
  },
  (_r, data) => {
    delete data.correctAnswer;
  },
];

const MULTIPLE_ANSWER_CHANGES = [
  ...SHARED_CHANGES,
  (r, data) => {
    data.correctAnswers = r.pick(BAD_LETTERS);
  },
  (r, data) => {
    if (Array.isArray(data.correctAnswers)) data.correctAnswers.push(r.pick(BAD_LETTERS));
  },
  (_r, data) => {
    data.correctAnswers = [];
  },
  (_r, data) => {
    delete data.correctAnswers;
  },
  (_r, data) => {
    data.correctAnswers = [...LETTERS];
  },
  // Every option marked correct, whatever the lettering.
  (_r, data) => {
    data.correctAnswers = isEntry(data.options) ? Object.keys(data.options) : [];
  },
];

function applyChanges(r, data, changes) {
  const times = r.pick([0, 0, 1, 1, 1, 2, 3]);
  for (let i = 0; i < times; i += 1) r.pick(changes)(r, data);
  return r.chance(0.05) ? r.pick(WHOLE_RESPONSES) : data;
}

function multipleChoiceInput(r) {
  const count = r.int(2, 8);
  const data = {
    scratchwork: 'Worked reasoning.',
    question: '  A fabricated stem?  ',
    options: validOptions(count),
    correctAnswer: LETTERS[r.int(0, count - 1)],
    explanation: 'A fabricated explanation.',
  };
  if (r.chance(0.5)) data.options[data.correctAnswer].feedback = '';
  return applyChanges(r, data, MULTIPLE_CHOICE_CHANGES);
}

function multipleAnswerInput(r) {
  const count = r.int(2, 8);
  const correct = LETTERS.slice(0, count).filter(() => r.chance(0.4));
  const data = {
    scratchwork: 'Worked reasoning.',
    question: '  A fabricated stem?  ',
    options: validOptions(count),
    correctAnswers: correct.length > 0 ? correct : ['A'],
    explanation: 'A fabricated explanation.',
  };
  if (r.chance(0.5)) {
    data.correctAnswers.forEach((key) => {
      data.options[key].feedback = '';
    });
  }
  return applyChanges(r, data, MULTIPLE_ANSWER_CHANGES);
}

// Where an unprintable value can overtake a check that used to run first. Fixed,
// so they run whatever the generator happens to draw.
const textTrap = { text: UNPRINTABLE, feedback: 'Why not' };
const fine = { text: 'Fine', feedback: 'Why not' };
const PRECEDENCE_TRAPS = [
  null,
  { options: { A: textTrap } },
  { options: { A: fine, C: textTrap } },
  { options: { A: { text: 'Fine', feedback: UNPRINTABLE } } },
  { options: { A: fine, C: { text: 'Other', feedback: UNPRINTABLE } } },
  { options: { A: fine }, correctAnswer: UNPRINTABLE, correctAnswers: [UNPRINTABLE] },
  { options: { A: fine, B: fine }, correctAnswer: UNPRINTABLE, correctAnswers: [UNPRINTABLE] },
  { options: { A: fine, B: textTrap }, correctAnswer: 'A', correctAnswers: ['A'] },
  { options: { A: fine, C: { text: 'Other' } }, correctAnswer: 'A', correctAnswers: ['A'] },
];

// ---- Comparison -----------------------------------------------------------------

// Every key in its order, and arrays told apart from objects. Stored and returned
// JSON keeps that order, so a deep-equal that ignores it would miss a change.
function exact(value) {
  if (value === undefined) return '<undefined>';
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.keys(value).map((key) => [key, exact(value[key])]);
  return Array.isArray(value) ? ['array', entries] : ['object', entries];
}

function outcomeOf(validateAndNormalize, inputJson) {
  const input = JSON.parse(inputJson);
  let outcome;
  try {
    outcome = { returned: exact(validateAndNormalize(input)) };
  } catch (error) {
    outcome = { threw: [error.constructor.name, error.message] };
  }
  return { outcome, inputAfterwards: exact(input) };
}

function compare(oracle, candidate, inputs, classify) {
  const reached = {};
  const mismatches = [];
  inputs.forEach((input) => {
    const inputJson = JSON.stringify(input);
    const before = outcomeOf(oracle, inputJson);
    const after = outcomeOf(candidate, inputJson);
    const label = classify(before.outcome);
    reached[label] = (reached[label] || 0) + 1;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      mismatches.push({ inputJson, before: before.outcome, after: after.outcome });
    }
  });
  return { reached, mismatches };
}

function classifier(patterns) {
  return (outcome) => {
    if (outcome.returned) return 'returned';
    const [, message] = outcome.threw;
    const match = Object.keys(patterns).find((label) => patterns[label].test(message));
    return match || `unexpected: ${message}`;
  };
}

function seededInputs(makeInput, seed) {
  const r = makeRandom(seed);
  return [...PRECEDENCE_TRAPS, ...Array.from({ length: INPUTS }, () => makeInput(r))];
}

const SHARED_OUTCOMES = {
  consecutive: /^Answer options must be lettered consecutively from A \(got .*\)\.$/,
  distinct: /^Two or more answer options have identical or near-identical text\.$/,
  feedback: /^Incorrect option\(s\) .* are missing feedback explaining the misconception\.$/,
  noStem: /^(data\.question\.trim is not a function|Cannot read properties of (undefined|null) \(reading 'trim'\))$/,
  unprintable: /^Cannot convert object to primitive value$/,
  nullResponse: /^Cannot read properties of null \(reading 'options'\)$/,
};

// Enough of each outcome that the agreement isn't an accident of the generator.
const MIN_REACHED = 10;

function expectEveryOutcomeReached(reached, patterns) {
  const tooRare = [...Object.keys(patterns), 'returned'].filter(
    (label) => (reached[label] || 0) < MIN_REACHED
  );
  const unexpected = Object.keys(reached).filter((label) => label.startsWith('unexpected'));
  expect({ tooRare, unexpected, reached }).toEqual({ tooRare: [], unexpected: [], reached });
}

describe('swap parity, rung 1: the toolkit checks a generated question as GRASP did', () => {
  test('multiple choice', () => {
    const patterns = {
      ...SHARED_OUTCOMES,
      tooFew: /^A multiple-choice question needs at least 2 answer options\.$/,
      badAnswer: /^correctAnswer must be one of .*\.$/,
    };
    const { reached, mismatches } = compare(
      (data) => Oracle.MultipleChoiceQuestion.validateAndNormalize(data),
      (data) => NewMultipleChoiceQuestion.validateAndNormalize(data),
      seededInputs(multipleChoiceInput, 0x1a2b3c4d),
      classifier(patterns)
    );

    expect(mismatches.slice(0, 5)).toEqual([]);
    expectEveryOutcomeReached(reached, patterns);
  });

  test('multiple answer', () => {
    const patterns = {
      ...SHARED_OUTCOMES,
      tooFew: /^A multiple-answer question needs at least 2 answer options\.$/,
      unknownLetter: /^correctAnswers must list only .* \(got [\s\S]*\)\.$/,
      noneCorrect: /^correctAnswers must list at least one correct option\.$/,
      allCorrect: /^Every option is marked correct; at least one option must be incorrect\.$/,
    };
    const { reached, mismatches } = compare(
      (data) => Oracle.MultipleAnswerQuestion.validateAndNormalize(data),
      (data) => NewMultipleAnswerQuestion.validateAndNormalize(data),
      seededInputs(multipleAnswerInput, 0x5e6f7081),
      classifier(patterns)
    );

    expect(mismatches.slice(0, 5)).toEqual([]);
    expectEveryOutcomeReached(reached, patterns);
  });
});
