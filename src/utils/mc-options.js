const {
  MC_OPTION_KEYS,
  MC_MIN_OPTIONS,
  MC_MAX_OPTIONS,
  MC_DEFAULT_OPTION_COUNT,
} = require('../constants/app-constants');

// Multiple-choice options live in an object keyed by letter ({ A: {...}, B:
// {...} }); very old rows keep them in an array. A question has between two
// and eight of them, lettered consecutively from A (issue #144). Everything
// that reads options goes through here so no caller assumes exactly four.

// The letters present on a question, in order. Accepts both stored forms.
function optionKeysOf(options) {
  if (Array.isArray(options)) {
    return options.slice(0, MC_MAX_OPTIONS).map((_, i) => MC_OPTION_KEYS[i]);
  }
  if (!options || typeof options !== 'object') return [];
  return MC_OPTION_KEYS.filter((key) => options[key] !== undefined && options[key] !== null);
}

// One option by letter, for either stored form.
function optionAt(options, key) {
  if (Array.isArray(options)) return options[MC_OPTION_KEYS.indexOf(key)];
  if (!options || typeof options !== 'object') return undefined;
  return options[key];
}

// The displayed text of one option value ({ text } or a bare string).
function optionTextOf(raw) {
  if (raw && typeof raw === 'object') return String(raw.text ?? '');
  return raw === undefined || raw === null ? '' : String(raw);
}

// The feedback of one option value, trimmed ('' for a bare string).
function optionFeedbackOf(raw) {
  return raw && typeof raw === 'object' ? String(raw.feedback ?? '').trim() : '';
}

// Multiple choice and multiple answer keep their prompt in the title. The
// stem a student sees beneath it, only when it adds something: a stem that
// repeats the title, or a title-less question's stem (already the prompt),
// would be shown twice.
function stemBesideTitle(question) {
  const title = String(question?.title ?? '').trim();
  const stem = String(question?.stem ?? '').trim();
  return title && stem && stem !== title ? stem : '';
}

// correctAnswer as a letter. Old rows may hold a numeric index.
function correctAnswerKey(correctAnswer, fallback = 'A') {
  if (typeof correctAnswer === 'number') return MC_OPTION_KEYS[correctAnswer] || fallback;
  if (typeof correctAnswer === 'string' && correctAnswer.trim()) {
    return correctAnswer.trim().toUpperCase();
  }
  return fallback;
}

// The option count a generation request asked for. Anything missing or
// outside the allowed range falls back to the default.
function normalizeMcOptionCount(value, fallback = MC_DEFAULT_OPTION_COUNT) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < MC_MIN_OPTIONS || n > MC_MAX_OPTIONS) return fallback;
  return n;
}

// Multiple answer ("select all that apply") uses the same options. Its
// correctAnswer is the list of correct letters, e.g. ["A", "C"], and a check is
// right only when the student ticks exactly that set.

// The letters a value names, in A to H order without repeats: the stored list,
// a lone letter, a comma-separated string from a hand-written import, or
// positions. Anything else names nothing.
function answerKeysOf(value) {
  let raw = [];
  if (Array.isArray(value)) raw = value;
  else if (typeof value === 'string') raw = value.split(',');
  else if (typeof value === 'number') raw = [value];
  const named = new Set(
    raw.map((item) =>
      typeof item === 'number' ? MC_OPTION_KEYS[item] : String(item ?? '').trim().toUpperCase()
    )
  );
  return MC_OPTION_KEYS.filter((key) => named.has(key));
}

// Why a multiple-answer question could not be graded, or '' when it can: it
// needs at least two options, at least one of them correct, and no letter
// marked correct that names an option it doesn't have.
function multipleAnswerError(options, correctAnswer) {
  const keys = optionKeysOf(options);
  if (keys.length < MC_MIN_OPTIONS) {
    return `A multiple-answer question needs at least ${MC_MIN_OPTIONS} options.`;
  }
  const correct = answerKeysOf(correctAnswer);
  if (correct.length === 0) return 'Mark at least one option as correct.';
  const missing = correct.filter((key) => !keys.includes(key));
  if (missing.length > 0) {
    return `Option ${missing.join(', ')} is marked correct, but the question has no such option.`;
  }
  return '';
}

// Grade one multiple-answer check, all-or-nothing. A wrong check may tell the
// student which of the options they ticked are wrong and whether they left a
// correct one unticked, but never which one.
function gradeMultipleAnswer(correctAnswer, selected) {
  const correctKeys = answerKeysOf(correctAnswer);
  const selectedKeys = answerKeysOf(selected);
  const wrongKeys = selectedKeys.filter((key) => !correctKeys.includes(key));
  const missedCorrect = correctKeys.some((key) => !selectedKeys.includes(key));
  return {
    isCorrect: correctKeys.length > 0 && wrongKeys.length === 0 && !missedCorrect,
    correctKeys,
    selectedKeys,
    wrongKeys,
    missedCorrect,
  };
}

module.exports = {
  MC_OPTION_KEYS,
  MC_MIN_OPTIONS,
  MC_MAX_OPTIONS,
  MC_DEFAULT_OPTION_COUNT,
  optionKeysOf,
  optionAt,
  optionTextOf,
  optionFeedbackOf,
  stemBesideTitle,
  correctAnswerKey,
  normalizeMcOptionCount,
  answerKeysOf,
  multipleAnswerError,
  gradeMultipleAnswer,
};
