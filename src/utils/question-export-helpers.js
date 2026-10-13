const { QUESTION_TYPES } = require('../constants/app-constants');
const { MC_OPTION_KEYS, optionKeysOf, optionAt, correctAnswerKey } = require('./mc-options');

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

// The letters a multiple-choice question exports, in order: whatever it has
// (two to eight), or A to D for a legacy row with no options at all.
function getOptionKeys(q) {
  const keys = optionKeysOf(q.options);
  return keys.length > 0 ? keys : MC_OPTION_KEYS.slice(0, 4);
}

// Options are stored as an object keyed by letter; values are strings or { text, feedback }.
function getOptionText(q, key) {
  const opt = optionAt(q.options, key);
  if (typeof opt === 'string') return opt;
  return (opt && (opt.text || '')) || '';
}

// One option's attached image ref (issue #146), or null.
function getOptionImage(q, key) {
  const opt = optionAt(q.options, key);
  return opt && typeof opt === 'object' && opt.image && opt.image.fileId ? opt.image : null;
}

// What an export that cannot carry option images (H5P, CSV) writes for an
// option: its text, or for an image-only option the image's caption, or
// "Option B (image)" so it is never blank. Empty when the option has neither.
function getOptionTextOrImageLabel(q, key) {
  const text = getOptionText(q, key);
  if (text.trim()) return text;
  const image = getOptionImage(q, key);
  if (!image) return text;
  return String(image.caption || '').trim() || `Option ${key} (image)`;
}

// Per-option feedback for multiple-choice (empty for string-form options).
function getOptionFeedback(q, key) {
  const opt = optionAt(q.options, key);
  if (!opt || typeof opt !== 'object') return '';
  return String(opt.feedback || '');
}

// The correct option's position among getOptionKeys(q). correctAnswer may be
// a letter or a numeric index; anything that names no option becomes 0.
function getCorrectAnswerIndex(q) {
  const keys = getOptionKeys(q);
  if (typeof q.correctAnswer === 'number') {
    return q.correctAnswer >= 0 && q.correctAnswer < keys.length ? q.correctAnswer : 0;
  }
  const idx = keys.indexOf(correctAnswerKey(q.correctAnswer, ''));
  return idx === -1 ? 0 : idx;
}

// Instructor-attached stem images as an array (handles the legacy
// single-image field).
function stemImagesOf(q) {
  if (Array.isArray(q.stemImages)) return q.stemImages;
  return q.stemImage ? [q.stemImage] : [];
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
  getOptionKeys,
  getOptionText,
  getOptionImage,
  getOptionTextOrImageLabel,
  getOptionFeedback,
  getCorrectAnswerIndex,
  getAcceptableAnswers,
  stemImagesOf,
};
