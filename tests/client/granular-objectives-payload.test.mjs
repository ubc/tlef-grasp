import { describe, it, expect } from '@jest/globals';
import { granularObjectivesPayload } from '../../client/src/pages/question-generation/objectiveGroups.js';

const group = () => ({
  objectiveId: 'obj1',
  items: [
    { id: 1.1, granularId: 'g1', text: 'Explain X', bloom: ['Understand'], questionTypes: [{ bloomLevel: 'Understand', questionType: 'MCQ', count: 2 }] },
    { id: 1.2, granularId: null, text: 'New one', bloom: [], questionTypes: [] },
  ],
  detachedItems: [{ id: 1.3, granularId: 'g3', text: 'Removed from view', bloom: [], questionTypes: [] }],
});

describe('granularObjectivesPayload', () => {
  it('sends the items on the page and the ones only removed from view (#41)', () => {
    expect(granularObjectivesPayload(group()).map((g) => g.text)).toEqual([
      'Explain X',
      'New one',
      'Removed from view',
    ]);
  });

  it('carries the database id only for granulars that have one', () => {
    expect(granularObjectivesPayload(group()).map((g) => g.id)).toEqual([
      'g1',
      undefined,
      'g3',
    ]);
  });

  // The delete path: a granular absent from the payload is deleted server-side,
  // so dropping it from items — without detaching it — is what removes it.
  it('omits a granular deleted from the database', () => {
    const g = group();
    const payload = granularObjectivesPayload({
      ...g,
      items: g.items.filter((i) => i.granularId !== 'g1'),
    });
    expect(payload.map((item) => item.text)).toEqual(['New one', 'Removed from view']);
  });

  it('defaults missing bloom levels and question types to empty lists', () => {
    const payload = granularObjectivesPayload({ items: [{ id: 1, text: 'Bare' }] });
    expect(payload).toEqual([{ text: 'Bare', bloomTaxonomies: [], questionTypes: [] }]);
  });

  it('handles a group with no items at all', () => {
    expect(granularObjectivesPayload({})).toEqual([]);
  });
});
