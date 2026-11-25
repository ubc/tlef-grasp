const { QUESTION_TYPES } = require('../constants/app-constants');

const KNOWN_TYPES = Object.values(QUESTION_TYPES);

// A question's type. Legacy rows store it as `type`, or not at all; anything
// missing or unknown is multiple choice.
function resolveQuestionType(question) {
  const type = String(question?.questionType || question?.type || '').trim().toLowerCase();
  return KNOWN_TYPES.includes(type) ? type : QUESTION_TYPES.MULTIPLE_CHOICE;
}

module.exports = { resolveQuestionType };
