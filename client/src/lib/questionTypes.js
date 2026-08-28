// The question-type breakdown is the single source of truth for how many
// questions a granular objective generates, and for which Bloom levels it
// covers. Every derivation lives here so the card, the chip badges, the type
// panel, and the generation request cannot disagree about the same array —
// they previously did, one reading it with find() and the rest with reduce().
//
// Shape: [{ bloomLevel, questionType, count }]

import {
  QUESTION_TYPES,
  DEFAULT_BLOOM_TYPE_PREFERENCES,
  MAX_QUESTIONS_PER_OBJECTIVE,
} from "./constants";

/** Total questions across every Bloom level and type. */
export function totalQuestions(questionTypes) {
  return (questionTypes || []).reduce((sum, qt) => sum + (qt.count || 0), 0);
}

/** Total questions for one Bloom level, across all its types. */
export function levelTotal(questionTypes, bloomLevel) {
  return (questionTypes || [])
    .filter((qt) => qt.bloomLevel === bloomLevel)
    .reduce((sum, qt) => sum + (qt.count || 0), 0);
}

/** Questions for one (level, type) pair. Sums rather than taking the first
 *  match, so a duplicated pair agrees with the totals above. */
export function pairCount(questionTypes, bloomLevel, questionType) {
  return (questionTypes || [])
    .filter((qt) => qt.bloomLevel === bloomLevel && qt.questionType === questionType)
    .reduce((sum, qt) => sum + (qt.count || 0), 0);
}

/**
 * The Bloom levels this objective covers. Selection is derived, never stored
 * separately: a level is selected exactly when it has a question type with a
 * count above zero. Zeroing a level's last type therefore un-checks it, and a
 * selected level with no way to generate anything cannot exist.
 */
export function selectedBloomLevels(questionTypes) {
  const seen = [];
  (questionTypes || []).forEach((qt) => {
    if ((qt.count || 0) > 0 && !seen.includes(qt.bloomLevel)) seen.push(qt.bloomLevel);
  });
  return seen;
}

/** The default question type for a Bloom level, used when seeding one. */
export function defaultTypeForLevel(bloomLevel) {
  return (
    (DEFAULT_BLOOM_TYPE_PREFERENCES[bloomLevel] || [])[0] || QUESTION_TYPES.MULTIPLE_CHOICE
  );
}

/**
 * Build a breakdown for an objective saved before question types existed.
 *
 * Such an objective carries Bloom levels and a `questionCount` but no types, so
 * under a model where selection is derived it would open with every chip grey
 * and a total of zero — its configuration would look wiped. Seeding
 * reconstructs an equivalent breakdown from what it does have, in memory only:
 * nothing is written until the instructor saves the objective.
 *
 * Each level gets its default type and an even share of the count. The share is
 * floored at one per level, because a level with no questions would immediately
 * deselect itself and lose a level the instructor had chosen. That floor is the
 * only case where the total changes — measured across 866 real legacy rows, 851
 * keep their count exactly and 15 gain a single question, all of them objectives
 * with three Bloom levels but only two questions, where today the third level
 * silently generates nothing anyway.
 */
export function seedQuestionTypes(bloomLevels, questionCount) {
  const levels = (bloomLevels || []).filter(Boolean);
  if (levels.length === 0) return [];

  const target = Math.min(
    MAX_QUESTIONS_PER_OBJECTIVE,
    Math.max(levels.length, parseInt(questionCount, 10) || 0)
  );
  const base = Math.floor(target / levels.length);
  const remainder = target % levels.length;

  return levels.map((level, index) => ({
    bloomLevel: level,
    questionType: defaultTypeForLevel(level),
    count: base + (index < remainder ? 1 : 0),
  }));
}

/**
 * Collapse repeated (bloomLevel, questionType) pairs into one entry.
 *
 * Two entries naming the same pair are not two things to generate, they are one
 * thing said twice — the server merges them the same way. Doing it on load
 * matters because the +/- handler finds a pair by its first match: against a
 * duplicated pair it would edit only one of the two entries while the displayed
 * total counts both, so the stepper could never reach the number on screen.
 * Objectives stored before the merge existed can still carry duplicates.
 *
 * A faithful re-description, so it does not clamp: the objective cap is enforced
 * where counts are changed and again on save, and silently shrinking a stored
 * total here would misreport what the objective is currently set to.
 */
export function mergeQuestionTypes(questionTypes) {
  const merged = new Map();
  (questionTypes || []).forEach((qt) => {
    if (!qt) return;
    const key = JSON.stringify([qt.bloomLevel, qt.questionType]);
    const existing = merged.get(key);
    if (existing) existing.count += qt.count || 0;
    else merged.set(key, { bloomLevel: qt.bloomLevel, questionType: qt.questionType, count: qt.count || 0 });
  });
  return [...merged.values()];
}

/**
 * The breakdown to render for a granular objective: its own if it has one,
 * otherwise a seeded equivalent. Callers never need to know which they got.
 */
export function questionTypesFor(granular) {
  const existing = granular?.questionTypes;
  if (Array.isArray(existing) && existing.length > 0) return mergeQuestionTypes(existing);
  return seedQuestionTypes(granular?.bloomTaxonomies, granular?.questionCount);
}
