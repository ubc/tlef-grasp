const { QUESTION_TYPES } = require('../constants/app-constants');

// Shared helpers for the quiz export paths (Canvas QTI, H5P, CSV). Questions
// are stored inconsistently across types: multiple-choice keeps its prompt in
// `title` (its `stem` is a generic "Select the best answer:"), while the other
// types keep the real prompt in `stem`. These helpers hide that.

// Resolve a question's internal type, defaulting to multiple-choice for legacy rows.
function normalizeQuestionType(q) {
  const t = String(q.questionType || q.type || '').toLowerCase().trim();
  if (Object.values(QUESTION_TYPES).includes(t)) return t;
  return QUESTION_TYPES.MULTIPLE_CHOICE;
}

// The student-facing question text.
function getQuestionText(q) {
  if (normalizeQuestionType(q) === QUESTION_TYPES.MULTIPLE_CHOICE) {
    return String(q.title || q.stem || q.text || q.question || '').trim();
  }
  return String(q.stem || q.question || q.text || q.title || '').trim();
}

// Options are stored as an object keyed A-D; values are strings or { text, feedback }.
function getOptionText(q, key) {
  if (!q.options || typeof q.options !== 'object') return '';
  const opt = q.options[key];
  if (typeof opt === 'string') return opt;
  return (opt && (opt.text || '')) || '';
}

// Per-option feedback for multiple-choice (empty for string-form options).
function getOptionFeedback(q, key) {
  if (!q.options || typeof q.options !== 'object') return '';
  const opt = q.options[key];
  if (!opt || typeof opt !== 'object') return '';
  return String(opt.feedback || '');
}

// correctAnswer may be a letter (A-D) or a numeric index (0-3).
function getCorrectAnswerIndex(q) {
  if (typeof q.correctAnswer === 'number') {
    return q.correctAnswer >= 0 && q.correctAnswer < 4 ? q.correctAnswer : 0;
  }
  if (typeof q.correctAnswer === 'string') {
    const idx = ['A', 'B', 'C', 'D'].indexOf(q.correctAnswer.toUpperCase());
    return idx === -1 ? 0 : idx;
  }
  return 0;
}

// Acceptable answers for fill-in-the-blank, canonical answer first, de-duplicated.
function getAcceptableAnswers(q) {
  const answers = (Array.isArray(q.acceptableAnswers) ? q.acceptableAnswers : [])
    .map((a) => String(a).trim())
    .filter(Boolean);
  const canonical = String(q.correctAnswer || '').trim();
  if (canonical && !answers.some((a) => a.toLowerCase() === canonical.toLowerCase())) {
    answers.unshift(canonical);
  }
  return answers;
}

module.exports = {
  normalizeQuestionType,
  getQuestionText,
  getOptionText,
  getOptionFeedback,
  getCorrectAnswerIndex,
  getAcceptableAnswers,
};
