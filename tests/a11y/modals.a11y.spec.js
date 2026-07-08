// @ts-check
const { test, expect } = require('@playwright/test');
const { expectNoA11yViolations } = require('./axe-helper');
const { FACULTY_AUTH_FILE } = require('../e2e/auth');
const {
  IDP_ENABLED,
  prepareAuthenticatedCourse,
} = require('./authenticated-helper');

// MANUAL: verify screen-reader announcement of modal titles, that focus returns
// to the trigger after close, and that the background is inert while each modal
// is open. Axe does not fully validate modal focus trapping.
test.describe('Accessibility: dialogs and modal states', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');
  test.use({ storageState: FACULTY_AUTH_FILE });

  test('text material dialog open state has no blocking axe violations', async ({
    page,
  }) => {
    await prepareAuthenticatedCourse(page);
    await page.goto('/course-materials');

    await expect(page.getByRole('heading', { name: 'Course Materials' })).toBeVisible();
    await page.getByRole('button', { name: 'Text' }).click();
    await expect(page.getByText('Add Text Content')).toBeVisible();

    await expectNoA11yViolations(page, { include: '.fixed.inset-0' });
  });

  test('text material dialog closes with Escape', async ({ page }) => {
    await prepareAuthenticatedCourse(page);
    await page.goto('/course-materials');

    await page.getByRole('button', { name: 'Text' }).click();
    await expect(page.getByText('Add Text Content')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByText('Add Text Content')).toBeHidden();
    await expectNoA11yViolations(page);
  });

  test(
    'text material dialog exposes dialog semantics and returns focus to the trigger',
    async ({ page }) => {
      await prepareAuthenticatedCourse(page);
      await page.goto('/course-materials');

      const trigger = page.getByRole('button', { name: 'Text' });
      await trigger.focus();
      await page.keyboard.press('Enter');

      // See FINDINGS.md Accessibility: Modal lacks dialog role/focus management.
      const dialog = page.getByRole('dialog', { name: 'Add Text Content' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    }
  );
});
