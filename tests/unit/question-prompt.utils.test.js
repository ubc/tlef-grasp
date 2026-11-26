const { promptOf, isGenericStem, MC_GENERIC_STEM } = require('../../src/utils/question-prompt');

describe('promptOf', () => {
  test('is the stem for every type, whatever the title says', () => {
    expect(promptOf({ title: 'Kinetic energy formula', stem: ' What is the kinetic energy? ' }))
      .toBe('What is the kinetic energy?');
    expect(promptOf({ questionType: 'fill-in-the-blank', title: 'Cells', stem: 'The ___ is...' }))
      .toBe('The ___ is...');
  });

  test('falls back to the title when the stem is empty or generic (#223)', () => {
    expect(promptOf({ title: 'What is 2 + 2?', stem: MC_GENERIC_STEM })).toBe('What is 2 + 2?');
    expect(promptOf({ title: 'What is 2 + 2?', stem: 'select the best answer' })).toBe('What is 2 + 2?');
    expect(promptOf({ title: 'The ___ is...', stem: 'Fill in the blank:' })).toBe('The ___ is...');
    expect(promptOf({ title: 'What is 2 + 2?', stem: '   ' })).toBe('What is 2 + 2?');
    expect(promptOf({ title: 'What is 2 + 2?' })).toBe('What is 2 + 2?');
  });

  test('is empty when the question has no text at all', () => {
    expect(promptOf({ stem: MC_GENERIC_STEM })).toBe('');
    expect(promptOf({})).toBe('');
    expect(promptOf(null)).toBe('');
  });
});

describe('isGenericStem', () => {
  test('matches only the generic instruction lines', () => {
    expect(isGenericStem('Select the best answer:')).toBe(true);
    expect(isGenericStem(' Fill in the blank ')).toBe(true);
    expect(isGenericStem('Select the best answer: which is a noble gas?')).toBe(false);
    expect(isGenericStem('')).toBe(false);
  });
});
