const { resolveQuestionType } = require('../../src/utils/question-type');

describe('resolveQuestionType', () => {
  test.each([
    ['multiple-choice', 'multiple-choice'],
    ['Multiple-Answer', 'multiple-answer'],
    [' fill-in-the-blank ', 'fill-in-the-blank'],
    ['calculation', 'calculation'],
    ['open-ended', 'open-ended'],
  ])('keeps a known type: %s', (questionType, expected) => {
    expect(resolveQuestionType({ questionType })).toBe(expected);
  });

  test('reads a legacy `type` field', () => {
    expect(resolveQuestionType({ type: 'open-ended' })).toBe('open-ended');
  });

  test('treats a missing or unknown type as multiple choice', () => {
    expect(resolveQuestionType({})).toBe('multiple-choice');
    expect(resolveQuestionType({ questionType: 'essay' })).toBe('multiple-choice');
    expect(resolveQuestionType(null)).toBe('multiple-choice');
  });
});
