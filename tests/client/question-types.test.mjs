import { describe, it, expect } from '@jest/globals';
import {
  totalQuestions,
  levelTotal,
  pairCount,
  selectedBloomLevels,
  seedQuestionTypes,
  mergeQuestionTypes,
  questionTypesFor,
} from '../../client/src/lib/questionTypes.js';
import { MAX_QUESTIONS_PER_OBJECTIVE } from '../../client/src/lib/constants.js';

const pair = (bloomLevel, questionType, count) => ({ bloomLevel, questionType, count });

describe('derived totals', () => {
  // The card total, the chip badge, and the panel pill all read the same array.
  // They used to read it differently — reduce in two places, find in the third —
  // so a duplicated pair showed three different numbers on one screen.
  it('agree with each other on a duplicated pair', () => {
    const types = [
      pair('Analyze', 'multiple-choice', 2),
      pair('Analyze', 'multiple-choice', 3),
    ];

    expect(pairCount(types, 'Analyze', 'multiple-choice')).toBe(5);
    expect(levelTotal(types, 'Analyze')).toBe(5);
    expect(totalQuestions(types)).toBe(5);
  });

  it('ignore levels and types that are not being asked about', () => {
    const types = [pair('Apply', 'calculation', 2), pair('Analyze', 'multiple-choice', 3)];

    expect(pairCount(types, 'Apply', 'multiple-choice')).toBe(0);
    expect(levelTotal(types, 'Evaluate')).toBe(0);
    expect(totalQuestions(types)).toBe(5);
  });

  it('treat a missing array as zero rather than throwing', () => {
    expect(totalQuestions(undefined)).toBe(0);
    expect(levelTotal(null, 'Apply')).toBe(0);
    expect(selectedBloomLevels(undefined)).toEqual([]);
  });
});

describe('selectedBloomLevels', () => {
  // Selection is derived, not stored. This is what makes "a level the
  // instructor picked that generates nothing" unrepresentable.
  it('reports a level only while it has questions', () => {
    expect(selectedBloomLevels([pair('Apply', 'calculation', 1)])).toEqual(['Apply']);
    expect(selectedBloomLevels([pair('Apply', 'calculation', 0)])).toEqual([]);
  });

  it('lists each level once however many types it has', () => {
    const types = [
      pair('Apply', 'calculation', 1),
      pair('Apply', 'multiple-choice', 2),
      pair('Create', 'open-ended', 1),
    ];
    expect(selectedBloomLevels(types)).toEqual(['Apply', 'Create']);
  });

  it('goes empty when every type is zeroed, which is what blocks Continue', () => {
    expect(selectedBloomLevels([])).toEqual([]);
  });
});

describe('seedQuestionTypes', () => {
  // Objectives saved before question types existed have Bloom levels and a
  // questionCount but no breakdown. Seeding must reconstruct an equivalent one,
  // or the instructor's configuration looks wiped when they open it.
  it('preserves the question count when it divides evenly', () => {
    const seeded = seedQuestionTypes(['Understand', 'Apply'], 4);

    expect(totalQuestions(seeded)).toBe(4);
    expect(seeded.map((e) => e.count)).toEqual([2, 2]);
  });

  it('preserves the count when it does not divide evenly', () => {
    const seeded = seedQuestionTypes(['Remember', 'Understand', 'Apply'], 7);

    expect(totalQuestions(seeded)).toBe(7);
    expect(seeded.map((e) => e.count)).toEqual([3, 2, 2]);
  });

  it('keeps every original Bloom level selected', () => {
    const levels = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'];
    expect(selectedBloomLevels(seedQuestionTypes(levels, 6))).toEqual(levels);
  });

  // The one case where the total changes. A level with zero questions would
  // deselect itself, silently dropping a level the instructor had chosen, so
  // the floor of one wins over preserving the count exactly. Measured across
  // 866 real legacy rows this affects 15 — all "3 levels, 2 questions", where
  // the round-robin generates nothing for the third level today anyway.
  it('raises the total rather than dropping a level it cannot fill', () => {
    const seeded = seedQuestionTypes(['Apply', 'Analyze', 'Evaluate'], 2);

    expect(totalQuestions(seeded)).toBe(3);
    expect(seeded.every((e) => e.count >= 1)).toBe(true);
    expect(selectedBloomLevels(seeded)).toHaveLength(3);
  });

  it('gives each level a type suited to it', () => {
    const byLevel = Object.fromEntries(
      seedQuestionTypes(['Remember', 'Create'], 2).map((e) => [e.bloomLevel, e.questionType])
    );
    expect(byLevel.Remember).toBe('fill-in-the-blank');
    expect(byLevel.Create).toBe('open-ended');
  });

  // The objective total is the only cap, so a single level may hold all of it.
  it('caps the objective total however few levels share it', () => {
    const oneLevel = seedQuestionTypes(['Apply'], 500);
    expect(oneLevel[0].count).toBe(MAX_QUESTIONS_PER_OBJECTIVE);

    const everyLevel = seedQuestionTypes(
      ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'],
      500
    );
    expect(totalQuestions(everyLevel)).toBe(MAX_QUESTIONS_PER_OBJECTIVE);
  });

  it('produces nothing for an objective with no Bloom levels', () => {
    expect(seedQuestionTypes([], 4)).toEqual([]);
    expect(seedQuestionTypes(undefined, 4)).toEqual([]);
  });

  it('still selects every level when the count is missing entirely', () => {
    const seeded = seedQuestionTypes(['Understand', 'Apply'], undefined);
    expect(totalQuestions(seeded)).toBe(2);
    expect(selectedBloomLevels(seeded)).toEqual(['Understand', 'Apply']);
  });
});

