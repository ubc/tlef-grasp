// @ts-check
const { test, expect } = require('@playwright/test');
const { expectNoA11yViolations } = require('./axe-helper');
const { BIO_PROF2_AUTH_FILE, BIO_STUDENT_AUTH_FILE } = require('../e2e/auth');
const { SEED, seedMultipleAnswerQuiz, removeMultipleAnswerQuiz } = require('../e2e/seed');
const { selectSeededCourse, startQuizFromList } = require('../e2e/helpers');
const { IDP_ENABLED } = require('./authenticated-helper');

// Multiple-answer questions: the student's checkbox group through a wrong
// check and the check that finds the set, and the instructor's option editor
// with checkboxes. The quiz is seeded here and removed afterwards.
// MANUAL: with a screen reader, confirm the group's "Select all that apply."
// legend is read with each checkbox, and that the hints after a check are
// found after the Check button.
test.describe('Accessibility: multiple-answer questions', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');

  test.beforeAll(async () => {
    if (!IDP_ENABLED) return;
    await removeMultipleAnswerQuiz();
    await seedMultipleAnswerQuiz();
  });

  test.afterAll(async () => {
    if (!IDP_ENABLED) return;
    await removeMultipleAnswerQuiz();
  });

  test('ticking, a wrong check and the found set have no blocking axe violations', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: BIO_STUDENT_AUTH_FILE });
    const page = await context.newPage();
    await selectSeededCourse(page, { role: 'student' });
    await page.goto('/quiz');
    await startQuizFromList(page, SEED.MA_QUIZ_NAME);
    const group = page.getByRole('group', { name: 'Select all that apply.' });
    await expect(group).toBeVisible();
    await expectNoA11yViolations(page);

    await group.getByRole('checkbox', { name: /A competitive inhibitor/ }).check();
    await group.getByRole('checkbox', { name: /noncompetitive/ }).check();
    await page.getByRole('button', { name: 'Check answer' }).click();
    await expect(page.getByText('Incorrect.')).toBeVisible();
    await expectNoA11yViolations(page);

    await group.getByRole('checkbox', { name: /mixed inhibitor/ }).check();
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByText('Correct!')).toBeVisible();
    await expectNoA11yViolations(page);
    await context.close();
  });

  test('the option editor with checkboxes has no blocking axe violations', async ({ browser }) => {
    const context = await browser.newContext({ storageState: BIO_PROF2_AUTH_FILE });
    const page = await context.newPage();
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/question-bank');

    await page
      .getByRole('row')
      .filter({ hasText: SEED.MA_QUESTION.title })
      .getByRole('button', { name: 'View/Edit' })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Mark option A as a correct answer')).toBeChecked();
    // The dialog only, as the other modal scans do: the table behind it is
    // scanned with the page.
    await expectNoA11yViolations(page, { include: '.fixed.inset-0' });
    await context.close();
  });
});
