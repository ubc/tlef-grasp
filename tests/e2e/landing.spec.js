const { test, expect } = require('@playwright/test');

// Logged-out flows. These use the default (unauthenticated) browser context —
// no storageState — so they need no SAML IdP and run in CI without an auth
// session. They assert real user-visible behaviour: the landing page is the
// login entry point, and the client auth guard bounces unauthenticated users
// off protected routes back to it.
test.describe('Landing / login entry point (logged out)', () => {
  test('shows the welcome heading and the CWL sign-in link', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'Welcome to GRASP' })
    ).toBeVisible();

    // The only auth entry point: a link to the SP-initiated SAML login route.
    const loginLink = page.getByRole('link', { name: /log in with cwl/i });
    await expect(loginLink).toBeVisible();
    await expect(loginLink).toHaveAttribute('href', '/auth/ubcshib');
  });

  test('sends an unauthenticated user off a protected route back to the login page', async ({
    page,
  }) => {
    // /dashboard is guarded by RequireAuth; the SPA is served for the deep link,
    // then the client guard redirects the logged-out user to the landing page.
    await page.goto('/dashboard');

    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('heading', { name: 'Welcome to GRASP' })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /log in with cwl/i })
    ).toBeVisible();
  });
});
