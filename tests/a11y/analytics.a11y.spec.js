// @ts-check
const { test, expect } = require('@playwright/test');
const { expectNoA11yViolations } = require('./axe-helper');
const { BIO_PROF2_AUTH_FILE } = require('../e2e/auth');
const { IDP_ENABLED, prepareSeededInstructorCourse } = require('./authenticated-helper');

// Analytics is faculty-only, so it runs as bio_prof2 on the seeded BIOC 302
// course. That course has only a couple of students, so most figures render
// in their "not enough data" state — which is the state most worth checking:
// greyed rows and withheld figures must still read correctly.
//
// MANUAL: check with a screen reader that the score histogram's per-bar
// counts and the withheld-figure notes are announced in a sensible order.
const TABS = [
  { name: 'Quizzes', ready: (page) => page.getByText(/students in scope/i).first() },
  { name: 'Questions', ready: (page) => page.getByText(/students in scope/i).first() },
  { name: 'Objectives', ready: (page) => page.getByText(/students in scope/i).first() },
];

test.describe('Accessibility: analytics', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  test.beforeEach(async ({ page }) => {
    await prepareSeededInstructorCourse(page);
    await page.goto('/analytics');
    await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();
  });

  for (const tab of TABS) {
    test(`${tab.name} tab has no blocking axe violations`, async ({ page }) => {
      await page.getByRole('tab', { name: tab.name }).click();
      await expect(page.getByRole('tab', { name: tab.name })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tabpanel', { name: tab.name })).toBeVisible();
      await expect(tab.ready(page)).toBeVisible();
      await expectNoA11yViolations(page);
    });
  }

  test('tabs follow the WAI-ARIA keyboard pattern', async ({ page }) => {
    const quizzes = page.getByRole('tab', { name: 'Quizzes' });
    const questions = page.getByRole('tab', { name: 'Questions' });
    const objectives = page.getByRole('tab', { name: 'Objectives' });

    // Only the selected tab is in the Tab order.
    await expect(quizzes).toHaveAttribute('tabindex', '0');
    await expect(questions).toHaveAttribute('tabindex', '-1');

    await quizzes.focus();
    await page.keyboard.press('ArrowRight');
    await expect(questions).toBeFocused();
    await expect(questions).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Questions' })).toBeVisible();

    await page.keyboard.press('End');
    await expect(objectives).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(quizzes).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(objectives).toBeFocused();
    await page.keyboard.press('Home');
    await expect(quizzes).toBeFocused();
  });

  test('export button names the view it exports and is keyboard reachable', async ({ page }) => {
    const exportButton = page.getByRole('button', { name: 'Export Quizzes CSV' });
    await expect(exportButton).toBeEnabled();

    await page.getByRole('tab', { name: 'Objectives' }).click();
    await expect(page.getByRole('button', { name: 'Export Objectives CSV' })).toBeVisible();

    await page.getByRole('button', { name: 'Export Objectives CSV' }).focus();
    await expect(page.getByRole('button', { name: 'Export Objectives CSV' })).toBeFocused();
  });
});
