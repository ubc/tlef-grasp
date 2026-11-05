// Temporary parity test for the swap onto @ubc/genai-toolkit-questions, rung 2.
//
// The oracle is the parent commit's code (e3a075e), copied verbatim: fnv1a32,
// mulberry32 and seededOrder from src/utils/canvas-qti-map.js, and both
// scramblers from src/controllers/rag-llm.js. Old and new run from the same seed,
// so they see the same numbers, and they must agree exactly over about 5,000
// inputs per function: the same result with its keys in the same order, the same
// thrown error, and for the scramblers the same number of draws and the same log
// line. All text is fabricated.
//
// Contract rule 8 freezes the generator and the hash once 0.1.0 is out, so they
// are compared directly too. That is why this file requires the package itself;
// the app only reaches it through src/utils/question-toolkit.js.
//
// The next swap PR that merges deletes this file (for rungs 1 to 3, rung 4's).

const fs = require('fs');
const path = require('path');
const { fnv1a32Utf8, mulberry32 } = require('@ubc/genai-toolkit-questions');
const { seededOrder, shuffledValues } = require('../../src/utils/question-toolkit');
const { MC_OPTION_KEYS, optionKeysOf } = require('../../src/utils/mc-options');

const INPUTS = 5000;

// ---- Oracle: copied verbatim from e3a075e ---------------------------------------

const Oracle = (() => {
// 32-bit FNV-1a over the UTF-8 bytes.
function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(String(text), 'utf8')) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates over the indexes 0..n-1.
function seededOrder(n, seedText) {
  const random = mulberry32(fnv1a32(seedText));
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// Shuffle an MCQ's option lettering so the correct answer isn't always in
// the same position. Must run immediately when a question (or a fix) is
// produced — before it's pushed to conversation history or reviewed — and
// never again after that. Scrambling later would desync whichever letter a
// reviewer's issue text names (shown to the instructor via reviewIssue /
// autoFixReason) from the lettering the instructor actually ends up seeing,
// since nothing re-derives that text after a later shuffle.
function scrambleMultipleChoiceOptions(questionData) {
  if (!questionData.options || !questionData.correctAnswer || !questionData.options[questionData.correctAnswer]) {
    return;
  }
  const optionKeys = optionKeysOf(questionData.options);
  const optionValues = optionKeys.map(k => questionData.options[k]);

  for (let j = optionValues.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [optionValues[j], optionValues[k]] = [optionValues[k], optionValues[j]];
  }

  const originalCorrectValue = questionData.options[questionData.correctAnswer];
  let newCorrectKey = questionData.correctAnswer;

  for (let j = 0; j < optionKeys.length; j++) {
    const key = optionKeys[j];
    questionData.options[key] = optionValues[j];
    if (optionValues[j] === originalCorrectValue) {
      newCorrectKey = key;
    }
  }

  const correctOptionLetter = questionData.correctAnswer;
  questionData.correctAnswer = newCorrectKey;
  console.log(`🔀 Programmatically shuffled correct answer from ${correctOptionLetter} to ${newCorrectKey}`);
}

// The multiple-answer counterpart, under the same timing rule: shuffle a raw
// response's options and move each letter in correctAnswers with its option.
// A response naming a letter it has no option for is left alone, so
// validation still refuses it.
function scrambleMultipleAnswerOptions(questionData) {
  if (!questionData.options || !Array.isArray(questionData.correctAnswers)) return;
  const optionKeys = optionKeysOf(questionData.options);
  const correctLetters = questionData.correctAnswers.map((letter) => String(letter ?? '').trim().toUpperCase());
  if (correctLetters.some((letter) => !optionKeys.includes(letter))) return;

  const optionValues = optionKeys.map((k) => questionData.options[k]);
  const correctValues = new Set(correctLetters.map((letter) => questionData.options[letter]));
  for (let j = optionValues.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [optionValues[j], optionValues[k]] = [optionValues[k], optionValues[j]];
  }
  optionKeys.forEach((key, j) => {
    questionData.options[key] = optionValues[j];
  });
  questionData.correctAnswers = optionKeys.filter((key, j) => correctValues.has(optionValues[j]));
  console.log(`🔀 Programmatically shuffled correct answers from ${correctLetters.join(',')} to ${questionData.correctAnswers.join(',')}`);
}

  return {
    fnv1a32,
    mulberry32,
    seededOrder,
    scrambleMultipleChoiceOptions,
    scrambleMultipleAnswerOptions,
  };
})();

// ---- The shipped scramblers -----------------------------------------------------

