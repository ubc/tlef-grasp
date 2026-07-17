const {
  buildExistingQuestionsContext,
  getGeneratedQuestionText,
  normalizeQuestionText,
} = require('../../src/utils/question-generation');

describe('question generation duplicate protection', () => {
  it('normalizes inconsequential case and whitespace differences', () => {
    expect(normalizeQuestionText('  What   is ATP?\n')).toBe('what is atp?');
    expect(normalizeQuestionText('WHAT IS ATP?')).toBe('what is atp?');
  });

  it('builds a deduplicated exclusion block for the model prompt', () => {
    const context = buildExistingQuestionsContext([
      'What is ATP?',
      '  WHAT  IS ATP? ',
      'How is ATP produced?',
    ]);

    expect(context).toContain('1. What is ATP?');
    expect(context).toContain('2. How is ATP produced?');
    expect(context).toContain('Do not repeat or lightly rephrase');
    expect(context.match(/What is ATP/gi)).toHaveLength(1);
  });

  it('reads the assessment text from every generated question shape', () => {
    expect(getGeneratedQuestionText({ question: 'MCQ text' })).toBe('MCQ text');
    expect(getGeneratedQuestionText({ stem: 'Open-ended text' })).toBe('Open-ended text');
    expect(getGeneratedQuestionText({ title: 'Legacy text' })).toBe('Legacy text');
  });
});
