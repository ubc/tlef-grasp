const {
  MC_OPTION_KEYS,
  optionKeysOf,
  optionAt,
  optionTextOf,
  correctAnswerKey,
  normalizeMcOptionCount,
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
