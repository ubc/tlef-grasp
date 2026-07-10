const { resolveGenerationQuestionType } = require('../../src/utils/question-type-selection');
const { QUESTION_TYPES, DEFAULT_BLOOM_TYPE_PREFERENCES } = require('../../src/constants/app-constants');

describe('resolveGenerationQuestionType', () => {
  describe('when a valid type is requested (Question Bank wizard pins the type)', () => {
    it.each(Object.values(QUESTION_TYPES))(
      'returns the requested type "%s" regardless of Bloom level',
      (requestedType) => {
        const result = resolveGenerationQuestionType({
          requestedType,
          bloomLevel: 'Create',
          bloomTypePreferences: DEFAULT_BLOOM_TYPE_PREFERENCES,
        });
        expect(result).toBe(requestedType);
      }
    );

    it('honours the requested type even when it differs from the Bloom preference', () => {
      // Create prefers open-ended first; requesting calculation must win.
      const result = resolveGenerationQuestionType({
        requestedType: QUESTION_TYPES.CALCULATION,
        bloomLevel: 'Create',
        bloomTypePreferences: DEFAULT_BLOOM_TYPE_PREFERENCES,
      });
      expect(result).toBe(QUESTION_TYPES.CALCULATION);
    });
  });

  describe('when no type is requested (main generation pathway)', () => {
    it('falls back to the first preferred type for the Bloom level', () => {
      const result = resolveGenerationQuestionType({
        bloomLevel: 'Remember',
        bloomTypePreferences: DEFAULT_BLOOM_TYPE_PREFERENCES,
      });
      expect(result).toBe(DEFAULT_BLOOM_TYPE_PREFERENCES.Remember[0]);
    });

    it('uses default preferences when none are supplied', () => {
      const result = resolveGenerationQuestionType({ bloomLevel: 'Understand' });
      expect(result).toBe(DEFAULT_BLOOM_TYPE_PREFERENCES.Understand[0]);
    });

    it('defaults to multiple-choice for an unknown Bloom level', () => {
      const result = resolveGenerationQuestionType({
        bloomLevel: 'NotABloomLevel',
        bloomTypePreferences: DEFAULT_BLOOM_TYPE_PREFERENCES,
      });
      expect(result).toBe(QUESTION_TYPES.MULTIPLE_CHOICE);
    });
  });

  describe('input hardening', () => {
    it('ignores an invalid requested type and falls back to preferences', () => {
      const result = resolveGenerationQuestionType({
        requestedType: 'essay',
        bloomLevel: 'Apply',
        bloomTypePreferences: DEFAULT_BLOOM_TYPE_PREFERENCES,
      });
      expect(result).toBe(DEFAULT_BLOOM_TYPE_PREFERENCES.Apply[0]);
    });

    it('ignores an empty requested type', () => {
      const result = resolveGenerationQuestionType({
        requestedType: '',
        bloomLevel: 'Analyze',
        bloomTypePreferences: DEFAULT_BLOOM_TYPE_PREFERENCES,
      });
      expect(result).toBe(DEFAULT_BLOOM_TYPE_PREFERENCES.Analyze[0]);
    });

    it('defaults to multiple-choice when called with no arguments', () => {
      expect(resolveGenerationQuestionType()).toBe(QUESTION_TYPES.MULTIPLE_CHOICE);
    });

    it('defaults to multiple-choice when a Bloom level maps to an empty list', () => {
      const result = resolveGenerationQuestionType({
        bloomLevel: 'Custom',
        bloomTypePreferences: { Custom: [] },
      });
      expect(result).toBe(QUESTION_TYPES.MULTIPLE_CHOICE);
    });
  });
});
