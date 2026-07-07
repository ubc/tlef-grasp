const {
  buildCourseCode,
  campusCode,
  campusDisplaySuffix,
  sanitizeTitle,
} = require('../../src/utils/slug');

describe('slug utilities', () => {
  it('sanitizes titles into stable URL-safe slugs', () => {
    expect(sanitizeTitle('  Café & CHEM_101 -- Intro!  ')).toBe(
      'cafe-chem-101-intro'
    );
    expect(sanitizeTitle(null)).toBe('');
  });

  it('maps UBC campus reference IDs to short and display codes', () => {
    expect(campusCode('ACADEMIC_UNIT-UBC-V')).toBe('v');
    expect(campusDisplaySuffix('ACADEMIC_UNIT-UBC-O')).toBe('UBC-O');
    expect(campusCode('UNKNOWN')).toBe('');
    expect(campusDisplaySuffix('UNKNOWN')).toBe('');
  });

  it('builds course codes with a campus suffix when available', () => {
    expect(buildCourseCode('Data Science 100', 'ACADEMIC_UNIT-UBC-V')).toBe(
      'data-science-100-v'
    );
    expect(buildCourseCode('', 'ACADEMIC_UNIT-UBC-O')).toBe('o');
    expect(buildCourseCode('No Campus Course', 'UNKNOWN')).toBe('no-campus-course');
  });
});
