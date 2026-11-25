// The question text a student sees, for every question type (issue #223).
// The client copy of src/utils/question-prompt.js: keep the two the same.
// tests/fixtures/question-prompt-cases.json runs both against the same cases.
//
// The stem holds the question; the title is a short label for instructors.
// Older AI-made and Canvas-imported multiple-choice questions keep their
// question in the title with a generic stem ("Select the best answer:"), so
// they fall back to the title.

const GENERIC_STEMS = [
  /^select\s+the\s+best\s+answer:?$/i,
  /^fill\s+in\s+the\s+blank:?$/i,
];

function cleanText(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

/** True for a stem that is only a generic instruction, not a question. */
export function isGenericStem(stem) {
  const text = cleanText(stem);
  return GENERIC_STEMS.some((pattern) => pattern.test(text));
}

/**
 * The question text: the stem, or the title when the stem is empty or generic,
 * then an older row's `question` or `text`.
 */
export function promptOf(question) {
  const stem = cleanText(question?.stem);
  if (stem && !isGenericStem(stem)) return stem;
  return (
    cleanText(question?.title) ||
    cleanText(question?.question) ||
    cleanText(question?.text)
  );
}

/**
 * What an instructor sees for a question in the bank and other review lists:
 * the title as the main line, and the stem beneath it for reference when it
 * says something the title doesn't. A generic stem ("Select the best answer:")
 * or one that repeats the title is left out. A question without a title is
 * named by its question text.
 */
export function titleAndStem(question) {
  const title = cleanText(question?.title) || promptOf(question);
  const stem = cleanText(question?.stem);
  const showStem = stem && !isGenericStem(stem) && stem !== title;
  return { title, stem: showStem ? stem : "" };
}
