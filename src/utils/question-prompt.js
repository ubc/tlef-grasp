// The question a student sees, for every question type (issue #223).
//
// The stem holds the question; the title is a short label for instructors.
// Questions written before that rule may still hold their question in the
// title: AI generation and the Canvas import gave multiple choice a generic
// stem ("Select the best answer:") and put the question in the title. Those
// fall back to the title until their stems are migrated.

// The instruction line AI generation and the Canvas import store as a
// multiple-choice stem. It is not part of the question; the quiz page shows
// its own instruction for the question type.
const MC_GENERIC_STEM = 'Select the best answer:';

const GENERIC_STEMS = [
  /^select\s+the\s+best\s+answer:?$/i,
  /^fill\s+in\s+the\s+blank:?$/i,
];

function cleanText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

// True for a stem that is only a generic instruction, not a question.
function isGenericStem(stem) {
  const text = cleanText(stem);
  return GENERIC_STEMS.some((pattern) => pattern.test(text));
}

// The question text: the stem, or the title when the stem is empty or generic.
function promptOf(question) {
  const stem = cleanText(question?.stem);
  if (stem && !isGenericStem(stem)) return stem;
  return cleanText(question?.title);
}

module.exports = {
  MC_GENERIC_STEM,
  isGenericStem,
  promptOf,
};
