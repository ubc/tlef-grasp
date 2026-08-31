const { test, expect } = require('@playwright/test');
const { BIO_PROF2_AUTH_FILE } = require('./auth');

// The reorderable course switcher (issue #99). Two shells of the same course
// are indistinguishable by name alone, so the hub labels each card with its
// academic period and lets the owner add a nickname; the order the cards are
// put in is the order the sidebar switcher uses.
//
// Both writes are persisted, so every test here restores what it changed.
// Opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';

// Card order, read from the up-arrow accessible names in DOM order.
async function courseOrder(page) {
  const labels = await page.getByRole('button', { name: /^Move .* up$/ }).all();
  return Promise.all(
    labels.map(async (button) => {
      const label = await button.getAttribute('aria-label');
      return label.replace(/^Move /, '').replace(/ up$/, '');
    })
  );
}

test.describe('Course switcher ordering and nicknames', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  test('labels each course with its academic period', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();

    // Every card carries a period derived from the course's sections. The
    // fields this row used to show (instructorName, semester, expectedStudents)
    // were never written by the server and rendered blank.
    const periods = page.getByText(/Winter|Summer|No sections yet/);
    expect(await periods.count()).toBeGreaterThan(0);
  });

  test('moving a course down reorders it and survives a reload', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();

    const before = await courseOrder(page);
    test.skip(before.length < 2, 'Needs at least two courses to reorder');

    await page.getByRole('button', { name: `Move ${before[0]} down` }).click();

    const expected = [before[1], before[0], ...before.slice(2)];
    await expect
      .poll(() => courseOrder(page), { message: 'card order updates immediately' })
      .toEqual(expected);

    // The order is stored per user, not held in component state.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
    await expect.poll(() => courseOrder(page)).toEqual(expected);

    // The sidebar switcher reads the same order.
    await page.getByRole('button', { name: 'Access' }).first().click();
    const switcher = page.getByLabel('Select a course');
    await expect(switcher).toBeVisible();

    // Poll: the options are populated by the course query, not by first paint.
    await expect
      .poll(async () => {
        const optionText = await switcher.locator('option').allTextContents();
        return optionText.filter(
          (t) => t !== 'Select a course...' && !t.startsWith('+ Manage')
        )[0];
      })
      .toContain(expected[0]);

    // Restore. The card order updates optimistically, so waiting on the DOM
    // alone would let the test finish — and tear down the browser context —
    // while the PUT that persists it is still in flight.
    await page.goto('/onboarding');
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/courses/order') &&
          response.request().method() === 'PUT' &&
          response.ok()
      ),
      page.getByRole('button', { name: `Move ${before[0]} up` }).click(),
    ]);
    await expect.poll(() => courseOrder(page)).toEqual(before);
  });

  test('an owner can nickname a course and it shows in the sidebar switcher', async ({
    page,
  }) => {
    await page.goto('/onboarding');
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();

    // Only the owner gets the control, so take whichever card offers it.
    const addNickname = page.getByRole('button', { name: /^Add nickname for / }).first();
    await expect(addNickname).toBeVisible();
    const owned = (await addNickname.getAttribute('aria-label')).replace(
      /^Add nickname for /,
      ''
    );

    await addNickname.click();
    await page.getByLabel(`Nickname for ${owned}`).fill('Tuesday cohort');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Tuesday cohort')).toBeVisible();

    // The nickname is what makes the switcher option distinguishable.
    await page.getByRole('button', { name: 'Access' }).first().click();
    await expect(page.getByLabel('Select a course')).toContainText('Tuesday cohort');

    // A closed <select> truncates in the narrow sidebar, cutting off exactly
    // the nickname and period that disambiguate the course — the subtitle below
    // it is what keeps them readable without opening the dropdown.
    await expect(page.getByText(/Tuesday cohort ·/)).toBeVisible();

    // Restore: an empty nickname clears it.
    await page.goto('/onboarding');
    await page.getByRole('button', { name: `Edit nickname for ${owned}` }).click();
    await page.getByLabel(`Nickname for ${owned}`).fill('');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Tuesday cohort')).toHaveCount(0);
  });
});
