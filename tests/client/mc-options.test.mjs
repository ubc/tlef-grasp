import { describe, it, expect } from '@jest/globals';
import {
  MC_OPTION_COUNT_CHOICES,
  optionKeysOf,
  optionIndexOf,
  optionRowsOf,
  emptyOptionRows,
  addOptionRow,
  removeOptionRow,
  optionRowsToObject,
  optionRowsError,
  optionImageOf,
  normalizeMcOptionCount,
} from '../../client/src/lib/mcOptions.js';

// Issue #144: multiple-choice forms edit two to eight option rows and the
// student view sends the letter's position in A to H back as selectedIndex.

describe('optionRowsOf', () => {
  it('builds rows for whatever letters the question has', () => {
    const rows = optionRowsOf({
      A: { text: 'One', feedback: 'no' },
      B: 'Two',
      C: { text: 'Three', feedback: '' },
      D: { text: 'Four', feedback: '' },
      E: { text: 'Five', feedback: 'nope' },
    });
    expect(rows.map((r) => r.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(rows[1]).toEqual({ id: 'B', text: 'Two', feedback: '', image: null });
    expect(rows[4].feedback).toBe('nope');
  });

  it('gives a new question four blank rows', () => {
    expect(optionRowsOf(undefined)).toEqual(emptyOptionRows());
    expect(emptyOptionRows().map((r) => r.id)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('adding and removing rows', () => {
  const rows = optionRowsOf({ A: 'a', B: 'b', C: 'c', D: 'd' });

  it('appends a lettered blank row up to eight', () => {
    expect(addOptionRow(rows).map((r) => r.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
    const eight = emptyOptionRows(8);
    expect(addOptionRow(eight)).toBe(eight);
  });

  it('re-letters the remaining rows and moves the correct answer with its row', () => {
    const { rows: next, correctAnswer } = removeOptionRow(rows, 1, 'D');
    expect(next.map((r) => [r.id, r.text])).toEqual([['A', 'a'], ['B', 'c'], ['C', 'd']]);
    expect(correctAnswer).toBe('C');
  });

  it('keeps the correct answer when a later row goes', () => {
    expect(removeOptionRow(rows, 3, 'B').correctAnswer).toBe('B');
  });

  it('clears the correct answer when its own row goes', () => {
    expect(removeOptionRow(rows, 1, 'B').correctAnswer).toBe('');
  });

  it('refuses to go below two rows', () => {
    const two = emptyOptionRows(2);
    expect(removeOptionRow(two, 0, 'A')).toEqual({ rows: two, correctAnswer: 'A' });
  });
});

describe('optionRowsToObject', () => {
  it('trims and keys by letter in row order', () => {
    expect(
      optionRowsToObject([
        { id: 'A', text: ' one ', feedback: ' x ' },
        { id: 'B', text: 'two', feedback: '' },
      ])
    ).toEqual({ A: { text: 'one', feedback: 'x' }, B: { text: 'two', feedback: '' } });
  });
});

// Issue #146: an option may carry one image, and an image-only option is valid.
describe('option images', () => {
  const image = { fileId: '665f1a0000000000000000aa', caption: 'Benzene ring' };

  it('reads an option image into its row and writes it back', () => {
    const rows = optionRowsOf({ A: { text: '', feedback: '', image }, B: 'Two' });
    expect(rows[0].image).toEqual(image);
    expect(rows[1].image).toBe(null);
    expect(optionRowsToObject(rows)).toEqual({
      A: { text: '', feedback: '', image },
      B: { text: 'Two', feedback: '' },
    });
  });

  it('keeps an image with its row when an earlier row is removed', () => {
    const rows = optionRowsOf({ A: 'a', B: 'b', C: { text: 'c', image } });
    const { rows: next } = removeOptionRow(rows, 0, 'A');
    expect(next[1]).toMatchObject({ id: 'B', text: 'c', image });
  });

  it('ignores an image ref without a file id', () => {
    expect(optionImageOf({ text: 'x', image: { caption: 'orphan' } })).toBe(null);
    expect(optionImageOf('plain')).toBe(null);
  });

  it('requires text or an image on every option', () => {
    expect(optionRowsError(optionRowsOf({ A: 'a', B: '' }))).toBe('Each option needs text or an image');
    expect(optionRowsError(optionRowsOf({ A: 'a', B: { text: '', image } }))).toBe('');
  });

  it('tells identical options apart by their images', () => {
    const other = { fileId: '665f1a0000000000000000bb', caption: '' };
    expect(optionRowsError(optionRowsOf({ A: 'Same', B: ' same ' }))).toMatch(/unique/);
    expect(
      optionRowsError(optionRowsOf({ A: { text: '', image }, B: { text: '', image: other } }))
    ).toBe('');
    expect(
      optionRowsError(optionRowsOf({ A: { text: '', image }, B: { text: '', image } }))
    ).toMatch(/unique/);
  });
});

describe('letters and indexes', () => {
  it('maps a letter to the index the server expects', () => {
    expect(optionIndexOf('A')).toBe(0);
    expect(optionIndexOf('E')).toBe(4);
    expect(optionKeysOf({ A: 'a', B: null, C: 'c' })).toEqual(['A', 'C']);
  });

  it('offers generation counts from two to eight and clamps requests', () => {
    expect(MC_OPTION_COUNT_CHOICES).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(normalizeMcOptionCount(5)).toBe(5);
    expect(normalizeMcOptionCount(12)).toBe(4);
  });
});
