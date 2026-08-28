const { resolveGenerationQuestionType } = require('../../src/utils/question-type-selection');
const { QUESTION_TYPES, DEFAULT_BLOOM_TYPE_PREFERENCES } = require('../../src/constants/app-constants');

describe('resolveGenerationQuestionType', () => {
  describe('when a valid type is requested (Question Bank wizard pins the type)', () => {
    it.each(Object.values(QUESTION_TYPES))(
      'returns the requested type "%s" regardless of Bloom level',
      (requestedType) => {
        const result = resolveGenerationQuestionType({ requestedType, bloomLevel: 'Create' });
        expect(result).toBe(requestedType);
      }
    );

    it('honours the requested type even when it differs from the Bloom default', () => {
      // Create defaults to open-ended first; requesting calculation must win.
      const result = resolveGenerationQuestionType({
        requestedType: QUESTION_TYPES.CALCULATION,
        bloomLevel: 'Create',
      });
      expect(result).toBe(QUESTION_TYPES.CALCULATION);
    });
  });

  describe('when no type is requested', () => {
    // There is no per-course override any more: instructors choose types per
    // (granular objective, Bloom level) in the generation step, which supersedes
    // a course-wide mapping. These defaults only seed that choice.
    it('falls back to the default type for the Bloom level', () => {
      expect(resolveGenerationQuestionType({ bloomLevel: 'Remember' }))
        .toBe(DEFAULT_BLOOM_TYPE_PREFERENCES.Remember[0]);
      expect(resolveGenerationQuestionType({ bloomLevel: 'Understand' }))
        .toBe(DEFAULT_BLOOM_TYPE_PREFERENCES.Understand[0]);
    });

    it('defaults to multiple-choice for an unknown Bloom level', () => {
      const result = resolveGenerationQuestionType({ bloomLevel: 'NotABloomLevel' });
      expect(result).toBe(QUESTION_TYPES.MULTIPLE_CHOICE);
    });

    it('ignores a course preference map if one is somehow still passed', () => {
      // Guards the removal: a stale caller passing the old argument must not
      // resurrect course-wide overrides through the back door.
      const result = resolveGenerationQuestionType({
        bloomLevel: 'Remember',
        bloomTypePreferences: { Remember: [QUESTION_TYPES.OPEN_ENDED] },
      });
      expect(result).toBe(DEFAULT_BLOOM_TYPE_PREFERENCES.Remember[0]);
    });
  });

  describe('input hardening', () => {
    it('ignores an invalid requested type and falls back to the default', () => {
      const result = resolveGenerationQuestionType({ requestedType: 'essay', bloomLevel: 'Apply' });
      expect(result).toBe(DEFAULT_BLOOM_TYPE_PREFERENCES.Apply[0]);
    });

    it('ignores an empty requested type', () => {
      const result = resolveGenerationQuestionType({ requestedType: '', bloomLevel: 'Analyze' });
      expect(result).toBe(DEFAULT_BLOOM_TYPE_PREFERENCES.Analyze[0]);
    });

    it('defaults to multiple-choice when called with no arguments', () => {
      expect(resolveGenerationQuestionType()).toBe(QUESTION_TYPES.MULTIPLE_CHOICE);
    });

    it('defaults to multiple-choice when the Bloom level is missing', () => {
      expect(resolveGenerationQuestionType({ requestedType: undefined }))
        .toBe(QUESTION_TYPES.MULTIPLE_CHOICE);
    });
  });
});
