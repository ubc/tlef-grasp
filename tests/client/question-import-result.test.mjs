import { describe, it, expect } from '@jest/globals';
import { describeImportResult } from '../../client/src/lib/questionImport.js';

// The toast after a bank import must name refused questions, not just the
// saved and duplicate counts. See ubc/tlef-grasp#183.
describe('describeImportResult', () => {
  it('reports a clean import as a success', () => {
    expect(describeImportResult({ savedCount: 2, duplicateCount: 0, invalidCount: 0 })).toEqual({
      message: 'Imported 2 questions',
      type: 'success',
    });
  });

  it('keeps the skipped-duplicates suffix', () => {
    expect(describeImportResult({ savedCount: 1, duplicateCount: 2 }).message).toBe(
      'Imported 1 question (skipped 2 duplicates)'
    );
  });

  it('adds the refused count and reason, as a warning', () => {
    expect(
      describeImportResult({
        savedCount: 1,
        duplicateCount: 0,
        invalidCount: 1,
        invalidReason: 'Mark at least one option as correct.',
      })
    ).toEqual({
      message: 'Imported 1 question. 1 was refused: Mark at least one option as correct.',
      type: 'warning',
    });
  });

  it('names duplicates and refusals together', () => {
    expect(
      describeImportResult({ savedCount: 3, duplicateCount: 1, invalidCount: 2, invalidReason: 'Bad' }).message
    ).toBe('Imported 3 questions (skipped 1 duplicate). 2 were refused: Bad.');
  });

  it('falls back to the row count when the server sends no count', () => {
    expect(describeImportResult(undefined, 4).message).toBe('Imported 4 questions');
  });
});
