// @ts-check
const { test, expect } = require('@playwright/test');
const { expectNoA11yViolations } = require('./axe-helper');

// MANUAL: verify the login page's gradient/button contrast in a browser and
// confirm the CWL login journey is understandable to screen-reader users once
// the local SAML IdP-backed authenticated suite is enabled.
test.describe('Accessibility: unauthenticated pages', () => {
  test('landing page has an accessible SAML entry point and no blocking axe violations', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'Welcome to GRASP' })
    ).toBeVisible();

    const loginLink = page.getByRole('link', { name: /log in with cwl/i });
    await expect(loginLink).toBeVisible();
    await expect(loginLink).toHaveAttribute('href', '/auth/ubcshib');

    await page.keyboard.press('Tab');
    await expect(loginLink).toBeFocused();

    await expectNoA11yViolations(page);
  });

  test('protected route redirects logged-out users to an accessible login state', async ({
    page,
  }) => {
    await page.goto('/dashboard');

    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('heading', { name: 'Welcome to GRASP' })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /log in with cwl/i })
    ).toBeVisible();

    await expectNoA11yViolations(page);
  });
});
