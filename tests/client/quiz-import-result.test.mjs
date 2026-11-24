import { describe, it, expect } from '@jest/globals';
import { describeQuizImportResult, describeQuizImportError } from '../../client/src/lib/questionImport.js';
import { ApiError } from '../../client/src/lib/api.js';

// The toast after a quiz import must name refused questions, not just the
// added and duplicate counts. See ubc/tlef-grasp#182.
describe('describeQuizImportResult', () => {
  it('reports a clean import as a success', () => {
    expect(describeQuizImportResult({ questionsAdded: 5, duplicateCount: 0, invalidCount: 0 })).toEqual({
      message: 'Imported quiz with 5 questions',
      type: 'success',
    });
  });

  it('keeps the skipped-duplicates note', () => {
    expect(describeQuizImportResult({ questionsAdded: 1, duplicateCount: 1 }).message).toBe(
      'Imported quiz with 1 question (skipped 1 duplicate)'
    );
  });

  it('adds the refused count and reason, as a warning', () => {
    expect(
      describeQuizImportResult({
        questionsAdded: 4,
        duplicateCount: 0,
        invalidCount: 1,
        invalidReason: 'Mark at least one option as correct.',
      })
    ).toEqual({
      message: 'Imported quiz with 4 questions (1 refused: Mark at least one option as correct.)',
      type: 'warning',
    });
  });

  it('names duplicates and refusals together', () => {
    expect(
      describeQuizImportResult({ questionsAdded: 3, duplicateCount: 2, invalidCount: 2, invalidReason: 'Bad.' })
        .message
    ).toBe('Imported quiz with 3 questions (skipped 2 duplicates; 2 refused: Bad.)');
  });

  it('falls back to the row count when the server sends no count', () => {
    expect(describeQuizImportResult(undefined, 4).message).toBe('Imported quiz with 4 questions');
  });
});

// A file whose every question was refused creates no quiz; the server says so
// and the panel shows it as a warning, not a failure.
describe('describeQuizImportError', () => {
  it('shows a file with every question refused as a warning', () => {
    const message = 'No quiz was created: its only question was refused. Mark at least one option as correct.';
    const error = new ApiError(message, 400, { success: false, code: 'ALL_QUESTIONS_REFUSED', error: message });

    expect(describeQuizImportError(error)).toEqual({ message, type: 'warning' });
  });

  it('shows any other failure as an error', () => {
    expect(describeQuizImportError(new ApiError('Boom', 500, { error: 'Boom' }))).toEqual({
      message: 'Boom',
      type: 'error',
    });
  });

  it('falls back to a generic message', () => {
    expect(describeQuizImportError(undefined)).toEqual({ message: 'Failed to import quiz', type: 'error' });
  });
});
