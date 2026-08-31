// Building the step-1 view model for a learning objective.
//
// Objectives reach this page from two places — the "Add Existing" dropdown and
// the AI generator — and both used to build the group shape inline. They now
// share appendObjectiveGroups so a batch add numbers its groups exactly as the
// same objectives added one at a time would.

import {
  questionTypesFor,
  selectedBloomLevels,
  totalQuestions,
} from "../../lib/questionTypes";

// `bloom` and `count` are projections of questionTypes, never independent
// state: a level is selected exactly when it has a type with a count, and the
// total is the sum of those counts. Every mutation goes through here so the
// three cannot drift apart — they used to, and a stale `count` was what made
// an objective generate a number of questions nobody had chosen.
export function withQuestionTypes(item, questionTypes) {
  return {
    ...item,
    questionTypes,
    bloom: selectedBloomLevels(questionTypes),
    count: totalQuestions(questionTypes),
  };
}

// Build the editor's view of a granular objective. Objectives saved before
// question types existed get an equivalent breakdown seeded from their Bloom
// levels and question count, so they open configured rather than blank.
export function itemFromGranular(granular, id) {
  return withQuestionTypes(
    {
      id,
      granularId: granular._id ? String(granular._id) : null,
      text: granular.name,
      mode: "manual",
      level: 1,
      selected: false,
    },
    questionTypesFor(granular)
  );
}

const newGroupId = () => Date.now() + Math.random();

/**
 * Append objectives to the page's group list.
 *
 * Each addition is `{ objectiveId, title, materialIds, granulars }`. Group
 * numbering continues from the list being appended to and advances with every
 * addition, so adding three objectives at once produces the same item ids as
 * adding them one after another — the batch path and the single path cannot
 * disagree about what an item is called.
 *
 * Objectives already on the page are skipped rather than duplicated. The
 * dropdown disables their rows, but the check also covers a stale selection
 * (the same objective added in another tab, say) between opening the list and
 * confirming it — a duplicate group would generate every question twice.
 *
 * @param {Array} existingGroups current groups, left untouched
 * @param {Array} additions objectives to append, in the order to append them
 * @param {() => number} makeId group-id factory, injectable for tests
 */
export function appendObjectiveGroups(existingGroups, additions, makeId = newGroupId) {
  const next = [...existingGroups];
  const present = new Set(
    next.filter((group) => group.objectiveId).map((group) => String(group.objectiveId))
  );

  (additions || []).forEach(({ objectiveId, title, materialIds, granulars }) => {
    if (objectiveId && present.has(String(objectiveId))) return;
    if (objectiveId) present.add(String(objectiveId));

    const groupNumber = next.length + 1;
    next.push({
      id: makeId(),
      objectiveId,
      title,
      isOpen: true,
      materialIds: materialIds || [],
      items: (granulars || []).map((granular, index) =>
        itemFromGranular(granular, parseFloat(`${groupNumber}.${index + 1}`))
      ),
    });
  });

  return next;
}
