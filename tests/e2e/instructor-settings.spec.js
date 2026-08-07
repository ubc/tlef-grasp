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
    await expect(
      page.getByLabel('PowerPoint Image Extraction Prompt')
    ).toBeVisible();

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

  test('owner can reset co-instructor permissions to defaults', async ({
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

    // Defaults grant full access (every switch on), so Reset starts disabled.
    const reset = page.getByRole('button', { name: 'Reset to Defaults' });
    await expect(reset).toBeDisabled();

    // Turn a permission off: this diverges from defaults and enables Reset.
    const firstSwitch = page.getByRole('switch').first();
    await expect(firstSwitch).toHaveAttribute('aria-checked', 'true');
    await firstSwitch.click();
    await expect(firstSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(reset).toBeEnabled();

    // Reset flips every switch back on and disables itself again. Never saved,
    // so the stored permissions are untouched.
    await reset.click();
    await expect(firstSwitch).toHaveAttribute('aria-checked', 'true');
    for (const sw of await page.getByRole('switch').all()) {
      await expect(sw).toHaveAttribute('aria-checked', 'true');
    }
    await expect(reset).toBeDisabled();
  });

  test('hides Canvas settings when the deployment is not configured', async ({
    page,
  }) => {
    await page.route('**/api/lms/canvas/status', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ configured: false, connected: false }),
      })
    );
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/settings');

    await expect(page.getByRole('button', { name: 'Canvas LMS' })).toHaveCount(0);
  });

  test('shows the instructor personal Canvas connection', async ({ page }) => {
    await page.route('**/api/lms/canvas/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          configured: true,
          connected: true,
          canvasDomain: 'canvas.example.test',
        }),
      })
    );
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Canvas LMS' }).click();

    await expect(page.getByText('Connected to canvas.example.test')).toBeVisible();
    await expect(
      page.getByText(/link each section you manage from My Sections/i)
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Disconnect Canvas' })
    ).toBeVisible();
  });

  test('hides Moodle settings when the deployment is not configured', async ({
    page,
  }) => {
    await page.route('**/api/lms/moodle/status', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ configured: false, connected: false }),
      })
    );
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/settings');

    await expect(page.getByRole('button', { name: 'Moodle LMS' })).toHaveCount(0);
  });

  test('connects the instructor personal Moodle token', async ({ page }) => {
    let submittedToken = null;
    await page.route('**/api/lms/moodle/status', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ configured: true, connected: false }),
      })
    );
    await page.route('**/api/lms/moodle/auth/connect', async (route) => {
      submittedToken = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          sitename: 'GRASP Moodle Test',
          username: 'bio_prof2',
        }),
      });
    });

    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Moodle LMS' }).click();
    await page.getByLabel('Moodle web-service token').fill('personal-token');
    await page.getByRole('button', { name: 'Connect Moodle' }).click();

    await expect(page.getByText('Connected to GRASP Moodle Test')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Disconnect Moodle' })
    ).toBeVisible();
    expect(submittedToken).toEqual({ token: 'personal-token' });
  });
});
