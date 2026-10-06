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

module.exports = {
  MC_OPTION_KEYS,
  MC_MIN_OPTIONS,
  MC_MAX_OPTIONS,
  MC_DEFAULT_OPTION_COUNT,
  optionKeysOf,
  optionAt,
  optionTextOf,
  correctAnswerKey,
  normalizeMcOptionCount,
};
