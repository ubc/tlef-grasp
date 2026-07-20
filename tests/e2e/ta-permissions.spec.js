const { test, expect, request: apiRequest } = require('@playwright/test');
const { BIO_PROF2_AUTH_FILE } = require('./auth');
const { selectSeededCourse } = require('./helpers');
const { SEED } = require('./seed');

// Per-TA permissions (branch ta_access): the instructor promotes a seeded
// student to TA on the Users page, restricts them with the Grader preset in
// the permissions modal, and the TA's next login only unlocks the granted
// pages — nav, dashboard widgets, route guards, and the API all agree.
// Opt-in (E2E_SAML=1). The suite runs serially and demotes the TA again in
// afterAll so the shared seed state is restored for other specs.
const IDP_ENABLED = process.env.E2E_SAML === '1';

const BASE_URL = `http://localhost:${process.env.TLEF_GRASP_PORT || 8052}`;

// bio_student3 sits in the seeded BIOC 302 course (see tests/e2e/auth.js).
// Names may or may not have been enriched by a roster sync (see
// instructor-users.spec.js), so match either rendering.
const STUDENT3_ROW = /bio_student3@student\.ubc\.ca|Bennett Student|student_benji/;
const TA_USERNAME = process.env.E2E_BIO_STUDENT3_USERNAME || 'bio_student3';
const TA_PASSWORD = process.env.E2E_BIO_STUDENT3_PASSWORD || 'bio_student3';

let courseId = null;

function student3Row(page) {
  return page.getByRole('row').filter({ hasText: STUDENT3_ROW });
}

// Restore the seed state (bio_student3 = plain student) regardless of what a
// previous run left behind. Runs before AND after the suite so a mid-run
// failure can never poison the shared seeded course for other specs.
async function demoteStudent3() {
  const api = await apiRequest.newContext({
    baseURL: BASE_URL,
    storageState: BIO_PROF2_AUTH_FILE,
  });
  try {
    if (!courseId) {
      const coursesRes = await api.get('/api/courses/my');
      if (!coursesRes.ok()) return;
      const { courses = [] } = await coursesRes.json();
      const course = courses.find(
        (candidate) => (candidate.courseName || candidate.name) === SEED.COURSE_NAME
      );
      if (!course) return;
      courseId = String(course._id || course.id);
    }
    const rosterRes = await api.get(`/api/users/course/${courseId}`);
    if (!rosterRes.ok()) return;
    const roster = await rosterRes.json();
    const ta = (roster.users || []).find(
      (member) =>
        member.courseRole === 'ta' &&
        (STUDENT3_ROW.test(member.email || '') ||
          STUDENT3_ROW.test(member.displayName || ''))
    );
    if (!ta) return;
    await api.post(`/api/users/course/${courseId}/demote`, {
      data: { userId: String(ta.userId) },
    });
  } finally {
    await api.dispose();
  }
}

test.describe.serial('TA permissions (seeded course)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  test.beforeAll(async () => {
    await demoteStudent3();
  });

  test.afterAll(async () => {
    await demoteStudent3();
  });

  test('instructor promotes a student and applies the Grader preset', async ({
    page,
  }) => {
    const course = await selectSeededCourse(page, { role: 'instructor' });
    courseId = course.id;
    await page.goto('/users');

    const row = student3Row(page);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /promote to ta/i }).click();
    const promotionResponse = await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes(`/api/users/course/${courseId}/promote`) &&
        response.request().method() === 'POST'
      ),
      page.getByRole('button', { name: 'Confirm' }).click(),
    ]);
    expect(promotionResponse[0].status(), 'TA promotion succeeds').toBe(200);
    await expect(row.getByText('TA', { exact: true })).toBeVisible();

    // Open the permissions editor and apply the Grader preset.
    await row.getByRole('button', { name: 'Permissions' }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: /TA Permissions/ })
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Grader' }).click();
    await expect(dialog.getByRole('checkbox', { name: /Question Flags/ })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /Quiz Scores/ })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /Question Bank/ })).not.toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /Course Materials/ })).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Save Permissions' }).click();
    await expect(page.getByText('TA permissions updated')).toBeVisible();

    // Reopen: the restricted map round-trips through the API.
    await row.getByRole('button', { name: 'Permissions' }).click();
    const reopened = page.getByRole('dialog');
    await expect(reopened.getByRole('checkbox', { name: /Question Flags/ })).toBeChecked();
    await expect(reopened.getByRole('checkbox', { name: /Question Bank/ })).not.toBeChecked();
    await expect(reopened.getByRole('checkbox', { name: /Users/ })).not.toBeChecked();
    await reopened.getByRole('button', { name: 'Cancel' }).click();
  });

  test('the grader TA only gets the granted pages, and the API enforces it', async ({
    browser,
  }) => {
    // Fresh login: promotion applies on the TA's next login (the session
    // snapshots affiliations), so the pre-saved storage state cannot be used.
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    try {
      await page.goto('/auth/ubcshib');
      await page.getByLabel('Login Name').fill(TA_USERNAME);
      await page.getByLabel('Password').fill(TA_PASSWORD);
      await Promise.all([
        page.waitForURL(`${BASE_URL}/onboarding`, { timeout: 30_000 }),
        page.getByRole('button', { name: 'Login', exact: true }).click(),
      ]);

      await selectSeededCourse(page, { role: 'instructor' });
      await page.goto('/dashboard');

      // Sidebar: granted links present…
      await expect(page.getByRole('link', { name: 'Quiz Scores' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Question Flags' })).toBeVisible();
      // …withheld links absent (nav + management section + settings icon).
      await expect(page.getByRole('link', { name: 'Course Materials' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Question Generation' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Question Bank' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Quizzes', exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);

      // Dashboard widgets follow the map too: no content quick-start cards,
      // no course-building path, no schedule nudge — but flags stay.
      await expect(page.getByRole('link', { name: 'Upload Materials' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Generate Questions' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: /course progress|build your first quiz|continue building|course is ready/i })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Schedule quizzes' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Flagged Questions' })).toBeVisible();

      // Route guards bounce direct navigation to a withheld page.
      await page.goto('/question-bank');
      await expect(page).not.toHaveURL(/question-bank/);

      // A granted page still renders.
      await page.goto('/question-flags');
      await expect(page).toHaveURL(/question-flags/);

      // API enforcement is independent of the client: roster read and
      // self-escalation are both 403 for this TA.
      const roster = await page.request.get(`/api/users/course/${courseId}`);
      expect(roster.status()).toBe(403);
      const escalate = await page.request.put(
        `/api/users/course/${courseId}/ta-permissions`,
        { data: { userId: 'anyone', permissions: { users: true } } }
      );
      expect(escalate.status()).toBe(403);
    } finally {
      await context.close();
    }
  });

  test('instructor demotes the TA back to student', async ({ page }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/users');

    const row = student3Row(page);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /demote to student/i }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(row.getByText('Student', { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Permissions' })).toHaveCount(0);
  });
});
