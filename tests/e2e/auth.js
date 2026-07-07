// Shared paths for saved SAML storage states, one per GRASP role
// (faculty / staff / student — see src/utils/auth.js). Authenticated specs opt
// in at the top of the file with e.g.:
//
//   const { FACULTY_AUTH_FILE } = require('./auth');
//   test.use({ storageState: FACULTY_AUTH_FILE });
//
// The files are produced by tests/e2e/global-setup.js when the suite is run
// with E2E_SAML=1, and are git-ignored (tests/e2e/.auth/).
const path = require('path');

const AUTH_DIR = path.join(__dirname, '.auth');

module.exports = {
  AUTH_DIR,
  FACULTY_AUTH_FILE: path.join(AUTH_DIR, 'faculty.json'),
  STAFF_AUTH_FILE: path.join(AUTH_DIR, 'staff.json'),
  STUDENT_AUTH_FILE: path.join(AUTH_DIR, 'student.json'),
  // Named personas from the local IdP + FakeAcademicAPI seed (they share PUIDs,
  // so academic-API lookups line up): bio_prof2 owns BIOC 410 and co-teaches
  // BIOC 302; bio_student / bio_student2 sit in BIOC 202+302; bio_student3 in
  // BIOC 302+410. Used by the instructor/student journey specs.
  BIO_PROF2_AUTH_FILE: path.join(AUTH_DIR, 'bio_prof2.json'),
  BIO_STUDENT_AUTH_FILE: path.join(AUTH_DIR, 'bio_student.json'),
  BIO_STUDENT3_AUTH_FILE: path.join(AUTH_DIR, 'bio_student3.json'),
};