// The controller keeps its scramblers private, and exporting them for a temporary
// test would change the module. So this compiles their shipped source text, with
// the shipped helpers in scope. The controller tests run them through the handler.
const CONTROLLER_SOURCE = fs.readFileSync(
  path.join(__dirname, '../../src/controllers/rag-llm.js'),
  'utf8'
);

function shippedFunctionSource(name) {
  const start = CONTROLLER_SOURCE.indexOf(`function ${name}(`);
  const end = CONTROLLER_SOURCE.indexOf('\n}\n', start);
  if (start === -1 || end === -1) throw new Error(`rag-llm.js has no function ${name}`);
  return CONTROLLER_SOURCE.slice(start, end + 2);
}

const SHIPPED_MULTIPLE_CHOICE = shippedFunctionSource('scrambleMultipleChoiceOptions');
const SHIPPED_MULTIPLE_ANSWER = shippedFunctionSource('scrambleMultipleAnswerOptions');

// eslint-disable-next-line no-new-func
const Shipped = new Function(
  'optionKeysOf',
  'shuffledValues',
  `${SHIPPED_MULTIPLE_CHOICE}
${SHIPPED_MULTIPLE_ANSWER}
return { scrambleMultipleChoiceOptions, scrambleMultipleAnswerOptions };`
)(optionKeysOf, shuffledValues);

// ---- Seeded inputs --------------------------------------------------------------

function makeRandom(seed) {
  const next = Oracle.mulberry32(seed);
  return {
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (probability) => next() < probability,
    pick: (list) => list[Math.floor(next() * list.length)],
  };
}

const UNPRINTABLE = JSON.parse('{"toString":1}');

// Text across every UTF-8 length, with paired and lone surrogates.
const CHARACTER_MAKERS = [
  (r) => String.fromCodePoint(r.int(0x00, 0x7f)),
  (r) => String.fromCodePoint(r.int(0x80, 0x7ff)),
  (r) => String.fromCodePoint(r.int(0x800, 0xd7ff)),
  (r) => String.fromCodePoint(r.int(0xe000, 0xffff)),
  (r) => String.fromCodePoint(r.int(0x10000, 0x10ffff)),
  (r) => String.fromCharCode(r.int(0xd800, 0xdbff)),
  (r) => String.fromCharCode(r.int(0xdc00, 0xdfff)),
  (r) =>
    r.pick([
      '\u007f',
      '\u0080',
      '߿',
      'ࠀ',
      '퟿',
      '',
      '�',
      '￿',
      '𐀀',
      '􏿿',
    ]),
];

function anyText(r) {
  return Array.from({ length: r.int(0, 24) }, () => r.pick(CHARACTER_MAKERS)(r)).join('');
}

// Canvas's own idents are g + 32 hex digits.
function canvasIdent(r) {
  const hex = Array.from({ length: 32 }, () => r.int(0, 15).toString(16)).join('');
  return `g${hex}`;
}

const NON_STRING_IDENTS = [
  undefined,
  null,
  0,
  -0,
  1,
  -1,
  1.5,
  NaN,
  Infinity,
  1e21,
  true,
  false,
  [],
  ['a'],
  ['a', 'b'],
  {},
  UNPRINTABLE,
];

function anyIdent(r) {
  const kind = r.int(0, 3);
  if (kind === 0) return canvasIdent(r);
  if (kind === 1) return r.pick(NON_STRING_IDENTS);
  return anyText(r);
}

const ODD_SEEDS = [undefined, null, NaN, Infinity, -Infinity, -0, '', 'text', true, {}, []];

function anySeed(r) {
  switch (r.int(0, 4)) {
    case 0:
      return Oracle.fnv1a32(anyText(r));
    case 1:
      return -r.int(0, 0xffffffff);
    case 2:
      return r.int(0, 0xffffffff) + r.int(1, 99) / 100;
    case 3:
      return r.int(0, 0xffffffff) * 2 ** r.int(1, 21);
    default:
      return r.pick(ODD_SEEDS);
  }
}

const LETTERS = MC_OPTION_KEYS;

const OPTION_LISTS = [
  null,
  '',
  'A',
  0,
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
const OPTION_VALUES = [
  'A bare option',
  'The same bare option',
  'The same bare option',
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
  UNPRINTABLE,
];
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
  '0',
  '1',
  'length',
  'toString',
  'constructor',
  '__proto__',
];
const WHOLE_RESPONSES = [null, 7, 0, true, false, 'A bare response', '', [], [{ options: {} }], {}];

function validOptions(count) {
  return Object.fromEntries(
    LETTERS.slice(0, count).map((key, i) => [
      key,
      { text: `Option ${i + 1}`, feedback: `Why option ${i + 1} is a misconception.` },
    ])
  );
}

