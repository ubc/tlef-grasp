import { describe, it, expect } from '@jest/globals';
import { granularObjectivesPayload } from '../../client/src/pages/question-generation/objectiveGroups.js';

const group = () => ({
  items: [
    { id: 1.1, granularId: 'g1', text: 'Explain X', bloom: ['Understand'], questionTypes: [{ count: 2 }] },
    { id: 1.2, granularId: null, text: 'New one' },
  ],
  detachedItems: [{ id: 1.3, granularId: 'g3', text: 'Removed from view' }],
});

describe('granularObjectivesPayload', () => {
  it('sends the items on the page and the ones only removed from view (#41)', () => {
    const payload = granularObjectivesPayload(group());
    expect(payload.map((g) => g.text)).toEqual(['Explain X', 'New one', 'Removed from view']);
    // The database id rides along only for granulars that have one.
    expect(payload.map((g) => g.id)).toEqual(['g1', undefined, 'g3']);
  });

  // The delete path: a granular absent from the payload is deleted server-side,
  // so dropping it from items — without detaching it — is what removes it.
  it('omits a granular deleted from the database', () => {
    const g = group();
    const payload = granularObjectivesPayload({
      ...g,
      items: g.items.filter((i) => i.granularId !== 'g1'),
    });
    expect(payload.map((i) => i.text)).toEqual(['New one', 'Removed from view']);
  });

  it('defaults missing fields, and an empty group sends nothing', () => {
    expect(granularObjectivesPayload({ items: [{ id: 1, text: 'Bare' }] })).toEqual([
      { text: 'Bare', bloomTaxonomies: [], questionTypes: [] },
    ]);
    expect(granularObjectivesPayload({})).toEqual([]);
  });
});
