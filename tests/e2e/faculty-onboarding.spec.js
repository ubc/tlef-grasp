const { test, expect } = require('@playwright/test');
const { FACULTY_AUTH_FILE } = require('./auth');

// Demonstrates the storage-state pattern the rest of the authenticated suite
// will use: global-setup.js logs in once as faculty and saves the session, then
// specs opt in per file with `test.use({ storageState })` instead of logging in
// again. Opt-in (E2E_SAML=1) because it depends on that saved session.
const IDP_ENABLED = process.env.E2E_SAML === '1';

test.describe('Faculty onboarding (authenticated)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');
  test.use({ storageState: FACULTY_AUTH_FILE });

  test('a logged-in faculty user reaches onboarding with role-scoped options', async ({
    page,
  }) => {
    await page.goto('/onboarding');

    // Authenticated: the Sign Out control is present and the logged-out login
    // link is not — independent of whatever courses exist in the DB.
    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
    await expect(
      page.getByRole('link', { name: /log in with cwl/i })
    ).toHaveCount(0);

    // Faculty-only affordances render (a student would not see these).
    await expect(
      page.getByRole('button', { name: 'New Course Setup' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Join a course' })
    ).toBeVisible();
  });
});
