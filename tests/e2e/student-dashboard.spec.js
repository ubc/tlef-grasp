const { test, expect } = require('@playwright/test');
const { BIO_STUDENT_AUTH_FILE } = require('./auth');
const { SEED } = require('./seed');
const { selectSeededCourse } = require('./helpers');

const IDP_ENABLED = process.env.E2E_SAML === '1';

test.describe('Student dashboard navigation (authenticated)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_STUDENT_AUTH_FILE });

  test('shows the selected seeded course and links to available quizzes', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'student' });
    await page.goto('/student-dashboard');

    await expect(page.getByText(/Role:\s*Student/)).toBeVisible();
    await expect(page.getByRole('main').getByText(SEED.COURSE_NAME)).toBeVisible();
    await expect(page.getByRole('link', { name: 'My Quizzes' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Achievements' }).first()).toBeVisible();

    await page.getByRole('link', { name: 'View All Quizzes' }).click();

    await expect(page).toHaveURL('/quiz');
    await expect(
      page.getByRole('heading', { name: 'Available Quizzes' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: SEED.QUIZ_NAME })
    ).toBeVisible();
  });
});
