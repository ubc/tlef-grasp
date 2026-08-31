import { describe, it, expect } from '@jest/globals';
import {
  appendObjectiveGroups,
  itemFromGranular,
} from '../../client/src/pages/question-generation/objectiveGroups.js';

// Ids are otherwise Date.now()+Math.random(); a counter keeps assertions readable.
const counter = () => {
  let n = 0;
  return () => {
    n += 1;
    return n;
  };
};

const granular = (name, extra = {}) => ({ _id: `g-${name}`, name, ...extra });

const addition = (objectiveId, granulars = []) => ({
  objectiveId,
  title: `Objective ${objectiveId}`,
  materialIds: [`m-${objectiveId}`],
  granulars,
});

describe('appendObjectiveGroups', () => {
  // The point of the batch path: checking three objectives and confirming once
  // must land the same three groups the old one-at-a-time dropdown produced.
  it('appends every addition in the order given', () => {
    const groups = appendObjectiveGroups(
      [],
      [addition('lo-1'), addition('lo-2'), addition('lo-3')],
      counter()
    );

    expect(groups.map((group) => group.objectiveId)).toEqual(['lo-1', 'lo-2', 'lo-3']);
    expect(groups.map((group) => group.id)).toEqual([1, 2, 3]);
    expect(groups.every((group) => group.isOpen)).toBe(true);
    expect(groups[0].materialIds).toEqual(['m-lo-1']);
  });

  // Group numbering advances per addition rather than being read once from the
  // incoming list: three objectives added at once would otherwise all number
  // their items from the same base and collide across groups.
  it('numbers a batch exactly as adding one at a time would', () => {
    const batch = appendObjectiveGroups(
      [],
      [
        addition('lo-1', [granular('a'), granular('b')]),
        addition('lo-2', [granular('c')]),
      ],
      counter()
    );

    const oneAtATime = appendObjectiveGroups(
      appendObjectiveGroups([], [addition('lo-1', [granular('a'), granular('b')])], counter()),
      [addition('lo-2', [granular('c')])],
      () => 2
    );

    const itemIds = (groups) => groups.map((group) => group.items.map((item) => item.id));
    expect(itemIds(batch)).toEqual([[1.1, 1.2], [2.1]]);
    expect(itemIds(batch)).toEqual(itemIds(oneAtATime));
  });

  it('continues numbering from the groups already on the page', () => {
    const existing = appendObjectiveGroups([], [addition('lo-1', [granular('a')])], counter());
    const groups = appendObjectiveGroups(existing, [addition('lo-2', [granular('b')])], () => 9);

    expect(groups).toHaveLength(2);
    expect(groups[1].items[0].id).toBe(2.1);
    // The existing array is not mutated — it is React state.
    expect(existing).toHaveLength(1);
  });

  // A duplicate group would generate every one of that objective's questions
  // twice, so a stale selection is dropped rather than trusted.
  it('skips objectives already on the page', () => {
    const existing = appendObjectiveGroups([], [addition('lo-1')], counter());
    const groups = appendObjectiveGroups(existing, [addition('lo-1'), addition('lo-2')], () => 7);

    expect(groups.map((group) => group.objectiveId)).toEqual(['lo-1', 'lo-2']);
  });

  it('skips a duplicate inside one batch', () => {
    const groups = appendObjectiveGroups([], [addition('lo-1'), addition('lo-1')], counter());

    expect(groups).toHaveLength(1);
  });

  it('tolerates an objective with no granulars', () => {
    const groups = appendObjectiveGroups([], [{ objectiveId: 'lo-1', title: 'Empty' }], counter());

    expect(groups[0].items).toEqual([]);
    expect(groups[0].materialIds).toEqual([]);
  });
});

describe('itemFromGranular', () => {
  it('derives bloom levels and count from the stored question types', () => {
    const item = itemFromGranular(
      granular('Explain ATP', {
        questionTypes: [
          { bloomLevel: 'Understand', questionType: 'multiple-choice', count: 2 },
          { bloomLevel: 'Apply', questionType: 'calculation', count: 1 },
        ],
      }),
      1.1
    );

    expect(item.granularId).toBe('g-Explain ATP');
    expect(item.text).toBe('Explain ATP');
    expect(item.bloom).toEqual(['Understand', 'Apply']);
    expect(item.count).toBe(3);
    expect(item.mode).toBe('manual');
  });

  // Objectives saved before question types existed must open configured, not
  // blank — the seeding path in questionTypesFor covers that.
  it('seeds a breakdown for a legacy granular that has none', () => {
    const item = itemFromGranular(
      granular('Legacy', { bloomTaxonomies: ['Remember', 'Understand'], questionCount: 4 }),
      1.1
    );

    expect(item.bloom).toEqual(['Remember', 'Understand']);
    expect(item.count).toBe(4);
  });

  it('leaves granularId null for a granular that is not saved yet', () => {
    const item = itemFromGranular({ name: 'Unsaved' }, 2.1);

    expect(item.granularId).toBeNull();
    expect(item.count).toBe(0);
  });
});
