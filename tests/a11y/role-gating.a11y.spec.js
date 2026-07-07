// @ts-check
const { test, expect } = require('@playwright/test');
const { expectNoA11yViolations } = require('./axe-helper');
const { STAFF_AUTH_FILE, STUDENT_AUTH_FILE } = require('../e2e/auth');
const { IDP_ENABLED } = require('./authenticated-helper');

// MANUAL: verify screen-reader clarity when role guards redirect users between
// instructor and student surfaces. Axe can confirm the reached page is valid,
// but not whether the redirect is announced in a helpful way.
test.describe('Accessibility: authenticated role boundaries', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');

  test.describe('student role', () => {
    test.use({ storageState: STUDENT_AUTH_FILE });

    test('student onboarding hides instructor course-management controls', async ({
      page,
    }) => {
      await page.goto('/onboarding');

      await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Login to Existing Dashboard' })
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'New Course Setup' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Join a course' })).toHaveCount(0);

      await expectNoA11yViolations(page);
    });

    test('student deep-link redirect lands on an accessible student dashboard', async ({
      page,
    }) => {
      await page.goto('/users');

      await expect(page).toHaveURL('/student-dashboard');
      await expect(page.getByText(/Role:\s*Student/)).toBeVisible();
      await expect(page.getByRole('link', { name: /question generation/i })).toHaveCount(0);
      await expect(page.getByRole('link', { name: /users/i })).toHaveCount(0);

      await expectNoA11yViolations(page);
    });
  });

  test.describe('staff role', () => {
    test.use({ storageState: STAFF_AUTH_FILE });

    test('staff onboarding current reachable state has no blocking axe violations', async ({
      page,
    }) => {
      await page.goto('/onboarding');

      await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Login to Existing Dashboard' })
      ).toBeVisible();

      // FINDINGS.md E2E: the local staff SAML user currently receives
      // faculty-only onboarding controls, so this a11y test scans the current
      // reachable state without asserting the intended staff business rule.
      await expectNoA11yViolations(page);
    });
  });
});
