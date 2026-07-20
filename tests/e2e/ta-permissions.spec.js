const { test, expect } = require('@playwright/test');
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
const INSTRUCTOR_USERNAME = process.env.E2E_BIO_PROF2_USERNAME || 'bio_prof2';
const INSTRUCTOR_PASSWORD = process.env.E2E_BIO_PROF2_PASSWORD || 'bio_prof2';
const TA_USERNAME = process.env.E2E_BIO_STUDENT3_USERNAME || 'bio_student3';
const TA_PASSWORD = process.env.E2E_BIO_STUDENT3_PASSWORD || 'bio_student3';

let courseId = null;

function student3Row(page) {
  return page.getByRole('row').filter({ hasText: STUDENT3_ROW });
}

async function login(page, username, password) {
  // Do not reuse a saved app session: Mongo-backed sessions can legitimately
  // disappear between the setup project and a retried test.
  await page.context().clearCookies();
  await page.goto('/auth/ubcshib');
  await page.getByLabel('Login Name').fill(username);
  await page.getByLabel('Password').fill(password);
  await Promise.all([
    page.waitForURL(/\/onboarding(?:\?.*)?$/i, { timeout: 30_000 }),
    page.getByRole('button', { name: 'Login', exact: true }).click(),
  ]);
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
}

// Restore the seed state using the current, freshly authenticated instructor
// session. A failed run can therefore be rerun without stale TA state.
async function demoteStudent3(api) {
  const rosterRes = await api.get(`/api/users/course/${courseId}`);
  expect(rosterRes.ok(), 'instructor can read the seeded roster').toBe(true);
  const roster = await rosterRes.json();
  const ta = (roster.users || []).find(
    (member) =>
      member.courseRole === 'ta' &&
      (STUDENT3_ROW.test(member.email || '') ||
        STUDENT3_ROW.test(member.displayName || ''))
  );
  if (!ta) return;
  const demotion = await api.post(`/api/users/course/${courseId}/demote`, {
    data: { userId: String(ta.userId) },
  });
  expect(demotion.ok(), 'resetting the seeded TA succeeds').toBe(true);
}

test.describe.serial('TA permissions (seeded course)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');

  test.beforeEach(async ({ page }) => {
    await login(page, INSTRUCTOR_USERNAME, INSTRUCTOR_PASSWORD);
  });

  test('instructor promotes a student and applies the Grader preset', async ({
    page,
  }) => {
    const course = await selectSeededCourse(page, { role: 'instructor' });
    courseId = course.id;
    await demoteStudent3(page.request);
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
      await login(page, TA_USERNAME, TA_PASSWORD);

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
