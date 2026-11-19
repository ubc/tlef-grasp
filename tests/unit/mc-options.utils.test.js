const {
  MC_OPTION_KEYS,
  optionKeysOf,
  optionAt,
  optionTextOf,
  correctAnswerKey,
  normalizeMcOptionCount,
  optionFeedbackOf,
  stemBesideTitle,
  answerKeysOf,
  multipleAnswerError,
  gradeMultipleAnswer,
} = require('../../src/utils/mc-options');

// Multiple-choice questions carry two to eight options (issue #144); these
// helpers are what every reader of `options` goes through.

describe('optionKeysOf', () => {
  test('lists the letters present on the object form, in order', () => {
    expect(optionKeysOf({ A: { text: 'a' }, B: 'b', E: { text: 'e' } })).toEqual(['A', 'B', 'E']);
  });

  test('treats null and undefined slots as absent', () => {
    expect(optionKeysOf({ A: 'a', B: null, C: undefined, D: '' })).toEqual(['A', 'D']);
  });

  test('ignores keys outside A to H', () => {
    expect(optionKeysOf({ A: 'a', B: 'b', Z: 'z', id: 'x' })).toEqual(['A', 'B']);
  });

  test('letters the legacy array form by position', () => {
    expect(optionKeysOf(['a', 'b', 'c', 'd', 'e'])).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  test('is empty for anything else', () => {
    expect(optionKeysOf(null)).toEqual([]);
    expect(optionKeysOf('abc')).toEqual([]);
    expect(optionKeysOf({})).toEqual([]);
  });
});

describe('optionAt and optionTextOf', () => {
  test('reads either stored form', () => {
    expect(optionAt({ E: { text: 'five' } }, 'E')).toEqual({ text: 'five' });
    expect(optionAt(['a', 'b'], 'B')).toBe('b');
    expect(optionAt(null, 'A')).toBeUndefined();
  });

  test('renders text for objects and bare strings, blank otherwise', () => {
    expect(optionTextOf({ text: 'x', feedback: 'y' })).toBe('x');
    expect(optionTextOf('plain')).toBe('plain');
    expect(optionTextOf({ feedback: 'only' })).toBe('');
    expect(optionTextOf(null)).toBe('');
  });
});

describe('correctAnswerKey', () => {
  test('upper-cases a letter and maps a legacy numeric index', () => {
    expect(correctAnswerKey(' e ')).toBe('E');
    expect(correctAnswerKey(4)).toBe('E');
    expect(correctAnswerKey(0)).toBe('A');
  });

  test('falls back when nothing usable is stored', () => {
    expect(correctAnswerKey(undefined)).toBe('A');
    expect(correctAnswerKey('', 'B')).toBe('B');
    expect(correctAnswerKey(99, '')).toBe('');
  });
});

describe('normalizeMcOptionCount', () => {
  test('accepts counts within the allowed range', () => {
    expect(normalizeMcOptionCount(5)).toBe(5);
    expect(normalizeMcOptionCount('2')).toBe(2);
    expect(normalizeMcOptionCount(MC_OPTION_KEYS.length)).toBe(8);
  });

  test('falls back to the default for anything else', () => {
    expect(normalizeMcOptionCount(undefined)).toBe(4);
    expect(normalizeMcOptionCount('five')).toBe(4);
    expect(normalizeMcOptionCount(1)).toBe(4);
    expect(normalizeMcOptionCount(9)).toBe(4);
    expect(normalizeMcOptionCount(0)).toBe(4);
  });
});

describe('optionFeedbackOf', () => {
  test('reads and trims an option object\'s feedback', () => {
    expect(optionFeedbackOf({ text: 'a', feedback: '  Close.  ' })).toBe('Close.');
  });

  test('is empty for a bare string or a missing option', () => {
    expect(optionFeedbackOf('a')).toBe('');
    expect(optionFeedbackOf(undefined)).toBe('');
    expect(optionFeedbackOf({ text: 'a' })).toBe('');
  });
});

describe('stemBesideTitle', () => {
  test('is the stem when it adds something to the title', () => {
    expect(stemBesideTitle({ title: 'Noble gases', stem: 'Which are noble gases?' }))
      .toBe('Which are noble gases?');
  });

  test('is empty when the stem repeats the title or the title is missing', () => {
    expect(stemBesideTitle({ title: 'Which?', stem: ' Which? ' })).toBe('');
    // Without a title the stem is already the prompt.
    expect(stemBesideTitle({ title: '', stem: 'Which?' })).toBe('');
    expect(stemBesideTitle({ title: 'Which?' })).toBe('');
  });
});

// Multiple answer: the correct letters are a list, and a check is right only
// when the student ticks exactly that set.
describe('answerKeysOf', () => {
  test('orders the letters A to H and drops repeats', () => {
    expect(answerKeysOf(['C', 'a', 'C'])).toEqual(['A', 'C']);
  });

  test('reads a lone letter, a comma-separated string and positions', () => {
    expect(answerKeysOf('b')).toEqual(['B']);
    expect(answerKeysOf('A, C')).toEqual(['A', 'C']);
    expect(answerKeysOf([2, 0])).toEqual(['A', 'C']);
    expect(answerKeysOf(1)).toEqual(['B']);
  });

  test('names nothing for anything else', () => {
    expect(answerKeysOf(undefined)).toEqual([]);
    expect(answerKeysOf(null)).toEqual([]);
    expect(answerKeysOf({ A: true })).toEqual([]);
    expect(answerKeysOf(['Z', '', 9, 1.5])).toEqual([]);
  });
});

describe('multipleAnswerError', () => {
  const options = { A: 'Neon', B: 'Nitrogen', C: 'Argon' };

  test('accepts one or more correct options the question has', () => {
    expect(multipleAnswerError(options, ['A'])).toBe('');
    expect(multipleAnswerError(options, ['A', 'C'])).toBe('');
    expect(multipleAnswerError(options, ['A', 'B', 'C'])).toBe('');
  });

  test('needs at least one correct option', () => {
    expect(multipleAnswerError(options, [])).toMatch(/at least one option as correct/);
    expect(multipleAnswerError(options, undefined)).toMatch(/at least one option as correct/);
  });

  test('refuses a correct letter the question has no option for', () => {
    expect(multipleAnswerError(options, ['A', 'D'])).toMatch(/Option D is marked correct/);
  });

  test('needs at least two options', () => {
    expect(multipleAnswerError({ A: 'Neon' }, ['A'])).toMatch(/at least 2 options/);
  });
});

describe('gradeMultipleAnswer', () => {
  test('is right only for the exact set, in any order', () => {
    expect(gradeMultipleAnswer(['A', 'C'], ['C', 'A'])).toEqual({
      isCorrect: true,
      correctKeys: ['A', 'C'],
      selectedKeys: ['A', 'C'],
      wrongKeys: [],
      missedCorrect: false,
    });
  });

  test('names the wrong options ticked and says when a correct one was missed', () => {
    expect(gradeMultipleAnswer(['A', 'C'], ['A', 'B'])).toMatchObject({
      isCorrect: false,
      wrongKeys: ['B'],
      missedCorrect: true,
    });
    expect(gradeMultipleAnswer(['A', 'C'], ['A'])).toMatchObject({
      isCorrect: false,
      wrongKeys: [],
      missedCorrect: true,
    });
    expect(gradeMultipleAnswer(['A', 'C'], ['A', 'B', 'C'])).toMatchObject({
      isCorrect: false,
      wrongKeys: ['B'],
      missedCorrect: false,
    });
  });

  test('is never right when nothing is marked correct', () => {
    expect(gradeMultipleAnswer([], []).isCorrect).toBe(false);
    expect(gradeMultipleAnswer(undefined, ['A']).isCorrect).toBe(false);
  });
});
