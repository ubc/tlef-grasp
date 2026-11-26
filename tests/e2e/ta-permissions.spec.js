const { test, expect } = require('@playwright/test');
const { selectSeededCourse } = require('./helpers');
const { SEED } = require('./seed');
const { BIO_STUDENT3_AUTH_FILE } = require('./auth');

// Per-TA permissions (branch ta_access): the instructor promotes a seeded
// student to TA on the Users page and restricts them in the permissions
// modal, and the TA then sees only the granted pages — nav, dashboard
// widgets, route guards, and the API all agree. TAs can only ever be granted
// Dashboard, Course Materials, Question Generation and the Question Bank
// (TA_GRANTABLE_PERMISSION_KEYS); every other instructor page is closed to
// them and the modal does not offer it.
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

  test('instructor promotes a student and restricts them to Question Generation', async ({
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

    // Open the permissions editor. Only the grantable pages are offered, and
    // only the presets made of them: the old Grader preset (scores and flags)
    // is gone because neither page can be granted to a TA.
    await row.getByRole('button', { name: 'Permissions' }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: /TA Permissions/ })
    ).toBeVisible();
    await expect(dialog.getByRole('checkbox')).toHaveCount(4);
    for (const label of [/Dashboard/, /Course Materials/, /Question Generation/, /Question Bank/]) {
      await expect(dialog.getByRole('checkbox', { name: label })).toBeVisible();
    }
    for (const label of [/Quizzes/, /Quiz Scores/, /Question Flags/, /Users/, /My Sections/, /Settings/]) {
      await expect(dialog.getByRole('checkbox', { name: label })).toHaveCount(0);
    }
    await expect(dialog.getByRole('button', { name: 'Grader' })).toHaveCount(0);

    // Start from Full Access, then withhold Course Materials and the Bank.
    await dialog.getByRole('button', { name: 'Full Access' }).click();
    await expect(dialog.getByRole('checkbox')).toHaveCount(4);
    await dialog.getByRole('checkbox', { name: /Course Materials/ }).uncheck();
    await dialog.getByRole('checkbox', { name: /Question Bank/ }).uncheck();
    await expect(dialog.getByRole('checkbox', { name: /Dashboard/ })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /Question Generation/ })).toBeChecked();
    await expect(dialog.getByRole('button', { name: 'Full Access' })).toHaveAttribute('aria-pressed', 'false');
    await dialog.getByRole('button', { name: 'Save Permissions' }).click();
    await expect(page.getByText('TA permissions updated')).toBeVisible();

    // Reopen: the restricted map round-trips through the API.
    await row.getByRole('button', { name: 'Permissions' }).click();
    const reopened = page.getByRole('dialog');
    await expect(reopened.getByRole('checkbox', { name: /Dashboard/ })).toBeChecked();
    await expect(reopened.getByRole('checkbox', { name: /Question Generation/ })).toBeChecked();
    await expect(reopened.getByRole('checkbox', { name: /Course Materials/ })).not.toBeChecked();
    await expect(reopened.getByRole('checkbox', { name: /Question Bank/ })).not.toBeChecked();
    await reopened.getByRole('button', { name: 'Cancel' }).click();
  });

  test('the restricted TA only gets the granted pages, and the API enforces it', async ({
    browser,
  }) => {
    // The TA's session was saved by saml.setup.js, before the promotion: the
    // new access applies without signing in again, because req.user is loaded
    // on every request rather than kept in the session.
    const context = await browser.newContext({ baseURL: BASE_URL, storageState: BIO_STUDENT3_AUTH_FILE });
    const page = await context.newPage();
    try {
      await selectSeededCourse(page, { role: 'instructor' });
      await page.goto('/dashboard');

      // Sidebar: granted links present…
      // A nav link's accessible name starts with its icon glyph, so match the
      // label at the end of the name rather than exactly.
      const sidebar = page.locator('aside');
      const navLink = (name) =>
        sidebar.getByRole('link', { name: new RegExp(`(^|\\s)${name}$`) });
      await expect(navLink('Dashboard')).toBeVisible();
      await expect(navLink('Question Generation')).toBeVisible();
      // …withheld links absent, and so are the pages a TA can never have
      // (nav + management section + settings icon).
      for (const name of [
        'Course Materials',
        'Question Bank',
        'Quizzes',
        'Quiz Scores',
        'Question Flags',
        'Analytics',
        'My Sections',
        'Users',
        'Settings',
      ]) {
        await expect(navLink(name)).toHaveCount(0);
      }

      // Dashboard widgets follow the map too: no upload card, no schedule
      // nudge, and no flags card now that flags are closed to TAs.
      await expect(page.getByRole('link', { name: 'Upload Materials' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Schedule quizzes' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Flagged Questions' })).toHaveCount(0);

      // Route guards bounce direct navigation to a withheld or closed page.
      for (const path of ['/question-bank', '/quiz-scores', '/question-flags', '/analytics']) {
        await page.goto(path);
        await expect(page).not.toHaveURL(new RegExp(path));
      }

      // A granted page still renders.
      await page.goto('/question-generation');
      await expect(page).toHaveURL(/question-generation/);

      // API enforcement is independent of the client: roster read and
      // self-escalation are both 403 for this TA.
      const roster = await page.request.get(`/api/users/course/${courseId}`);
      expect(roster.status()).toBe(403);
      const analytics = await page.request.get(`/api/analytics/course/${courseId}/questions`);
      expect(analytics.status()).toBe(403);
      const escalate = await page.request.put(
        `/api/users/course/${courseId}/ta-permissions`,
        { data: { userId: 'anyone', permissions: { users: true } } }
      );
      expect(escalate.status()).toBe(403);
    } finally {
      await context.close();
    }
  });

  // The database-delete option is faculty-only, so a TA who can reach the
  // wizard is still offered the page-only removal — and only that. Full
  // Access puts Question Generation in reach; the demotion test below
  // restores the seed state.
  test('a TA with question generation is not offered the database delete', async ({
    page,
    browser,
  }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/users');
    await student3Row(page).getByRole('button', { name: 'Permissions' }).click();
    const permissions = page.getByRole('dialog');
    await permissions.getByRole('button', { name: 'Full Access' }).click();
    await permissions.getByRole('button', { name: 'Save Permissions' }).click();
    await expect(page.getByText('TA permissions updated')).toBeVisible();

    // A fresh context for the TA, as in the test above.
    const context = await browser.newContext({ baseURL: BASE_URL });
    const taPage = await context.newPage();
    try {
      await login(taPage, TA_USERNAME, TA_PASSWORD);
      await selectSeededCourse(taPage, { role: 'instructor' });
      await taPage.goto('/question-generation');

      // Put a seeded objective on the page; nothing here writes to it.
      await taPage.getByRole('button', { name: 'Add Existing Learning Objectives' }).click();
      await taPage.getByRole('checkbox', { name: SEED.OBJECTIVE_NAME, exact: true }).check();
      await taPage.getByRole('button', { name: 'Add 1 objective' }).click();
      await taPage.getByRole('button', { name: `Delete ${SEED.OBJECTIVE_NAME}` }).click();

      // One option, stated plainly: nothing to choose between, and no way to
      // reach the record.
      const dialog = taPage.getByRole('dialog', { name: 'Delete Learning Objective?' });
      await expect(
        dialog.getByText(/only faculty members can delete it from there/i)
      ).toBeVisible();
      await expect(dialog.getByRole('radio')).toHaveCount(0);
      await expect(
        dialog.getByRole('button', { name: /Delete from the Question Bank/ })
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  // Hiding the option is not enough: deleting an objective's questions is a
  // Question Bank delete, and the API has to refuse it from a TA too. 
  test('the API refuses a TA request to delete an objective\'s questions', async ({
    page,
    browser,
  }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    const name = `TA delete guard ${Date.now()}`;
    const created = await page.request.post('/api/objective', {
      data: { name, courseId, granularObjectives: [{ text: name }] },
    });
    expect(created.ok(), 'instructor creates a throwaway objective').toBe(true);
    const objectiveId = String((await created.json()).objective._id);

    const context = await browser.newContext({ baseURL: BASE_URL });
    const taPage = await context.newPage();
    try {
      await login(taPage, TA_USERNAME, TA_PASSWORD);

      const del = await taPage.request.delete(
        `/api/objective/${objectiveId}?questionAction=delete`
      );
      expect(del.status(), 'DELETE with questionAction=delete').toBe(403);
      expect((await del.json()).error).toMatch(/only faculty/i);

      const put = await taPage.request.put(`/api/objective/${objectiveId}`, {
        data: { granularObjectives: [], questionAction: 'delete' },
      });
      expect(put.status(), 'PUT with questionAction=delete').toBe(403);
      expect((await put.json()).error).toMatch(/only faculty/i);
    } finally {
      await context.close();
      await page.request.delete(`/api/objective/${objectiveId}?questionAction=delete`);
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
