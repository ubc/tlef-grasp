// Deterministic data for the in-repo fake Canvas (tests/e2e/stubs/fake-canvas.js).
//
// Shared by three processes, so it is plain data with no side effects:
//   - the GRASP e2e server process, which hosts the fake (start-server-with-stubs.js);
//   - the Playwright setup process, whose seed (tests/e2e/seed.js) links a GRASP
//     section to FAKE_CANVAS.COURSE_ID / SECTION_ID and stores the token below;
//   - the spec processes, which change the roster between syncs through the
//     fake's control API (tests/e2e/fake-canvas-client.js).
//
// The fake Canvas lives on 127.0.0.1 (not "localhost") so a fetch never has to
// guess between IPv4 and IPv6, and nothing is exposed beyond the loopback.

const FAKE_CANVAS_PORT = Number(process.env.E2E_FAKE_CANVAS_PORT || 9111);
const FAKE_CANVAS_HOST = '127.0.0.1';
const FAKE_CANVAS_ORIGIN = `http://${FAKE_CANVAS_HOST}:${FAKE_CANVAS_PORT}`;

// PUIDs shared by the local IdP and the FakeAcademicAPI seed (see seed.js). In
// Canvas they arrive as each user's SIS `integration_id`, which is what GRASP
// matches on.
const BIO_PROF2_PUID = '45678901';
const BIO_STUDENT_PUID = '34567890';
const BIO_STUDENT3_PUID = '67890123';
// A student who is on the Canvas roster but has never signed in to GRASP: a
// sync creates a placeholder grasp_user for this PUID. No IdP persona uses it.
const NEVER_SIGNED_IN_PUID = '99990001';
// A student whose Canvas enrollment has concluded. Canvas leaves them out of
// an active/invited roster read, so GRASP must never see them.
const CONCLUDED_PUID = '99990002';

const FAKE_CANVAS = {
  PORT: FAKE_CANVAS_PORT,
  HOST: FAKE_CANVAS_HOST,
  ORIGIN: FAKE_CANVAS_ORIGIN,

  // The bio_prof2 persona's Canvas access token. seed.js stores it in
  // grasp_lms_canvas_tokens with a far-future expiry, so GRASP never tries to
  // refresh it (the fake's token endpoint refuses refreshes, like Canvas does
  // for a revoked grant).
  TEACHER_TOKEN: 'e2e-fake-canvas-token-bio-prof2',
  TEACHER_REFRESH_TOKEN: 'e2e-fake-canvas-refresh-bio-prof2',
  TEACHER_USER_ID: '1001',

  COURSE_ID: '7001',
  COURSE_NAME: 'BIOC 302 General Biochemistry (Canvas)',
  COURSE_CODE: 'BIOC 302 2026W1',
  // The Canvas section the seeded GRASP section is linked to.
  SECTION_ID: '8101',
  SECTION_NAME: 'BIOC 302 101 (Canvas)',
  // A sibling section of the same Canvas course. Its students come back from
  // the course-wide enrollments read, so they prove GRASP scopes to the linked
  // section.
  OTHER_SECTION_ID: '8102',
  OTHER_SECTION_NAME: 'BIOC 302 102 (Canvas)',

  // Canvas user ids of the students, for the control API.
  USERS: {
    BIO_STUDENT3: '2001',
    NEVER_SIGNED_IN: '2002',
    BIO_STUDENT: '2003',
    CONCLUDED: '2005',
  },
  NEVER_SIGNED_IN_NAME: 'Casey Canvasonly',
  NEVER_SIGNED_IN_PUID,
  CONCLUDED_PUID,

  // The CANVAS_SCOPES the e2e server requests: the value README / .env.example
  // recommend for UBC's current production developer key (playwright.config.js
  // passes it to the webServer). The Canvas spec also has the fake enforce
  // exactly these scopes on the seeded token, as a scoped key would.
  SCOPES: [
    'url:GET|/api/v1/courses',
    'url:GET|/api/v1/courses/:course_id/sections',
    'url:GET|/api/v1/courses/:course_id/enrollments',
    'url:GET|/api/v1/courses/:course_id/assignments',
  ],

  // Canvas caps per_page below what the toolkit asks for (it requests 100), so
  // even this small roster comes back over several pages linked by the Link
  // header, exercising the toolkit's pagination.
  MAX_PER_PAGE: 2,
};

/**
 * The fake's starting state. Returned fresh on every call so a reset never
 * shares objects with a state a spec already changed.
 */
