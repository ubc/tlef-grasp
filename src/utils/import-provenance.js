// Provenance for content imported from another system (Canvas quiz exports,
// issue #140). Questions, parent objectives and quizzes remember which Canvas
// item, group or quiz they came from, so importing the same export again finds
// them instead of creating copies. Questions also keep the reasons a
// conversion lost something (`importWarnings`), shown to instructors while the
// question is a Draft. Quizzes also list the Canvas items an import has
// decided about (`importLinkedItems`): linked to the quiz, or imported by an
// instructor who chose not to add them. All of these are for instructors only:
// student payloads drop them.

const MAX_SOURCE_FIELD_LENGTH = 200;
const MAX_IMPORT_WARNINGS = 20;
const MAX_IMPORT_WARNING_LENGTH = 300;

const QUESTION_SOURCE_KEYS = ['kind', 'quizIdent', 'itemIdent', 'slotIdent'];
const OBJECTIVE_SOURCE_KEYS = ['kind', 'quizIdent', 'slotIdent'];
const QUIZ_SOURCE_KEYS = ['kind', 'quizIdent'];

const IMPORT_ONLY_FIELDS = ['source', 'importWarnings'];
const QUIZ_IMPORT_ONLY_FIELDS = [...IMPORT_ONLY_FIELDS, 'importLinkedItems'];

// Copy exactly `keys` from a plain object whose every listed key is a string,
// each capped. Anything else returns null so the caller writes no field: a
// partial source cannot be matched on re-import anyway.
function pickImportSource(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!keys.every((key) => typeof value[key] === 'string')) return null;
  return Object.fromEntries(
    keys.map((key) => [key, value[key].slice(0, MAX_SOURCE_FIELD_LENGTH)])
  );
}

// The non-empty strings of an array, capped in count and length. Null when
// nothing is left, so a lossless import stores no field at all.
function pickImportWarnings(value) {
  if (!Array.isArray(value)) return null;
  const warnings = value
    .filter((warning) => typeof warning === 'string' && warning.trim())
    .slice(0, MAX_IMPORT_WARNINGS)
    .map((warning) => warning.slice(0, MAX_IMPORT_WARNING_LENGTH));
  return warnings.length > 0 ? warnings : null;
}

function omitFields(doc, fields) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return doc;
  const copy = { ...doc };
  fields.forEach((field) => delete copy[field]);
  return copy;
}

// A shallow copy of a question (or a question payload from a client) without
// the import-only fields; other values pass through.
function withoutImportFields(doc) {
  return omitFields(doc, IMPORT_ONLY_FIELDS);
}

// The same for a quiz document, which also carries `importLinkedItems`.
function withoutQuizImportFields(doc) {
  return omitFields(doc, QUIZ_IMPORT_ONLY_FIELDS);
}

module.exports = {
  MAX_SOURCE_FIELD_LENGTH,
  MAX_IMPORT_WARNINGS,
  MAX_IMPORT_WARNING_LENGTH,
  QUESTION_SOURCE_KEYS,
  OBJECTIVE_SOURCE_KEYS,
  QUIZ_SOURCE_KEYS,
  pickImportSource,
  pickImportWarnings,
  withoutImportFields,
  withoutQuizImportFields,
};
