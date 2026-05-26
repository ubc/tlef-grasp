/**
 * Convert an arbitrary title into a URL-safe slug. Mirrors WordPress'
 * `sanitize_title_with_dashes` semantics: lowercase, strip diacritics, replace
 * whitespace and unsupported chars with `-`, collapse repeats, trim ends.
 */
function sanitizeTitle(input) {
  if (input === null || input === undefined) return '';
  let s = String(input);
  s = s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9\-_\s]+/g, '');
  s = s.replace(/[\s_]+/g, '-');
  s = s.replace(/-+/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  return s;
}

const CAMPUS_CODE_BY_REFERENCE_ID = {
  'ACADEMIC_UNIT-UBC-V': 'v',
  'ACADEMIC_UNIT-UBC-O': 'o',
};

const CAMPUS_DISPLAY_SUFFIX_BY_REFERENCE_ID = {
  'ACADEMIC_UNIT-UBC-V': 'UBC-V',
  'ACADEMIC_UNIT-UBC-O': 'UBC-O',
};

/** Short campus code derived from the UBC API referenceId (e.g. 'v', 'o'). */
function campusCode(referenceId) {
  return CAMPUS_CODE_BY_REFERENCE_ID[referenceId] || '';
}

/** Human-facing campus suffix (e.g. 'UBC-V'). Empty string if unknown. */
function campusDisplaySuffix(referenceId) {
  return CAMPUS_DISPLAY_SUFFIX_BY_REFERENCE_ID[referenceId] || '';
}

/** Build `{course-name-slug}-{v|o}` from courseName + campus referenceId. */
function buildCourseCode(courseName, campusReferenceId) {
  const base = sanitizeTitle(courseName);
  const c = campusCode(campusReferenceId);
  if (!base) return c;
  return c ? `${base}-${c}` : base;
}

module.exports = { sanitizeTitle, campusCode, campusDisplaySuffix, buildCourseCode };
