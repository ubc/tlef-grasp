const { test, expect } = require('@playwright/test');

// The SAML login round-trip is a first-class spec, not just plumbing hidden in
// global-setup. It drives the SP-initiated login through the local
// docker-simple-saml IdP for real, so it is opt-in: it runs only with
// E2E_SAML=1 (IdP up). It uses the default, logged-out context — no
// storageState — because proving the journey works is the whole point.
const IDP_ENABLED = process.env.E2E_SAML === '1';
const USERNAME = process.env.E2E_USERNAME || 'faculty';
const PASSWORD = process.env.E2E_PASSWORD || 'faculty';

test.describe('SAML login round-trip', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');

  test('a faculty user logs in through the IdP and lands back authenticated', async ({
    page,
  }) => {
    // Start logged out on the landing page and use the app's own entry point.
    await page.goto('/');
    await page.getByRole('link', { name: /log in with cwl/i }).click();

    // Redirected to the IdP (the CWL stand-in) — its SimpleSAMLphp login form.
    await page.waitForURL(/:8080\//);
    await page.getByLabel('Login Name').fill(USERNAME);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Login', exact: true }).click();

    // Back in the app, authenticated: onboarding renders the Sign Out control,
    // and the faculty-only "New Course Setup" tab proves the role came through.
    await page.waitForURL('/onboarding');
    await expect(
      page.getByRole('button', { name: /sign out/i })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'New Course Setup' })
    ).toBeVisible();
    // And the logged-out entry point is gone.
    await expect(
      page.getByRole('link', { name: /log in with cwl/i })
    ).toHaveCount(0);
  });

  test('a wrong password keeps the user on the IdP login form', async ({ page }) => {
    await page.goto('/auth/ubcshib');

    await page.waitForURL(/:8080\//);
    await page.getByLabel('Login Name').fill(USERNAME);
    await page.getByLabel('Password').fill('definitely-the-wrong-password');
    await page.getByRole('button', { name: 'Login', exact: true }).click();

    // Still on the IdP with the form re-presented — never handed a GRASP session.
    await expect(page).toHaveURL(/:8080\//);
    await expect(page.getByLabel('Login Name')).toBeVisible();
  });
});
