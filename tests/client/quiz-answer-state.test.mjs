import { describe, it, expect } from '@jest/globals';
import {
  isSolved,
  canRetry,
  latestResult,
  recordCheck,
} from '../../client/src/pages/student-quiz/answerState.js';

// Issue #128: the first answer is graded. A wrong multiple-choice or
// calculation answer keeps the correct one hidden and may be retried until the
// student finds it; fill-in-the-blank and open-ended are answered once.

const mcq = (selectedKey, isCorrect) => ({
  questionType: 'multiple-choice',
  selectedKey,
  isCorrect,
  correctAnswer: isCorrect ? selectedKey : null,
});

describe('recordCheck', () => {
  it('records the first check as the graded answer', () => {
    const entry = recordCheck(undefined, mcq('C', false));

    expect(entry).toMatchObject({ isCorrect: false, selectedKey: 'C', retry: null });
    expect(entry.wrongKeys).toEqual(['C']);
  });

  it('keeps the graded answer when a retry comes in', () => {
    const first = recordCheck(undefined, mcq('C', false));
    const afterRetry = recordCheck(first, mcq('D', false));

    // The graded verdict and selection are untouched...
    expect(afterRetry.isCorrect).toBe(false);
    expect(afterRetry.selectedKey).toBe('C');
    // ...the retry is layered on top, and both wrong options are remembered.
    expect(afterRetry.retry).toMatchObject({ selectedKey: 'D', isCorrect: false });
    expect(afterRetry.wrongKeys).toEqual(['C', 'D']);
  });

  it('replaces the previous retry with the latest one', () => {
    let entry = recordCheck(undefined, mcq('C', false));
    entry = recordCheck(entry, mcq('D', false));
    entry = recordCheck(entry, mcq('A', true));

    expect(entry.retry).toMatchObject({ selectedKey: 'A', isCorrect: true });
    expect(entry.wrongKeys).toEqual(['C', 'D']);
    expect(entry.isCorrect).toBe(false);
  });

  it('does not mark typed answers as wrong options', () => {
    const entry = recordCheck(undefined, {
      questionType: 'calculation',
      selectedAnswer: '5',
      selectedKey: '5',
      isCorrect: false,
    });

    expect(entry.wrongKeys).toEqual([]);
  });

  it('keeps the student grade review on the graded answer', () => {
    const first = { ...recordCheck(undefined, mcq('C', false)), studentGradeReview: 'deny' };

    expect(recordCheck(first, mcq('A', true)).studentGradeReview).toBe('deny');
  });
});

describe('isSolved / canRetry / latestResult', () => {
  it('solves on a correct first answer, with nothing left to retry', () => {
    const entry = recordCheck(undefined, mcq('A', true));

    expect(isSolved(entry)).toBe(true);
    expect(canRetry(entry)).toBe(false);
    expect(latestResult(entry)).toBe(entry);
  });

  it('keeps a wrong answer open until a retry finds the answer', () => {
    const wrong = recordCheck(undefined, mcq('C', false));
    expect(isSolved(wrong)).toBe(false);
    expect(canRetry(wrong)).toBe(true);

    const found = recordCheck(wrong, mcq('A', true));
    expect(isSolved(found)).toBe(true);
    expect(canRetry(found)).toBe(false);
    expect(latestResult(found)).toBe(found.retry);
  });

  it('keeps a wrong calculation answer open for another try', () => {
    const wrong = recordCheck(undefined, {
      questionType: 'calculation',
      selectedAnswer: '5',
      isCorrect: false,
    });

    expect(canRetry(wrong)).toBe(true);
    expect(
      canRetry(recordCheck(wrong, { questionType: 'calculation', selectedAnswer: '4', isCorrect: true }))
    ).toBe(false);
  });

  it('answers fill-in-the-blank once, so a wrong answer is not retried', () => {
    const wrong = recordCheck(undefined, {
      questionType: 'fill-in-the-blank',
      selectedAnswer: 'nucleus',
      isCorrect: false,
    });

    expect(isSolved(wrong)).toBe(false);
    expect(canRetry(wrong)).toBe(false);
  });

  it('never retries an open-ended answer, graded or awaiting a grade', () => {
    const failed = recordCheck(undefined, {
      questionType: 'open-ended',
      openEnded: true,
      isCorrect: false,
    });
    const ungraded = recordCheck(undefined, {
      questionType: 'open-ended',
      openEnded: true,
      isCorrect: null,
    });

    expect(canRetry(failed)).toBe(false);
    expect(canRetry(ungraded)).toBe(false);
  });

  it('treats an unanswered question as neither solved nor retryable', () => {
    expect(isSolved(undefined)).toBe(false);
    expect(canRetry(undefined)).toBe(false);
    expect(latestResult(undefined)).toBeNull();
  });
});