const isEntry = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const SHARED_CHANGES = [
  (r, data) => {
    data.options = r.pick(OPTION_LISTS);
  },
  (r, data) => {
    if (isEntry(data.options)) delete data.options[r.pick(LETTERS)];
  },
  (r, data) => {
    if (isEntry(data.options)) data.options[r.pick(['I', 'Z', 'a', '0'])] = { text: 'An extra' };
  },
  (r, data) => {
    if (isEntry(data.options)) data.options[r.pick(LETTERS)] = r.pick(OPTION_VALUES);
  },
  // Bare strings, some identical: the scramblers compare values with ===.
  (r, data) => {
    if (isEntry(data.options)) {
      Object.keys(data.options).forEach((key) => {
        data.options[key] = r.pick(['A bare option', 'The same bare option']);
      });
    }
  },
];

const MULTIPLE_CHOICE_CHANGES = [
  ...SHARED_CHANGES,
  (r, data) => {
    data.correctAnswer = r.pick(BAD_LETTERS);
  },
  (r, data) => {
    data.correctAnswer = r.pick(LETTERS);
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
  // Letters the model wrote in another case or with spaces, which still count.
  (_r, data) => {
    if (Array.isArray(data.correctAnswers)) {
      data.correctAnswers = data.correctAnswers.map((letter) =>
        typeof letter === 'string' ? ` ${letter.toLowerCase()} ` : letter
      );
    }
  },
  (r, data) => {
    if (Array.isArray(data.correctAnswers) && data.correctAnswers.length > 0) {
      data.correctAnswers.push(r.pick(data.correctAnswers));
    }
  },
  (_r, data) => {
    data.correctAnswers = [];
  },
  (_r, data) => {
    delete data.correctAnswers;
  },
];

function applyChanges(r, data, changes) {
  const times = r.pick([0, 0, 1, 1, 2, 3]);
  for (let i = 0; i < times; i += 1) r.pick(changes)(r, data);
  return r.chance(0.04) ? r.pick(WHOLE_RESPONSES) : data;
}

function multipleChoiceResponse(r) {
  const count = r.int(0, 9);
  const data = {
    scratchwork: 'Worked reasoning.',
    question: 'A fabricated stem?',
    options: validOptions(count),
    correctAnswer: r.pick(LETTERS.slice(0, Math.max(count, 1))),
    explanation: 'A fabricated explanation.',
  };
  return applyChanges(r, data, MULTIPLE_CHOICE_CHANGES);
}

function multipleAnswerResponse(r) {
  const count = r.int(0, 9);
  const data = {
    scratchwork: 'Worked reasoning.',
    question: 'A fabricated stem?',
    options: validOptions(count),
    correctAnswers: LETTERS.slice(0, count).filter(() => r.chance(0.4)),
    explanation: 'A fabricated explanation.',
  };
  return applyChanges(r, data, MULTIPLE_ANSWER_CHANGES);
}

// ---- Comparison -----------------------------------------------------------------

// Every key in its order, with undefined and arrays told apart. The scrambled
// response is stored as JSON in the fix context, so key order counts. A scrambler
// also writes letter keys onto array options, which only Object.keys can see.
function exact(value) {
  if (value === undefined) return '<undefined>';
  if (Object.is(value, -0)) return '<-0>';
  if (typeof value === 'number' && !Number.isFinite(value)) return `<${value}>`;
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.keys(value).map((key) => [key, exact(value[key])]);
  return Array.isArray(value) ? ['array', entries] : ['object', entries];
}

function outcomeOf(fn, ...args) {
  try {
    return { returned: exact(fn(...args)) };
  } catch (error) {
    return { threw: [error.constructor.name, error.message] };
  }
}

function expectSameEverywhere(inputs, oldFn, newFn) {
  const mismatches = [];
  inputs.forEach((args) => {
    const before = outcomeOf(oldFn, ...args);
    const after = outcomeOf(newFn, ...args);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      mismatches.push({ args: exact(args), before, after });
    }
  });
  expect(mismatches.slice(0, 5)).toEqual([]);
}

