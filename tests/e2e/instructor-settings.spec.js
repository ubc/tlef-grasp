const { test, expect } = require('@playwright/test');
const { BIO_PROF2_AUTH_FILE } = require('./auth');
const { selectSeededCourse } = require('./helpers');

// Course Settings for bio_prof2 (owner of the seeded BIOC 302 course): the
// Bloom-level question-type table and invite code on the general tab, saving
// settings, the LLM prompt editors, and the owner-only co-instructor
// permissions tab. Nothing here regenerates the invite code (that would
// invalidate a shared credential mid-suite). Opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';

test.describe('Instructor course settings (seeded course)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  test('shows the Bloom mapping table and a course invite code', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/settings');

    await expect(
      page.getByRole('heading', { name: 'Question Type by Bloom Level' })
    ).toBeVisible();
    // One primary-type select per Bloom level, hydrated with a value.
    for (const level of ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create']) {
      await expect(
        page.getByLabel(`Default question type for ${level}`)
      ).toHaveValue(/.+/);
    }

    // The invite code loads from the API into the read-only field.
    await expect(page.getByLabel('Current invite code')).toHaveValue(/.+/);
    await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Regenerate code' })
    ).toBeVisible();
  });

  test('saves the course settings', async ({ page }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/settings');
    // Wait for hydration before saving so we persist the loaded values as-is.
    await expect(page.getByLabel('Current invite code')).toHaveValue(/.+/);

    await page.getByRole('button', { name: 'Save All Changes' }).click();
    await expect(page.getByText('Settings saved successfully')).toBeVisible();
  });

  test('prompt tab resets a prompt to its default text', async ({ page }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/settings');

    await page.getByRole('button', { name: 'Course Prompts' }).click();
    await expect(page.getByRole('heading', { name: 'LLM Prompts' })).toBeVisible();

    const promptField = page.getByLabel('Question Generation Prompt');
    await expect(promptField).toBeVisible();

    // Reset-to-default fills the editor from the server-provided defaults;
    // nothing is saved unless Save All Changes is clicked (it isn't here).
    await page.getByRole('button', { name: 'Reset to Default' }).first().click();
    // Exact match: the toast text "Prompt reset to default" is otherwise a
    // substring of the "…Prompt … Reset to Default" field header + button.
    await expect(
      page.getByText('Prompt reset to default', { exact: true })
    ).toBeVisible();
    await expect(promptField).toHaveValue(/.+/);
  });

  test('owner sees co-instructor permission switches and can toggle one', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/settings');

    await page
      .getByRole('button', { name: 'Co-Instructor Permissions' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Co-Instructor Permissions' })
    ).toBeVisible();

    const firstSwitch = page.getByRole('switch').first();
    await expect(firstSwitch).toBeVisible();
    const before = await firstSwitch.getAttribute('aria-checked');

    // Toggle flips the switch state locally; toggle back and never save, so
    // the stored permissions are untouched.
    await firstSwitch.click();
    await expect(firstSwitch).toHaveAttribute(
      'aria-checked',
      before === 'true' ? 'false' : 'true'
    );
    await firstSwitch.click();
    await expect(firstSwitch).toHaveAttribute('aria-checked', before);
  });
});
