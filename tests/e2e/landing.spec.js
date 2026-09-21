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

  test('keeps the CWL sign-in as a full-page anchor, not a client-side route', async ({
    page,
  }) => {
    await page.goto('/');

    // A react-router <Link> renders an <a href> too, so the markup alone proves
    // nothing — the difference only shows on click, where <Link> preventDefaults
    // and stays in the SPA. Aborting keeps the click from carrying the test off
    // to the IdP.
    const loginLink = page.getByRole('link', { name: /log in with cwl/i });
    await expect(loginLink).toHaveAttribute('href', '/auth/ubcshib');

    await page.route('**/auth/ubcshib', (route) => route.abort());

    const [request] = await Promise.all([
      page.waitForRequest('**/auth/ubcshib', { timeout: 5_000 }),
      loginLink.click(),
    ]);

    expect(request.isNavigationRequest()).toBe(true);
  });

  test('explains what GRASP is and lists the instructor workflow steps', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(
      page.getByText(/turn course materials into evidence-based formative assessments/i)
    ).toBeVisible();

    // Landing.jsx sets role="list" explicitly because Tailwind's preflight
    // strips list semantics, so resolving by role guards that attribute too.
    const steps = page.getByRole('list').getByRole('listitem');
    await expect(steps).toHaveCount(4);
    await expect(steps.first()).toContainText(/upload lecture material/i);
    await expect(steps.last()).toContainText(/track scores/i);
  });

  test('credits the funders and offers a support contact in the footer', async ({
    page,
  }) => {
    await page.goto('/');

    const footer = page.getByRole('contentinfo');
    await expect(footer).toContainText(/Learning Technology Innovation Centre \(LTIC\)/);
    await expect(footer).toContainText(/Teaching and Learning Enhancement Fund/);

    const support = footer.getByRole('link', { name: 'LT.hub@ubc.ca' });
    await expect(support).toHaveAttribute('href', 'mailto:LT.hub@ubc.ca');
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

// /team is public, like the landing page it hangs off: neither needs a session.
test.describe('Team page (logged out)', () => {
  test('is reachable from the landing footer', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('link', { name: 'Team behind GRASP' }).click();

    await expect(page).toHaveURL('/team');
    await expect(
      page.getByRole('heading', { name: 'Meet the team behind GRASP' })
    ).toBeVisible();
  });

  test('survives a direct deep link', async ({ page }) => {
    // /team has no server route of its own: a pasted or bookmarked URL works
    // only because server.js falls back to the SPA index for non-API GETs.
    await page.goto('/team');

    await expect(
      page.getByRole('heading', { name: 'Meet the team behind GRASP' })
    ).toBeVisible();
  });
});

// The layout reflows twice: at sm the workflow cards go 2x2, at lg they go
// 4-across while the login card splits into two columns. A sideways scrollbar
// at any of those widths is a real defect on a phone.
test.describe('Landing / responsive layout (logged out)', () => {
  for (const width of [375, 768, 1024, 1440]) {
    test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');

      await expect(
        page.getByRole('heading', { name: 'Welcome to GRASP' })
      ).toBeVisible();

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  }
});
