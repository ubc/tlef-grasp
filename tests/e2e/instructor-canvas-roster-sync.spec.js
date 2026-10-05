const { test, expect } = require('@playwright/test');
const { BIO_PROF2_AUTH_FILE, BIO_STUDENT_AUTH_FILE } = require('./auth');
const { SEED, seedCanvasSyncCourse, getPersonaUser } = require('./seed');
const { selectCourseByName } = require('./helpers');
const {
  FAKE_CANVAS,
  resetFakeCanvas,
  setFakeCanvasSectionStudents,
  setFakeCanvasSisVisibility,
  setFakeCanvasEnforcedScopes,
  getFakeCanvasRequests,
  clearFakeCanvasRequests,
  fakeCanvasSkipReason,
} = require('./fake-canvas-client');

// Sync students from Canvas per linked section (issue #113), as bio_prof2
// against the in-repo fake Canvas (tests/e2e/stubs/fake-canvas.js). One serial
// user story on the seeded "Canvas Roster Sync" course: section 101 is linked
// to the fake Canvas section, section 102 is not.
//
// Fake roster at the start (tests/e2e/stubs/fake-canvas-fixtures.js): in the
// linked Canvas section, bio_student3 (active) and a student who has never
// signed in to GRASP (invited); bio_student sits in the OTHER Canvas section.
// GRASP's section 101 starts with bio_student and bio_student3, so the first
// sync adds a placeholder for the new student and proposes dropping
// bio_student. bio_student joined with the invite code, so a drop takes away
// the section (and its quiz) but keeps them in the course.
//
// The fake enforces scopes throughout, like UBC's production developer key: the
// seeded token carries exactly the recommended CANVAS_SCOPES (FAKE_CANVAS.SCOPES,
// which playwright.config.js also gives the server), so any Canvas call outside
// them would 401 and any include[] GRASP relied on would be stripped.
//
// Opt-in (E2E_SAML=1). Skips itself when the server Playwright is using is not
// talking to the fake Canvas (see fakeCanvasSkipReason).
const IDP_ENABLED = process.env.E2E_SAML === '1';

const LINKED = SEED.CANVAS_LINKED_SECTION_NUMBER;
const UNLINKED = SEED.CANVAS_UNLINKED_SECTION_NUMBER;

function sectionRow(page, sectionNumber) {
  return page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: sectionNumber, exact: true }) });
}

