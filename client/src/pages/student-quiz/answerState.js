import { QUESTION_TYPES } from "../../lib/constants";

// A question's feedback entry is the student's first answer — the one that is
// graded — plus, once that was wrong, the latest ungraded retry (issue #128).
// Multiple-choice and calculation answers can be retried, and the server never
// sends their correct answer for a wrong one, so a student only ever sees it
// by finding it. Fill-in-the-blank and open-ended answers are submitted once
// and show the answer straight away: retrying a typed answer would only invite
// guessing (and a paid LLM grading call per guess).

const ONE_ATTEMPT_TYPES = new Set([
  QUESTION_TYPES.FILL_IN_THE_BLANK,
  QUESTION_TYPES.OPEN_ENDED,
]);

// The student has found the correct answer, on the first try or a retry.
export function isSolved(entry) {
  return entry?.isCorrect === true || entry?.retry?.isCorrect === true;
}

// A wrong multiple-choice or calculation answer stays open until solved.
export function canRetry(entry) {
  return (
    !!entry &&
    !entry.openEnded &&
    !ONE_ATTEMPT_TYPES.has(entry.questionType) &&
    !isSolved(entry)
  );
}

// The most recent check, which is what the feedback panel describes.
export function latestResult(entry) {
  return entry?.retry || entry || null;
}

// Fold a check result into the question's entry: the first check becomes the
// graded answer and each later one replaces the previous retry. Wrong
// multiple-choice options are collected so they stay marked and can't be
// picked again.
export function recordCheck(entry, result) {
  const wrongKeys = entry?.wrongKeys ? [...entry.wrongKeys] : [];
  if (
    result.questionType === QUESTION_TYPES.MULTIPLE_CHOICE &&
    result.isCorrect === false &&
    result.selectedKey &&
    !wrongKeys.includes(result.selectedKey)
  ) {
    wrongKeys.push(result.selectedKey);
  }
  if (!entry) return { ...result, retry: null, wrongKeys };
  return { ...entry, retry: result, wrongKeys };
}
