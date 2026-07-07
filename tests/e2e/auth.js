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
};