describe('swap parity, rung 2: the toolkit orders options as GRASP did', () => {
  test('fnv1a32Utf8 hashes what fnv1a32 hashed', () => {
    const r = makeRandom(0x11223344);
    const inputs = Array.from({ length: INPUTS }, () => [anyIdent(r)]);
    // Lone surrogates are where a hand-written UTF-8 encoder can part from Buffer.
    const texts = inputs.map(([ident]) => ident).filter((ident) => typeof ident === 'string');
    expect(texts.filter((text) => !text.isWellFormed()).length).toBeGreaterThan(500);
    expect(texts.filter((text) => /[\u{10000}-\u{10ffff}]/u.test(text)).length).toBeGreaterThan(500);

    expectSameEverywhere(inputs, Oracle.fnv1a32, fnv1a32Utf8);
  });

  test('mulberry32 draws what the old mulberry32 drew', () => {
    const r = makeRandom(0x55667788);
    const inputs = Array.from({ length: INPUTS }, () => [anySeed(r)]);
    const draws = (generator) => (seed) => {
      const next = generator(seed);
      return Array.from({ length: 16 }, () => next());
    };

    expectSameEverywhere(inputs, draws(Oracle.mulberry32), draws(mulberry32));
  });

  test('seededOrder gives what the old seededOrder gave', () => {
    const r = makeRandom(0x99aabbcc);
    const inputs = Array.from({ length: INPUTS }, () => [r.int(0, 9), anyIdent(r)]);
    const lengths = new Set(inputs.map(([n]) => n));
    expect(lengths.size).toBe(10);

    expectSameEverywhere(inputs, Oracle.seededOrder, seededOrder);
  });

  describe('scramblers', () => {
    let stream;
    let drawCount;
    let logged;

    beforeEach(() => {
      jest.spyOn(Math, 'random').mockImplementation(() => {
        drawCount += 1;
        return stream();
      });
      jest.spyOn(console, 'log').mockImplementation((...args) => {
        logged.push(args);
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    function runScrambler(scramble, responseJson, seed) {
      const response = JSON.parse(responseJson);
      stream = Oracle.mulberry32(seed);
      drawCount = 0;
      logged = [];
      let threw = null;
      try {
        scramble(response);
      } catch (error) {
        threw = [error.constructor.name, error.message];
      }
      return {
        threw,
        draws: drawCount,
        logged,
        scrambled: exact(response),
        storedAs: JSON.stringify(response),
      };
    }

    function compareScramblers(oldScramble, newScramble, makeResponse, seed) {
      const r = makeRandom(seed);
      const mismatches = [];
      const reached = { shuffled: 0, reordered: 0, leftAlone: 0, threw: 0 };
      const drawCounts = new Set();
      for (let i = 0; i < INPUTS; i += 1) {
        const responseJson = JSON.stringify(makeResponse(r));
        const drawSeed = r.int(0, 0xffffffff);
        const before = runScrambler(oldScramble, responseJson, drawSeed);
        const after = runScrambler(newScramble, responseJson, drawSeed);
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          mismatches.push({ responseJson, before, after });
        }
        if (before.threw) reached.threw += 1;
        else if (before.logged.length > 0) reached.shuffled += 1;
        else reached.leftAlone += 1;
        if (before.storedAs !== responseJson) reached.reordered += 1;
        drawCounts.add(before.draws);
      }
      return { mismatches, reached, drawCounts };
    }

    test('the shipped scramblers use the toolkit, with no shuffle loop of their own', () => {
      [SHIPPED_MULTIPLE_CHOICE, SHIPPED_MULTIPLE_ANSWER].forEach((source) => {
        expect(source).toContain('shuffledValues(');
        expect(source).not.toContain('Math.random');
      });
      expect(CONTROLLER_SOURCE).toContain("require('../utils/question-toolkit')");
    });

    test('multiple choice', () => {
      const { mismatches, reached, drawCounts } = compareScramblers(
        Oracle.scrambleMultipleChoiceOptions,
        Shipped.scrambleMultipleChoiceOptions,
        multipleChoiceResponse,
        0xdeadbeef
      );

      expect(mismatches.slice(0, 5)).toEqual([]);
      expect(reached.shuffled).toBeGreaterThan(1000);
      expect(reached.reordered).toBeGreaterThan(1000);
      expect(reached.leftAlone).toBeGreaterThan(500);
      expect(reached.threw).toBeGreaterThan(10);
      expect([...drawCounts].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    test('multiple answer', () => {
      const { mismatches, reached, drawCounts } = compareScramblers(
        Oracle.scrambleMultipleAnswerOptions,
        Shipped.scrambleMultipleAnswerOptions,
        multipleAnswerResponse,
        0xfeedface
      );

      expect(mismatches.slice(0, 5)).toEqual([]);
      expect(reached.shuffled).toBeGreaterThan(1000);
      expect(reached.reordered).toBeGreaterThan(1000);
      expect(reached.leftAlone).toBeGreaterThan(500);
      expect(reached.threw).toBeGreaterThan(10);
      expect([...drawCounts].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });
  });
});
