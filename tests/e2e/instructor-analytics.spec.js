const { test, expect } = require('@playwright/test');
const { BIO_PROF2_AUTH_FILE } = require('./auth');
const {
  FIELD_ENCRYPTION_ON,
  SEED,
  seedAnalyticsPendingAnswer,
  removeAnalyticsPendingAnswer,
} = require('./seed');
const { selectSeededCourse } = require('./helpers');

// Analytics page (PR #171) for the seeded BIOC 302 course, as its owner
// bio_prof2: every tab loads, the API answers for every view, and each CSV
// export downloads.
//
// Regression guard: the Quizzes tab's "answers awaiting grading" lookup reads
// grasp_student_attempt, which has encrypted fields. It used a $group stage,
// which the field-encryption layer refuses, so the tab showed "Could not load
// analytics" (HTTP 500) wherever encryption is on: staging, and the CI e2e run
// (which sets GRASP_DATA_ENCRYPTION_KEY). A local run without the key cannot
// catch that class of bug, so the test notes which mode it ran in.
// Opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';
const VIEWS = ['quizzes', 'questions', 'objectives'];
const TABS = ['Quizzes', 'Questions', 'Objectives'];

test.describe('Analytics (seeded course)', () => {
  test.skip(!IDP_ENABLED, 'Set E2E_SAML=1 to run against the local SAML IdP');
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  let courseId = null;
  test.beforeAll(async () => {
    ({ courseId } = await seedAnalyticsPendingAnswer());
  });
  test.afterAll(async () => {
    await removeAnalyticsPendingAnswer();
  });

  test.beforeEach(() => {
    test.info().annotations.push({
      type: 'field-encryption',
      description: FIELD_ENCRYPTION_ON
        ? 'on: covers the encrypted-collection query rules'
        : 'off: run with GRASP_DATA_ENCRYPTION_KEY set to cover the encrypted-collection query rules',
    });
  });

  test('every analytics view answers, including quizzes with an answer awaiting grading', async ({ page }) => {
    for (const view of VIEWS) {
      const response = await page.request.get(`/api/analytics/course/${courseId}/${view}`);
      expect(response.status(), `${view}: ${await response.text()}`).toBe(200);
      expect((await response.json()).success).toBe(true);
    }

    const quizzes = (await (await page.request.get(`/api/analytics/course/${courseId}/quizzes`)).json()).data;
    const names = quizzes.quizzes.map((quiz) => quiz.name);
    expect(names).toEqual(expect.arrayContaining([SEED.QUIZ_NAME, SEED.AI_QUIZ_NAME]));
  });

  test('each tab renders without the load error', async ({ page }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/analytics');
    await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();

    for (const tab of TABS) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
      // Each tab shows its "Students in scope" card once its data has loaded.
      await expect(page.getByText('Students in scope')).toBeVisible();
      await expect(page.getByText('Could not load analytics')).toHaveCount(0);
    }

    await page.getByRole('tab', { name: 'Quizzes' }).click();
    // The quiz with the answer awaiting grading has its own card.
    await expect(page.getByRole('heading', { name: SEED.AI_QUIZ_NAME, level: 2 })).toBeVisible();
  });

  test('each CSV export downloads', async ({ page }) => {
    for (const view of VIEWS) {
      const response = await page.request.get(`/api/analytics/course/${courseId}/export/${view}`);
      expect(response.status(), `${view} export: ${await response.text()}`).toBe(200);
      expect(response.headers()['content-type']).toContain('text/csv');
    }
  });
});
