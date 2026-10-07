import { describe, it, expect } from '@jest/globals';
import {
  EMPTY_TOLERANCE_FORM,
  resolveTolerance,
  toleranceToForm,
  toleranceFromForm,
  tolerancePayload,
  describeTolerance,
  stemPlaceholderNames,
} from '../../client/src/lib/calculationTolerance.js';

// Issue #145: the wizard, the edit modal and the generation page all edit the
// same four calcTolerance* fields and send the same two API fields.

describe('resolveTolerance', () => {
  it('prefers the stored object and falls back to the legacy percent', () => {
    expect(resolveTolerance({ calculationTolerance: { mode: 'absolute', value: 0.5 } }))
      .toEqual({ mode: 'absolute', value: 0.5 });
    expect(resolveTolerance({ calculationAnswerTolerancePercent: 2 }))
      .toEqual({ mode: 'percent', value: 2 });
    expect(resolveTolerance({ calculationAnswerTolerancePercent: '2' }))
      .toEqual({ mode: 'percent', value: 2 });
    // An explicit null object means "exact", whatever the legacy field says.
    expect(resolveTolerance({ calculationTolerance: null, calculationAnswerTolerancePercent: 2 }))
      .toBeNull();
    expect(resolveTolerance({})).toBeNull();
    expect(resolveTolerance(null)).toBeNull();
  });
});

describe('toleranceToForm / toleranceFromForm', () => {
  it('round-trips each mode through the form fields', () => {
    const cases = [
      { calculationTolerance: null },
      { calculationTolerance: { mode: 'percent', value: 2 } },
      { calculationTolerance: { mode: 'absolute', value: 0.05 } },
      { calculationTolerance: { mode: 'range', min: 7, max: 7.8 } },
    ];
    for (const question of cases) {
      const form = toleranceToForm(question);
      expect(toleranceFromForm(form)).toEqual({ tolerance: question.calculationTolerance });
    }
    expect(toleranceToForm({})).toEqual(EMPTY_TOLERANCE_FORM);
    expect(toleranceToForm({ calculationTolerance: { mode: 'range', min: 7, max: 7.8 } })).toEqual({
      calcToleranceMode: 'range',
      calcTolerance: '',
      calcRangeMin: '7',
      calcRangeMax: '7.8',
    });
  });

  it('reports what is wrong with a malformed form', () => {
    expect(toleranceFromForm({ calcToleranceMode: 'percent', calcTolerance: '' }).error)
      .toMatch(/percentage from 0 to 100/);
    expect(toleranceFromForm({ calcToleranceMode: 'percent', calcTolerance: '150' }).error)
      .toMatch(/cannot exceed 100/);
    expect(toleranceFromForm({ calcToleranceMode: 'absolute', calcTolerance: '-1' }).error)
      .toMatch(/0 or more/);
    expect(toleranceFromForm({ calcToleranceMode: 'range', calcRangeMin: '1', calcRangeMax: '' }).error)
      .toMatch(/both ends/);
    expect(toleranceFromForm({ calcToleranceMode: 'range', calcRangeMin: '5', calcRangeMax: '1' }).error)
      .toMatch(/minimum must not exceed/);
    // A range needs a fixed answer.
    expect(toleranceFromForm({ calcToleranceMode: 'range', calcRangeMin: '1', calcRangeMax: '5' }, 2).error)
      .toMatch(/remove the variables/);
    expect(toleranceFromForm({ calcToleranceMode: 'range', calcRangeMin: '1', calcRangeMax: '5' }, 0))
      .toEqual({ tolerance: { mode: 'range', min: 1, max: 5 } });
  });
});

describe('tolerancePayload', () => {
  it('sends the object and keeps the legacy percent in step', () => {
    expect(tolerancePayload({ mode: 'percent', value: 3 })).toEqual({
      calculationTolerance: { mode: 'percent', value: 3 },
      calculationAnswerTolerancePercent: 3,
    });
    expect(tolerancePayload({ mode: 'absolute', value: 3 })).toEqual({
      calculationTolerance: { mode: 'absolute', value: 3 },
      calculationAnswerTolerancePercent: null,
    });
    expect(tolerancePayload(null)).toEqual({
      calculationTolerance: null,
      calculationAnswerTolerancePercent: null,
    });
  });
});

describe('describeTolerance', () => {
  it('summarises each mode in a few words', () => {
    expect(describeTolerance(null, 0)).toBe('exact to 0 decimal places');
    expect(describeTolerance(null, 1)).toBe('exact to 1 decimal place');
    expect(describeTolerance({ mode: 'percent', value: 2 })).toBe('within 2% of the answer');
    expect(describeTolerance({ mode: 'absolute', value: 0.5 })).toBe('within ±0.5 of the answer');
    expect(describeTolerance({ mode: 'range', min: 7, max: 7.8 })).toBe('between 7 and 7.8');
  });
});

describe('stemPlaceholderNames', () => {
  it('lists {{placeholders}} once each, in order', () => {
    expect(stemPlaceholderNames('Mass {{m}} at {{ v }} m/s, again {{m}}')).toEqual(['m', 'v']);
    expect(stemPlaceholderNames('No braces here')).toEqual([]);
    expect(stemPlaceholderNames('')).toEqual([]);
  });
});
