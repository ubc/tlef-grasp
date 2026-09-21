import { describe, it, expect } from '@jest/globals';
import {
  appendObjectiveGroups,
  itemFromGranular,
  totalQuestionsForGroups,
  withQuestionTypes,
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

// totalQuestionsForGroups backs the single number under the last card on
// step 1: "Total: 8 questions across 2 learning objectives".
//
// The shape it walks, outermost first:
//   group          one meta learning objective — one card on the page
//   item           a granular objective inside that card
//   questionTypes  one row per Bloom level and question type, each with a count
//
// So the page total is every count, of every row, of every item, of every card.
describe('totalQuestionsForGroups', () => {
  // Built by hand instead of through itemFromGranular because only
  // questionTypes matters here — and the last test needs an item whose count
  // field is deliberately wrong, which itemFromGranular would never produce.
  const item = (questionTypes, extra = {}) => ({ questionTypes, ...extra });
  const group = (items) => ({ id: 1, title: 'Objective', items });

  it('is 0 with no groups', () => {
    expect(totalQuestionsForGroups([])).toBe(0);
  });

  // Defensive rather than a state the page can reach: the helper runs inside
  // a render, so it answers 0 for whatever it is handed instead of throwing.
  it('is 0 for a missing group list', () => {
    expect(totalQuestionsForGroups(undefined)).toBe(0);
    expect(totalQuestionsForGroups(null)).toBe(0);
  });

  // A card whose granular objectives have all been deleted, and — second
  // case — a group built before any items were attached to it.
  it('is 0 for a group with no items', () => {
    expect(totalQuestionsForGroups([group([])])).toBe(0);
    expect(totalQuestionsForGroups([{ id: 1, title: 'No items yet' }])).toBe(0);
  });

  // Objectives added, but no Bloom levels picked on any of them. 0 is the
  // useful answer here: it is the page's only warning that Continue will
  // reject the step, which QuestionGeneration.jsx does for any item left
  // without Bloom levels.
  it('is 0 when items carry no question types', () => {
    expect(totalQuestionsForGroups([group([item([]), item(undefined)])])).toBe(0);
  });

  // Deleting the last question type is not the same as deleting the objective.
  // The card stays on the page, so the line has to read "0 questions across 1
  // learning objective" rather than vanish.
  it('counts 0 when the last question type is deleted, keeping the objective', () => {
    const configured = [
      group([item([{ bloomLevel: 'Remember', questionType: 'multiple-choice', count: 1 }])]),
    ];
    expect(totalQuestionsForGroups(configured)).toBe(1);

    // Routed through withQuestionTypes because that is what the page's delete
    // handler calls, so `emptied` is the exact item shape the page ends up
    // holding — count field included.
    const emptied = [group([withQuestionTypes(configured[0].items[0], [])])];
    expect(totalQuestionsForGroups(emptied)).toBe(0);
    expect(emptied).toHaveLength(1);
  });

  // Two cards, three granular objectives, five rows: 2 + 3 + 1 + 4 + 5.
  it('sums every type of every item of every group', () => {
    const groups = [
      group([
        item([
          { bloomLevel: 'Remember', questionType: 'multiple-choice', count: 2 },
          { bloomLevel: 'Understand', questionType: 'true-false', count: 3 },
        ]),
        item([{ bloomLevel: 'Apply', questionType: 'calculation', count: 1 }]),
      ]),
      group([
        item([
          { bloomLevel: 'Analyze', questionType: 'short-answer', count: 4 },
          { bloomLevel: 'Analyze', questionType: 'matching', count: 5 },
        ]),
      ]),
    ];

    expect(totalQuestionsForGroups(groups)).toBe(15);
  });

  // Every card prints its own "Total questions to generate". The page number
  // has to be those numbers added up, or the page contradicts itself.
  it('agrees with the per-group totals it is built from', () => {
    const groups = [
      group([item([{ bloomLevel: 'Remember', questionType: 'multiple-choice', count: 2 }])]),
      group([item([{ bloomLevel: 'Apply', questionType: 'calculation', count: 6 }])]),
    ];

    const perGroup = groups.map((one) => totalQuestionsForGroups([one]));
    expect(perGroup).toEqual([2, 6]);
    expect(totalQuestionsForGroups(groups)).toBe(perGroup[0] + perGroup[1]);
  });
});
