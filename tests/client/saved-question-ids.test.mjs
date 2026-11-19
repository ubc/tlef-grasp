import { describe, it, expect } from '@jest/globals';
import { attachSavedIds } from '../../client/src/pages/question-generation/savedQuestionIds.js';

const groups = () => [
  {
    id: 'g1',
    los: [
      { id: 'lo1', questions: [{ id: 'q1' }, { id: 'q2' }] },
      { id: 'lo2', questions: [{ id: 'q3' }] },
    ],
  },
];

const savedMap = (entries) =>
  new Map(entries.map(([id, _id]) => [id, { _id, bankSnapshot: `snap-${_id}` }]));

describe('attachSavedIds', () => {
  it('records the database id and snapshot on each saved question', () => {
    const result = attachSavedIds(
      groups(),
      savedMap([['q1', 'db1'], ['q2', 'db2'], ['q3', 'db3']])
    );
    const questions = result[0].los.flatMap((lo) => lo.questions);
    expect(questions.map((q) => q._id)).toEqual(['db1', 'db2', 'db3']);
    expect(questions[0].bankSnapshot).toBe('snap-db1');
  });

  it('leaves a question whose save failed untouched', () => {
    const result = attachSavedIds(groups(), savedMap([['q1', 'db1'], ['q3', 'db3']]));
    const questions = result[0].los.flatMap((lo) => lo.questions);
    expect(questions.map((q) => q._id)).toEqual(['db1', undefined, 'db3']);
    expect(questions[1]).toEqual({ id: 'q2' });
  });

  // Ids follow the wizard id, never the position on the page.
  it('matches by wizard id, not by position on the page', () => {
    const reordered = [{ id: 'g1', los: [{ id: 'lo1', questions: [{ id: 'q3' }, { id: 'q1' }] }] }];
    const result = attachSavedIds(reordered, savedMap([['q1', 'db1'], ['q3', 'db3']]));
    expect(result[0].los[0].questions.map((q) => [q.id, q._id])).toEqual([
      ['q3', 'db3'],
      ['q1', 'db1'],
    ]);
  });

  it('returns the groups unchanged when nothing was saved', () => {
    const input = groups();
    expect(attachSavedIds(input, new Map())).toBe(input);
    expect(attachSavedIds(input, undefined)).toBe(input);
  });
});
