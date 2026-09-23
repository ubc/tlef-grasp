// @ts-check
const { test, expect } = require('@playwright/test');
const { expectNoA11yViolations } = require('./axe-helper');
const { FACULTY_AUTH_FILE, BIO_PROF2_AUTH_FILE } = require('../e2e/auth');
const {
  IDP_ENABLED,
  prepareAuthenticatedCourse,
} = require('./authenticated-helper');
const { SEED, seedCanvasSyncCourse } = require('../e2e/seed');
const { selectCourseByName } = require('../e2e/helpers');
const { resetFakeCanvas, fakeCanvasSkipReason } = require('../e2e/fake-canvas-client');

// MANUAL: verify screen-reader announcement of modal titles, that focus returns
// to the trigger after close, and that the background is inert while each modal
// is open. Axe does not fully validate modal focus trapping.
test.describe('Accessibility: dialogs and modal states', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');
  test.use({ storageState: FACULTY_AUTH_FILE });

  test('upload modal method selection and file step have no blocking axe violations', async ({
    page,
  }) => {
    await prepareAuthenticatedCourse(page);
    await page.goto('/course-materials');

    await expect(page.getByRole('heading', { name: 'Course Materials' })).toBeVisible();

    // Step 1: method selection (file vs text; the URL path is intentionally
    // absent for privacy reasons).
    const uploadFileTile = page.getByRole('button', { name: 'Upload File' });
    await expect(uploadFileTile).toBeVisible();
    await expect(page.getByRole('button', { name: 'URL' })).toHaveCount(0);
    await expectNoA11yViolations(page, { include: '.fixed.inset-0' });

    // Step 2: the file drop zone with the supported-format hint.
    await uploadFileTile.click();
    await expect(page.getByRole('button', { name: 'Choose file' })).toBeVisible();
    await expect(page.getByText('Supported formats:')).toBeVisible();
    await expectNoA11yViolations(page, { include: '.fixed.inset-0' });
  });

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

      // The Text tile lives inside the Upload Materials modal and unmounts
      // when the text dialog opens, so focus cannot return to it. The focus
      // contract is with the persistent page button that started the chain:
      // close the auto-opened upload modal, then reopen it from the trigger
      // so the restore chain (upload modal → text dialog → trigger) is real.
      const trigger = page.getByRole('button', { name: 'Upload Materials' });
      await expect(page.getByRole('dialog', { name: 'Upload Materials' })).toBeVisible();
      await page.keyboard.press('Escape');

      await trigger.focus();
      await page.keyboard.press('Enter');
      const textTile = page.getByRole('button', { name: 'Text' });
      await textTile.focus();
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

// MANUAL: verify a screen reader reads the sync reason before the drop list,
// and that the danger-styled "Sync and drop N" button is announced with its
// count. Axe cannot judge whether the explanation is understandable.
test.describe('Accessibility: Canvas roster sync confirmation', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  test.beforeEach(async ({ baseURL }) => {
    // The dialog only exists when the server syncs against the in-repo fake
    // Canvas (see tests/e2e/fake-canvas-client.js).
    const reason = await fakeCanvasSkipReason({ baseURL, storageState: BIO_PROF2_AUTH_FILE });
    test.skip(!!reason, reason || '');
    // A linked, never-synced section whose first sync proposes a drop. The
    // dialog applies nothing until confirmed, and this test only cancels.
    await resetFakeCanvas();
    await seedCanvasSyncCourse();
  });

  test('first-sync review dialog has no blocking axe violations and handles focus', async ({
    page,
  }) => {
    await selectCourseByName(page, SEED.CANVAS_COURSE_NAME, { role: 'instructor' });
    await page.goto('/my-sections');

    const trigger = page
      .getByRole('row')
      .filter({
        has: page.getByRole('cell', { name: SEED.CANVAS_LINKED_SECTION_NUMBER, exact: true }),
      })
      .getByRole('button', { name: 'Sync from Canvas' });
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Review Canvas sync' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('region', { name: /would be dropped/ })).toBeVisible();
    // Focus moves into the dialog on open.
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();

    await expectNoA11yViolations(page, { include: '[role="dialog"]' });

    // The scrollable drop list is the next Tab stop after Close, so keyboard
    // users can scroll it; the actions follow.
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('region', { name: /would be dropped/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

    // Escape closes without syncing and focus returns to the row's trigger.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
