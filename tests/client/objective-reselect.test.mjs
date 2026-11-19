import { describe, it, expect } from '@jest/globals';
import {
  questionsWithDeletedObjective,
  applyObjectivePicks,
} from '../../client/src/pages/question-generation/objectiveReselect.js';

// The course's current granular objectives, as flattenGranulars() returns them.
const granulars = [
  { id: 'g-a1', name: 'Granular A1', metaId: 'm-a', metaName: 'Meta A' },
  { id: 'g-a2', name: 'Granular A2', metaId: 'm-a', metaName: 'Meta A' },
  { id: 'g-b1', name: 'Granular B1', metaId: 'm-b', metaName: 'Meta B' },
  { id: 'g-c1', name: 'Granular C1', metaId: 'm-c', metaName: 'Meta C' },
];

const question = (id, granularObjectiveId, metaCode, loCode) => ({
  id,
  granularObjectiveId,
  learningObjectiveId: `meta-of-${granularObjectiveId}`,
  metaCode,
  loCode,
});

// Step 2's page: one group per meta objective, one LO entry per question.
const page = () => [
  {
    id: 1,
    title: 'Meta A',
    isOpen: true,
    los: [
      { id: 'lo-1-1', code: 'LO 1.1', questions: [question('q1', 'g-a1', 'Meta A', 'Granular A1')] },
      { id: 'lo-1-2', code: 'LO 1.2', questions: [question('q2', 'g-gone', 'Meta A', 'Deleted')] },
    ],
  },
  {
    id: 2,
    title: 'Deleted meta',
    isOpen: true,
    los: [{ id: 'lo-2-1', code: 'LO 2.1', questions: [question('q3', 'g-old', 'Deleted meta', 'Old')] }],
  },
];

describe('questionsWithDeletedObjective', () => {
  it('finds questions whose objective is gone or was never set', () => {
    const questions = [
      question('kept', 'g-a1'),
      question('gone', 'g-gone'),
      question('none', null),
    ];
    expect(questionsWithDeletedObjective(questions, granulars).map((q) => q.id)).toEqual([
      'gone',
      'none',
    ]);
  });

  it('finds nothing when every objective still exists', () => {
    expect(questionsWithDeletedObjective([question('q1', 'g-b1')], granulars)).toEqual([]);
  });
});

describe('applyObjectivePicks', () => {
  it('gives the question the new objective and keeps it in place when the meta is the same', () => {
    const groups = applyObjectivePicks(page(), new Map([['q2', 'g-a2']]), granulars);
    expect(groups[0].los.map((lo) => lo.questions[0].id)).toEqual(['q1', 'q2']);
    expect(groups[0].los[1].questions[0]).toMatchObject({
      granularObjectiveId: 'g-a2',
      learningObjectiveId: 'm-a',
      loCode: 'Granular A2',
      metaCode: 'Meta A',
    });
  });

  it("moves the question under its new meta's group and drops the group it left empty", () => {
    const groups = applyObjectivePicks(page(), new Map([['q3', 'g-a2']]), granulars);
    expect(groups.map((g) => g.title)).toEqual(['Meta A']);
    expect(groups[0].los.map((lo) => lo.questions[0].id)).toEqual(['q1', 'q2', 'q3']);
    expect(groups[0].los[2]).toMatchObject({
      code: 'LO 1.3',
      questions: [{ id: 'q3', granularObjectiveId: 'g-a2', learningObjectiveId: 'm-a' }],
    });
  });

  it('adds a group at the end for a meta objective not on the page yet', () => {
    const groups = applyObjectivePicks(page(), new Map([['q2', 'g-c1']]), granulars);
    expect(groups.map((g) => g.title)).toEqual(['Meta A', 'Deleted meta', 'Meta C']);
    expect(groups[2]).toMatchObject({ id: 3, isOpen: true });
    expect(groups[2].los).toEqual([
      expect.objectContaining({
        code: 'LO 3.1',
        questions: [expect.objectContaining({ id: 'q2', metaCode: 'Meta C', loCode: 'Granular C1' })],
      }),
    ]);
    expect(groups[0].los.map((lo) => lo.questions[0].id)).toEqual(['q1']);
  });

  it('leaves questions without a pick, and the page passed in, untouched', () => {
    const before = page();
    const snapshot = JSON.stringify(before);
    const groups = applyObjectivePicks(before, new Map([['q3', 'g-b1']]), granulars);
    expect(groups[0]).toEqual(before[0]);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