describe('mergeQuestionTypes', () => {
  // The +/- handler locates a pair by its first match. Against a duplicated
  // pair it would edit one entry while the display counts both, so the stepper
  // could never reach the number on screen. Merging on load prevents that.
  it('sums a duplicated pair into one entry', () => {
    const merged = mergeQuestionTypes([
      pair('Analyze', 'multiple-choice', 2),
      pair('Analyze', 'multiple-choice', 3),
    ]);

    expect(merged).toEqual([pair('Analyze', 'multiple-choice', 5)]);
  });

  it('leaves distinct pairs alone and keeps first-seen order', () => {
    const input = [pair('Apply', 'calculation', 2), pair('Apply', 'multiple-choice', 1)];
    expect(mergeQuestionTypes(input)).toEqual(input);
  });

  // A faithful re-description: clamping here would misreport what the objective
  // is currently set to. The cap is enforced where counts change and on save.
  it('sums without clamping', () => {
    const merged = mergeQuestionTypes([
      pair('Apply', 'calculation', 4),
      pair('Apply', 'calculation', 4),
    ]);
    expect(merged[0].count).toBe(8);
  });

  it('leaves the totals unchanged, since a merge only re-describes them', () => {
    const dup = [
      pair('Remember', 'multiple-choice', 1),
      pair('Remember', 'multiple-choice', 1),
      pair('Understand', 'multiple-choice', 1),
    ];
    expect(totalQuestions(mergeQuestionTypes(dup))).toBe(totalQuestions(dup));
    expect(selectedBloomLevels(mergeQuestionTypes(dup))).toEqual(['Remember', 'Understand']);
  });

  it('survives a missing array', () => {
    expect(mergeQuestionTypes(undefined)).toEqual([]);
    expect(mergeQuestionTypes([null])).toEqual([]);
  });
});

describe('questionTypesFor', () => {
  it('uses the objective\'s own breakdown when it has one', () => {
    const own = [pair('Apply', 'calculation', 3)];
    expect(questionTypesFor({ questionTypes: own, bloomTaxonomies: ['Apply'], questionCount: 99 }))
      .toEqual(own);
  });

  it('merges duplicates stored before the merge existed', () => {
    const stored = {
      questionTypes: [
        pair('Remember', 'multiple-choice', 1),
        pair('Remember', 'multiple-choice', 1),
      ],
      bloomTaxonomies: ['Remember'],
    };
    expect(questionTypesFor(stored)).toEqual([pair('Remember', 'multiple-choice', 2)]);
  });

  it('seeds one when the breakdown is absent or empty', () => {
    const legacy = { bloomTaxonomies: ['Understand', 'Apply'], questionCount: 4 };
    expect(totalQuestions(questionTypesFor(legacy))).toBe(4);
    expect(totalQuestions(questionTypesFor({ ...legacy, questionTypes: [] }))).toBe(4);
  });
});
