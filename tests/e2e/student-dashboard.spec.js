const { test, expect } = require('@playwright/test');
const { BIO_PROF2_AUTH_FILE, BIO_STUDENT_AUTH_FILE } = require('./auth');
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
    // Seeded quiz attempts can survive between CI retries, so only assert the
    // course-aware progress shape—not a specific completion count or heading.
    const progress = page.getByRole('region');
    await expect(progress.getByText(/\d of 3 learning steps completed in this course\./)).toBeVisible();
    await expect(progress.getByRole('link', { name: 'Complete a quiz' }).first()).toBeVisible();
    await page.getByText('How GRASP works').click();
    await expect(page.getByRole('link', { name: 'Take practice quizzes' })).toBeVisible();

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

test.describe('Instructor student preview (authenticated)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  test('keeps the selected instructor course and shows student progress', async ({ page }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Switch View' }).click();

    await expect(page).toHaveURL('/student-dashboard');
    const progress = page.getByRole('region');
    await expect(progress.getByText('Student preview:')).toBeVisible();
    await expect(page.getByRole('main').getByText(SEED.COURSE_NAME)).toBeVisible();
  });
});