function defaultCanvasFixtures() {
  const created = '2026-08-01T16:00:00Z';
  const { COURSE_ID, SECTION_ID, OTHER_SECTION_ID, USERS, TEACHER_USER_ID } = FAKE_CANVAS;

  return {
    maxPerPage: FAKE_CANVAS.MAX_PER_PAGE,
    // Canvas returns sis_user_id / integration_id / login_id only to callers
    // whose role may read SIS data. The control API can switch this off to
    // reproduce a teacher without that permission.
    readSis: true,
    // null = a developer key without Enforce Scopes: any API call is allowed
    // and include[] is honoured. A list = the scopes the token was granted
    // (see PUT /__e2e/scopes).
    scopes: null,
    tokens: { [FAKE_CANVAS.TEACHER_TOKEN]: TEACHER_USER_ID },
    users: [
      {
        id: Number(TEACHER_USER_ID),
        name: 'Bio Prof Two',
        sortable_name: 'Two, Bio Prof',
        short_name: 'Bio Prof Two',
        sis_user_id: 'BIOPROF2',
        integration_id: BIO_PROF2_PUID,
        login_id: 'bio_prof2',
        email: 'bio_prof2@example.test',
        created_at: created,
      },
      {
        id: Number(USERS.BIO_STUDENT3),
        name: 'Bio Student Three',
        sortable_name: 'Three, Bio Student',
        short_name: 'Bio Student Three',
        sis_user_id: 'BIOSTU3',
        integration_id: BIO_STUDENT3_PUID,
        login_id: 'bio_student3',
        email: 'bio_student3@example.test',
        created_at: created,
      },
      {
        id: Number(USERS.NEVER_SIGNED_IN),
        name: FAKE_CANVAS.NEVER_SIGNED_IN_NAME,
        sortable_name: 'Canvasonly, Casey',
        short_name: 'Casey',
        sis_user_id: 'CCANVAS',
        integration_id: NEVER_SIGNED_IN_PUID,
        login_id: 'ccanvasonly',
        email: 'ccanvasonly@example.test',
        created_at: created,
      },
      {
        id: Number(USERS.BIO_STUDENT),
        name: 'Bio Student',
        sortable_name: 'Student, Bio',
        short_name: 'Bio Student',
        sis_user_id: 'BIOSTU1',
        integration_id: BIO_STUDENT_PUID,
        login_id: 'bio_student',
        email: 'bio_student@example.test',
        created_at: created,
      },
      {
        id: Number(USERS.CONCLUDED),
        name: 'Former Student',
        sortable_name: 'Student, Former',
        short_name: 'Former',
        sis_user_id: 'FORMER1',
        integration_id: CONCLUDED_PUID,
        login_id: 'formerstudent',
        email: 'former@example.test',
        created_at: created,
      },
    ],
    courses: [
      {
        id: Number(COURSE_ID),
        name: FAKE_CANVAS.COURSE_NAME,
        course_code: FAKE_CANVAS.COURSE_CODE,
        created_at: created,
      },
    ],
    sections: [
      { id: Number(SECTION_ID), course_id: Number(COURSE_ID), name: FAKE_CANVAS.SECTION_NAME, created_at: created },
      { id: Number(OTHER_SECTION_ID), course_id: Number(COURSE_ID), name: FAKE_CANVAS.OTHER_SECTION_NAME, created_at: created },
    ],
    enrollments: [
      { id: 9001, user_id: Number(TEACHER_USER_ID), course_id: Number(COURSE_ID), course_section_id: Number(SECTION_ID), type: 'TeacherEnrollment', enrollment_state: 'active' },
      { id: 9002, user_id: Number(USERS.BIO_STUDENT3), course_id: Number(COURSE_ID), course_section_id: Number(SECTION_ID), type: 'StudentEnrollment', enrollment_state: 'active' },
      // Invited (has not accepted yet) still counts as on the roster.
      { id: 9003, user_id: Number(USERS.NEVER_SIGNED_IN), course_id: Number(COURSE_ID), course_section_id: Number(SECTION_ID), type: 'StudentEnrollment', enrollment_state: 'invited' },
      // bio_student starts in the OTHER section, so the linked section's first
      // sync proposes dropping them from GRASP.
      { id: 9004, user_id: Number(USERS.BIO_STUDENT), course_id: Number(COURSE_ID), course_section_id: Number(OTHER_SECTION_ID), type: 'StudentEnrollment', enrollment_state: 'active' },
      { id: 9005, user_id: Number(USERS.CONCLUDED), course_id: Number(COURSE_ID), course_section_id: Number(SECTION_ID), type: 'StudentEnrollment', enrollment_state: 'completed' },
    ],
  };
}

module.exports = {
  FAKE_CANVAS,
  defaultCanvasFixtures,
};