test.describe('Canvas roster sync from My Sections (fake Canvas)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');

  let instructorContext;
  let instructor;
  let studentContext;
  let student;
  let droppedStudentName;

  test.beforeAll(async ({ browser, baseURL }) => {
    const reason = await fakeCanvasSkipReason({ baseURL, storageState: BIO_PROF2_AUTH_FILE });
    test.skip(!!reason, reason || '');

    await resetFakeCanvas();
    await setFakeCanvasEnforcedScopes(FAKE_CANVAS.SCOPES);
    await seedCanvasSyncCourse();
    droppedStudentName = (await getPersonaUser(SEED.BIO_STUDENT_PUID)).instructorName;

    instructorContext = await browser.newContext({ storageState: BIO_PROF2_AUTH_FILE });
    instructor = await instructorContext.newPage();
    await selectCourseByName(instructor, SEED.CANVAS_COURSE_NAME, { role: 'instructor' });

    studentContext = await browser.newContext({ storageState: BIO_STUDENT_AUTH_FILE });
    student = await studentContext.newPage();
    await selectCourseByName(student, SEED.CANVAS_COURSE_NAME, { role: 'student' });
  });

  test.afterAll(async () => {
    await instructorContext?.close();
    await studentContext?.close();
    // Leave the shared fake as the next suite expects to find it.
    await resetFakeCanvas().catch(() => {});
  });

  async function openMySections() {
    await instructor.goto('/my-sections');
    await expect(instructor.getByRole('heading', { name: 'Linked sections' })).toBeVisible();
    await expect(sectionRow(instructor, LINKED)).toBeVisible();
  }

  async function expectStudentSeesQuiz() {
    await student.goto('/quiz');
    await expect(student.getByRole('heading', { name: 'Available Quizzes' })).toBeVisible();
    await expect(student.getByRole('heading', { name: SEED.CANVAS_QUIZ_NAME })).toBeVisible();
  }

  test('the server gates Canvas features on the recommended scopes', async () => {
    const response = await instructor.request.get('/api/lms/canvas/status');
    expect(response.status()).toBe(200);
    // Linking and roster sync are in the recommended scopes; importing course
    // files (#141) and creating Canvas assignments (item 4) need scopes UBC's
    // key does not have yet.
    expect((await response.json()).capabilities).toEqual({
      link: true,
      rosterSync: true,
      files: false,
      assignments: false,
    });
  });

  test('an unlinked section keeps the Academic API "Sync Students" button', async () => {
    await openMySections();

    const row = sectionRow(instructor, UNLINKED);
    await expect(row.getByText('Not linked')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Sync Students' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Sync from Canvas' })).toHaveCount(0);
  });

  test('a Canvas-linked section offers "Sync from Canvas" instead', async () => {
    await openMySections();

    const row = sectionRow(instructor, LINKED);
    await expect(row.getByText(`Canvas · ${FAKE_CANVAS.SECTION_NAME}`)).toBeVisible();
    await expect(row.getByRole('button', { name: 'Sync from Canvas' })).toBeVisible();
    // The Academic API must not also sync a section Canvas owns.
    await expect(row.getByRole('button', { name: 'Sync Students' })).toHaveCount(0);
    // Never synced yet.
    await expect(row.getByText(/Last synced/)).toHaveCount(0);
  });

  test('the student sees the section quiz before any sync', async () => {
    await expectStudentSeesQuiz();
  });

  test('the first sync asks before dropping and lists who would be dropped', async () => {
    await clearFakeCanvasRequests();
    await openMySections();
    const row = sectionRow(instructor, LINKED);
    await row.getByRole('button', { name: 'Sync from Canvas' }).click();

    const dialog = instructor.getByRole('dialog', { name: 'Review Canvas sync' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/first sync since this section was linked to Canvas/)).toBeVisible();
    // add: the never-signed-in student; drop: bio_student; bio_student3 is kept.
    await expect(dialog.getByRole('term')).toHaveText([
      'Students to add',
      'Students to restore',
      'Students to drop',
      /not matched/,
    ]);
    await expect(dialog.getByRole('definition')).toHaveText(['1', '0', '1', '0']);
    const dropList = dialog.getByRole('region', { name: '1 student would be dropped' });
    await expect(dropList.getByRole('listitem')).toHaveText([droppedStudentName]);
    await expect(dialog.getByRole('button', { name: 'Sync and drop 1' })).toBeVisible();

    // GRASP re-checked the instructor teaches the course, then read the
    // course's student enrollments (to scope them to the section) page by page,
    // all within the token's scopes.
    const requests = await getFakeCanvasRequests();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.scopesEnforced), 'the fake enforced scopes').toBe(true);
    expect(
      requests.filter((r) => r.status !== 200).map((r) => `${r.method} ${r.path} → ${r.status}`),
      'every Canvas call is within the recommended scopes'
    ).toEqual([]);
    expect(
      requests.some(
        (r) =>
          r.path === '/api/v1/courses' &&
          r.query.some(([k, v]) => k === 'enrollment_type' && v === 'teacher')
      ),
      'teacher check against Canvas'
    ).toBe(true);
    const rosterReads = requests.filter(
      (r) => r.path === `/api/v1/courses/${FAKE_CANVAS.COURSE_ID}/enrollments`
    );
    expect(rosterReads.length, 'the roster spans more than one Canvas page').toBeGreaterThan(1);
    expect(rosterReads.every((r) => r.authorized && r.status === 200)).toBe(true);
    const params = (r, key) => r.query.filter(([k]) => k === key).map(([, v]) => v);
    expect(params(rosterReads[0], 'type[]')).toEqual(['StudentEnrollment']);
    expect(params(rosterReads[0], 'state[]').sort()).toEqual(['active', 'invited']);
    // A scoped key strips include parameters, so GRASP sends none.
    expect(
      requests.filter((r) => r.query.some(([k]) => /^includes?(\[\])?$/.test(k))),
      'no include parameters'
    ).toEqual([]);
    expect(rosterReads.some((r) => params(r, 'page').includes('2'))).toBe(true);

    // Cancelling applies nothing.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(row.getByText(/Last synced/)).toHaveCount(0);
  });

  test('confirming drops the student, who loses the section quiz', async () => {
    await openMySections();
    const row = sectionRow(instructor, LINKED);
    await row.getByRole('button', { name: 'Sync from Canvas' }).click();

    const dialog = instructor.getByRole('dialog', { name: 'Review Canvas sync' });
    await dialog.getByRole('button', { name: 'Sync and drop 1' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      instructor.getByText(/Synced from Canvas — 1 added, 0 restored, 1 dropped\./)
    ).toBeVisible();
    await expect(row.getByText(/Last synced/)).toBeVisible();

    await student.goto('/quiz');
    await expect(student.getByRole('heading', { name: 'No Quizzes Available' })).toBeVisible();
    await expect(student.getByRole('heading', { name: SEED.CANVAS_QUIZ_NAME })).toHaveCount(0);
  });

  test('a later sync restores the student once Canvas lists them again', async () => {
    await setFakeCanvasSectionStudents(FAKE_CANVAS.SECTION_ID, [
      FAKE_CANVAS.USERS.BIO_STUDENT3,
      FAKE_CANVAS.USERS.NEVER_SIGNED_IN,
      FAKE_CANVAS.USERS.BIO_STUDENT,
    ]);

    await openMySections();
    await sectionRow(instructor, LINKED).getByRole('button', { name: 'Sync from Canvas' }).click();

    // Nobody to drop, so no confirmation.
    await expect(
      instructor.getByText(/Synced from Canvas — 0 added, 1 restored, 0 dropped\./)
    ).toBeVisible();
    await expect(instructor.getByRole('dialog', { name: 'Review Canvas sync' })).toHaveCount(0);

    await expectStudentSeesQuiz();
  });

  test('after the first review, a small drop is applied without asking', async () => {
    // The never-signed-in student leaves the Canvas section: 1 of 3 active.
    await setFakeCanvasSectionStudents(FAKE_CANVAS.SECTION_ID, [
      FAKE_CANVAS.USERS.BIO_STUDENT3,
      FAKE_CANVAS.USERS.BIO_STUDENT,
    ]);

    await openMySections();
    await sectionRow(instructor, LINKED).getByRole('button', { name: 'Sync from Canvas' }).click();

    await expect(
      instructor.getByText(/Synced from Canvas — 0 added, 0 restored, 1 dropped\./)
    ).toBeVisible();
    await expect(instructor.getByRole('dialog', { name: 'Review Canvas sync' })).toHaveCount(0);
  });

  test('the access history records the Canvas sync', async () => {
    await instructor.goto('/users');
    await instructor.getByRole('button', { name: 'Show history' }).click();
    const history = instructor.locator('#access-history-panel');
    await expect(history).toBeVisible();

    await expect(
      history.getByText(/added .+ to a section from the Canvas roster/).first()
    ).toBeVisible();
    await expect(
      history.getByText(/restored .+ to a section from the Canvas roster/).first()
    ).toBeVisible();
    await expect(
      history.getByText(/dropped .+ from a section \(no longer on the Canvas roster\)/).first()
    ).toBeVisible();
  });

  test('without SIS permission in Canvas the sync explains why and changes nothing', async () => {
    await setFakeCanvasSisVisibility(false);

    await openMySections();
    await sectionRow(instructor, LINKED).getByRole('button', { name: 'Sync from Canvas' }).click();

    await expect(
      instructor.getByText(/without their SIS integration IDs.*Nothing was changed\./)
    ).toBeVisible();
    // Everyone still on the section keeps the quiz.
    await expectStudentSeesQuiz();
  });
});
