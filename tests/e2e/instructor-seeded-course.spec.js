const { test, expect } = require('@playwright/test');
const { BIO_PROF2_AUTH_FILE, BIO_STUDENT_AUTH_FILE } = require('./auth');
const { SEED } = require('./seed');
const { selectSeededCourse, completeSeededQuiz } = require('./helpers');

const IDP_ENABLED = process.env.E2E_SAML === '1';

test.describe('Instructor seeded course management (authenticated)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  test('shows the seeded linked section without changing it', async ({ page }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/my-sections');

    await expect(
      page.getByRole('heading', { name: 'My Sections' })
    ).toBeVisible();
    await expect(page.getByText(SEED.COURSE_NAME)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Linked sections' })
    ).toBeVisible();
    await expect(page.getByRole('cell', { name: '101' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sync Students' })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recycle' })).toBeVisible();
  });

  test('shows the seeded quiz approval and active section schedule', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/quizzes');

    await expect(
      page.getByRole('button', { name: 'Manage Quizzes' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: SEED.QUIZ_NAME })
    ).toBeVisible();
    await expect(page.getByText('100% Approved')).toBeVisible();
    await expect(page.getByText('Section schedule')).toBeVisible();
    await expect(page.getByRole('button', { name: /101\s+Active/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unpublish' })).toBeVisible();
  });

  test('reviews a real student attempt in Quiz Scores', async ({
    browser,
    page,
    baseURL,
  }) => {
    const studentContext = await browser.newContext({
      baseURL,
      storageState: BIO_STUDENT_AUTH_FILE,
    });
    try {
      const studentPage = await studentContext.newPage();
      await selectSeededCourse(studentPage, { role: 'student' });
      await completeSeededQuiz(studentPage);
    } finally {
      await studentContext.close();
    }

    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/quiz-scores');

    await expect(
      page.getByRole('heading', { name: 'Quiz Scores' })
    ).toBeVisible();
    await page.getByRole('combobox').first().selectOption({ label: SEED.QUIZ_NAME });

    const completedRow = page.getByRole('row').filter({ hasText: '100.0%' }).first();
    await expect(completedRow).toBeVisible();
    await expect(completedRow.getByText(`${SEED.QUESTION_COUNT} / ${SEED.QUESTION_COUNT}`)).toBeVisible();
    await completedRow.click();

    await expect(page.getByText(/Review:/)).toBeVisible();
    await expect(page.getByText('Score:')).toBeVisible();
    await expect(page.getByText('100.0%')).toBeVisible();
    await expect(
      page.getByText(`${SEED.QUESTION_COUNT} / ${SEED.QUESTION_COUNT} correct`)
    ).toBeVisible();
    await expect(page.getByText(SEED.CORRECT_OPTION_TEXTS[0])).toBeVisible();
  });
});
