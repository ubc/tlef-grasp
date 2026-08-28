const { normalizeQuestionTypes } = require('../../src/utils/question-type-selection');
const { QUESTION_TYPES, MAX_QUESTIONS_PER_OBJECTIVE } = require('../../src/constants/app-constants');

const pair = (bloomLevel, questionType, count) => ({ bloomLevel, questionType, count });
const total = (entries) => entries.reduce((sum, e) => sum + e.count, 0);

describe('normalizeQuestionTypes', () => {
  describe('bounds', () => {
    // Every entry becomes its own sequential LLM generation. This used to be
    // clamped on the objective-save path and unbounded on the generation path,
    // so the same request body meant a handful of questions when saved and
    // 100,000 when generated.
    it('clamps a single oversized count to the objective total', () => {
      const result = normalizeQuestionTypes([pair('Understand', QUESTION_TYPES.MULTIPLE_CHOICE, 100000)]);

      expect(result).toEqual([
        pair('Understand', QUESTION_TYPES.MULTIPLE_CHOICE, MAX_QUESTIONS_PER_OBJECTIVE),
      ]);
    });

    // The objective total is the only cap: how it divides between levels and
    // types is the instructor's call, and one type at one level costs the same
    // to generate as the same number spread around.
    it('lets a single pair use the whole objective budget', () => {
      const result = normalizeQuestionTypes([
        pair('Analyze', QUESTION_TYPES.MULTIPLE_CHOICE, MAX_QUESTIONS_PER_OBJECTIVE),
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].count).toBe(MAX_QUESTIONS_PER_OBJECTIVE);
    });

    it('floors counts at one so an entry always generates something', () => {
      const result = normalizeQuestionTypes([
        pair('Apply', QUESTION_TYPES.CALCULATION, 0),
        pair('Analyze', QUESTION_TYPES.MULTIPLE_CHOICE, -7),
      ]);

      expect(result.map((e) => e.count)).toEqual([1, 1]);
    });

    it('caps the objective total across many valid entries', () => {
      const everyPair = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create']
        .flatMap((level) => Object.values(QUESTION_TYPES).map((type) => pair(level, type, 5)));

      expect(total(normalizeQuestionTypes(everyPair))).toBe(MAX_QUESTIONS_PER_OBJECTIVE);
    });

    // Repetition must not be a way past the objective cap.
    it('bounds a repeated pair by the objective cap, not by repetition', () => {
      const repeated = Array(50).fill(pair('Analyze', QUESTION_TYPES.MULTIPLE_CHOICE, 5));
      const result = normalizeQuestionTypes(repeated);

      expect(result).toEqual([
        pair('Analyze', QUESTION_TYPES.MULTIPLE_CHOICE, MAX_QUESTIONS_PER_OBJECTIVE),
      ]);
    });

    it('trims the entry that crosses the cap rather than dropping it', () => {
      const result = normalizeQuestionTypes([
        pair('Apply', QUESTION_TYPES.MULTIPLE_CHOICE, 5),
        pair('Analyze', QUESTION_TYPES.MULTIPLE_CHOICE, 5),
        pair('Evaluate', QUESTION_TYPES.MULTIPLE_CHOICE, 5),
        pair('Create', QUESTION_TYPES.MULTIPLE_CHOICE, 5),
        pair('Remember', QUESTION_TYPES.FILL_IN_THE_BLANK, 5),
      ]);

      expect(total(result)).toBe(MAX_QUESTIONS_PER_OBJECTIVE);
      expect(result).toHaveLength(4);
      expect(result[3].count).toBe(5);
    });

    it('parses string counts the way a JSON request body delivers them', () => {
      const result = normalizeQuestionTypes([pair('Apply', QUESTION_TYPES.CALCULATION, '3')]);
      expect(result[0].count).toBe(3);
    });

    it('falls back to one for a count that is not a number at all', () => {
      const result = normalizeQuestionTypes([pair('Apply', QUESTION_TYPES.CALCULATION, 'lots')]);
      expect(result[0].count).toBe(1);
    });
  });

  describe('merging repeated pairs', () => {
    // Two entries naming the same pair are one thing said twice, not two things
    // to generate. JSON Schema cannot express "no two items share these two
    // property values", so the model can emit them — the e2e stub does exactly
    // this — and a request body can carry them.
    it('sums a duplicated pair into one entry', () => {
      const result = normalizeQuestionTypes([
        pair('Analyze', QUESTION_TYPES.MULTIPLE_CHOICE, 2),
        pair('Analyze', QUESTION_TYPES.MULTIPLE_CHOICE, 3),
      ]);

      expect(result).toEqual([pair('Analyze', QUESTION_TYPES.MULTIPLE_CHOICE, 5)]);
    });

    it('preserves the total when merging (the same questions, described once)', () => {
      // The shape the e2e stub produces: a repeated pair plus a distinct one.
      const result = normalizeQuestionTypes([
        pair('Remember', QUESTION_TYPES.MULTIPLE_CHOICE, 1),
        pair('Remember', QUESTION_TYPES.MULTIPLE_CHOICE, 1),
        pair('Understand', QUESTION_TYPES.MULTIPLE_CHOICE, 1),
      ]);

      expect(result).toEqual([
        pair('Remember', QUESTION_TYPES.MULTIPLE_CHOICE, 2),
        pair('Understand', QUESTION_TYPES.MULTIPLE_CHOICE, 1),
      ]);
      expect(total(result)).toBe(3);
    });

    it('keeps the same level distinct across different types', () => {
      const result = normalizeQuestionTypes([
        pair('Apply', QUESTION_TYPES.MULTIPLE_CHOICE, 1),
        pair('Apply', QUESTION_TYPES.CALCULATION, 2),
      ]);

      expect(result).toHaveLength(2);
      expect(total(result)).toBe(3);
    });

    it('keeps the same type distinct across different levels', () => {
      const result = normalizeQuestionTypes([
        pair('Apply', QUESTION_TYPES.MULTIPLE_CHOICE, 1),
        pair('Analyze', QUESTION_TYPES.MULTIPLE_CHOICE, 2),
      ]);

      expect(result).toHaveLength(2);
      expect(total(result)).toBe(3);
    });

    it('sums duplicates without inventing a per-pair ceiling', () => {
      const result = normalizeQuestionTypes([
        pair('Apply', QUESTION_TYPES.CALCULATION, 4),
        pair('Apply', QUESTION_TYPES.CALCULATION, 4),
      ]);

      expect(result).toEqual([pair('Apply', QUESTION_TYPES.CALCULATION, 8)]);
    });

    it('keeps first-seen order', () => {
      const result = normalizeQuestionTypes([
        pair('Understand', QUESTION_TYPES.OPEN_ENDED, 1),
        pair('Apply', QUESTION_TYPES.CALCULATION, 1),
        pair('Understand', QUESTION_TYPES.OPEN_ENDED, 1),
      ]);

      expect(result.map((e) => e.bloomLevel)).toEqual(['Understand', 'Apply']);
      expect(result[0].count).toBe(2);
    });

    // Merging must not consume budget a later distinct pair still needs.
    it('merges a repeat and still admits a later distinct pair', () => {
      const result = normalizeQuestionTypes([
        pair('Apply', QUESTION_TYPES.MULTIPLE_CHOICE, 5),
        pair('Apply', QUESTION_TYPES.MULTIPLE_CHOICE, 5),
        pair('Analyze', QUESTION_TYPES.OPEN_ENDED, 2),
      ]);

      expect(result).toEqual([
        pair('Apply', QUESTION_TYPES.MULTIPLE_CHOICE, 10),
        pair('Analyze', QUESTION_TYPES.OPEN_ENDED, 2),
      ]);
    });
  });

  describe('filtering', () => {
    it('drops entries naming an unknown question type', () => {
      const result = normalizeQuestionTypes([
        pair('Apply', 'true-false', 3),
        pair('Apply', QUESTION_TYPES.CALCULATION, 2),
      ]);

      expect(result).toEqual([pair('Apply', QUESTION_TYPES.CALCULATION, 2)]);
    });

    it('drops entries naming an unknown Bloom level', () => {
      const result = normalizeQuestionTypes([pair('Synthesize', QUESTION_TYPES.MULTIPLE_CHOICE, 2)]);
      expect(result).toEqual([]);
    });

    // Callers holding a specific objective pass its own levels, so the model
    // cannot attach question types to a level the objective does not have.
    it('restricts entries to the levels the caller allows', () => {
      const result = normalizeQuestionTypes(
        [
          pair('Apply', QUESTION_TYPES.MULTIPLE_CHOICE, 2),
          pair('Evaluate', QUESTION_TYPES.OPEN_ENDED, 2),
        ],
        { allowedBloomLevels: ['Apply'] }
      );

      expect(result).toEqual([pair('Apply', QUESTION_TYPES.MULTIPLE_CHOICE, 2)]);
    });

    it('survives malformed input without throwing', () => {
      expect(normalizeQuestionTypes(undefined)).toEqual([]);
      expect(normalizeQuestionTypes(null)).toEqual([]);
      expect(normalizeQuestionTypes('not an array')).toEqual([]);
      expect(normalizeQuestionTypes([null, undefined, {}, 42])).toEqual([]);
    });

    it('keeps only the three fields it owns', () => {
      const result = normalizeQuestionTypes([
        { bloomLevel: 'Apply', questionType: QUESTION_TYPES.CALCULATION, count: 2, injected: true },
      ]);

      expect(Object.keys(result[0]).sort()).toEqual(['bloomLevel', 'count', 'questionType']);
    });
  });

  it('leaves a well-formed breakdown untouched', () => {
    const good = [
      pair('Understand', QUESTION_TYPES.MULTIPLE_CHOICE, 2),
      pair('Apply', QUESTION_TYPES.CALCULATION, 1),
    ];

    expect(normalizeQuestionTypes(good)).toEqual(good);
  });
});
