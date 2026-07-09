const { test, expect } = require('@playwright/test');
const { STAFF_AUTH_FILE, STUDENT_AUTH_FILE } = require('./auth');

// Authenticated role-boundary coverage. These specs reuse storage states saved
// by saml.setup.js and avoid course/LLM setup: they assert the route guards and
// role-scoped onboarding controls that should be stable regardless of DB data.
const IDP_ENABLED = process.env.E2E_SAML === '1';

test.describe('Student role gating (authenticated)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');
  test.use({ storageState: STUDENT_AUTH_FILE });

  test('a student who deep-links to instructor pages lands on the student dashboard', async ({
    page,
  }) => {
    await page.goto('/users');

    await expect(page).toHaveURL('/student-dashboard');
    await expect(page.getByText(/Role:\s*Student/)).toBeVisible();
    await expect(
      page.getByRole('link', { name: /question generation/i })
    ).toHaveCount(0);
    await expect(page.getByRole('link', { name: /users/i })).toHaveCount(0);

    // The hardcoded notification bell was removed (issue #27); the sidebar's
    // Profile control still renders.
    await expect(page.getByRole('button', { name: 'Notifications' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Profile' })).toBeVisible();

    await page.goto('/question-generation');

    await expect(page).toHaveURL('/student-dashboard');
    await expect(
      page.getByRole('link', { name: /dashboard/i })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /course materials/i })
    ).toHaveCount(0);
  });

  test('student onboarding does not show instructor course-management actions', async ({
    page,
  }) => {
    await page.goto('/onboarding');

    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Login to Existing Dashboard' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'New Course Setup' })
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Join a course' })
    ).toHaveCount(0);
  });
});

test.describe('Staff role gating (authenticated)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');
  test.use({ storageState: STAFF_AUTH_FILE });

  test('staff onboarding can join courses but cannot create a new course', async ({
    page,
  }) => {
    test.fixme(
      true,
      'FINDINGS.md: the local staff SAML user currently receives faculty-only onboarding controls'
    );

    await page.goto('/onboarding');

    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Login to Existing Dashboard' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Join a course' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'New Course Setup' })
    ).toHaveCount(0);
  });
});
