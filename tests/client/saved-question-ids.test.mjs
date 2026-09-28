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

describe('attachSavedIds', () => {
  it('records the database id on each saved question', () => {
    const result = attachSavedIds(groups(), ['q1', 'q2', 'q3'], ['db1', 'db2', 'db3']);
    const questions = result[0].los.flatMap((lo) => lo.questions);
    expect(questions.map((q) => q._id)).toEqual(['db1', 'db2', 'db3']);
  });

  it('leaves a question whose save failed without an id', () => {
    const result = attachSavedIds(groups(), ['q1', 'q2', 'q3'], ['db1', null, 'db3']);
    const questions = result[0].los.flatMap((lo) => lo.questions);
    expect(questions.map((q) => q._id)).toEqual(['db1', undefined, 'db3']);
  });

  // Ids follow the wizard id, never the position on the page.
  it('matches by wizard id, not by position on the page', () => {
    const reordered = [{ id: 'g1', los: [{ id: 'lo1', questions: [{ id: 'q3' }, { id: 'q1' }] }] }];
    const result = attachSavedIds(reordered, ['q1', 'q2', 'q3'], ['db1', 'db2', 'db3']);
    expect(result[0].los[0].questions).toEqual([
      { id: 'q3', _id: 'db3' },
      { id: 'q1', _id: 'db1' },
    ]);
  });

  it('returns the groups unchanged when the server sent no ids', () => {
    const input = groups();
    expect(attachSavedIds(input, ['q1'], undefined)).toBe(input);
  });
});
