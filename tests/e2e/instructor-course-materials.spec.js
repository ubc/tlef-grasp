const { test, expect } = require('@playwright/test');
const { BIO_PROF2_AUTH_FILE } = require('./auth');
const { selectSeededCourse } = require('./helpers');

// Course Materials management for bio_prof2 against the seeded BIOC 302 course:
// the full lifecycle of a text material through the UI — empty-content
// validation, create, type filter, edit, and delete. This is one user story
// (each step depends on the material the previous one created), so it runs
// serially on a shared page. The material is uniquely named per run and
// cleaned up by the delete step, so it never collides with other specs or
// leaves DB residue. Opt-in (E2E_SAML=1).
//
// The instructor journey creates its own text material as a side effect of
// generating objectives; this spec covers the management surface (validation,
// filter, edit, delete) that the journey does not touch.
const IDP_ENABLED = process.env.E2E_SAML === '1';

const RUN = Date.now().toString().slice(-6);
const TITLE = `Materials Spec Notes ${RUN}`;
const BODY =
  'Glycolysis converts glucose to pyruvate across ten enzyme-catalysed steps, ' +
  'producing a net gain of two ATP and two NADH per glucose molecule.';
const EDITED_BODY = `${BODY} The pathway occurs in the cytosol.`;

test.describe('Instructor course materials lifecycle (seeded course)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await selectSeededCourse(page, { role: 'instructor' });
  });

  test.afterAll(async () => {
    await page.close();
  });

  // The card is the innermost div that contains BOTH the material's heading and
  // its action buttons (the grid ancestor has the heading too, but this is the
  // deepest div holding the Edit/Delete controls for this specific material).
  const materialCard = () =>
    page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: TITLE }) })
      .filter({ has: page.getByRole('button', { name: 'Edit' }) })
      .last();

  async function openAddTextModal() {
    // networkidle lets the materials query settle before we inspect the page,
    // so the "auto-open upload panel when the course has no materials" effect
    // has already run and the toggle state is stable (no check/click race).
    await page.goto('/course-materials', { waitUntil: 'networkidle' });

    // Non-exact name: the tile button's accessible name is the FontAwesome
    // glyph + "Text", so exact matching misses it. No other button contains
    // "Text". Reveal the upload panel if it isn't already open.
    const textTile = page.getByRole('button', { name: 'Text' });
    if (!(await textTile.isVisible())) {
      await page.getByRole('button', { name: 'Upload Materials' }).click();
    }
    await expect(textTile).toBeVisible();
    await textTile.click();
    await expect(
      page.getByRole('heading', { name: 'Add Text Content' })
    ).toBeVisible();
  }

  test('rejects empty text content with a validation message', async () => {
    await openAddTextModal();

    // Title only, no content → the app blocks the save with a toast.
    await page.getByPlaceholder('Enter document title...').fill(TITLE);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Please enter some content')).toBeVisible();
    // The modal stays open for correction.
    await expect(
      page.getByRole('heading', { name: 'Add Text Content' })
    ).toBeVisible();
  });

  test('creates a text material', async () => {
    await page.getByPlaceholder('Paste your text content here...').fill(BODY);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Text content added')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: TITLE })
    ).toBeVisible();
  });

  test('type filter narrows the grid to textbook materials', async () => {
    await page.goto('/course-materials');
    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();

    // Textbook filter keeps the just-created text material visible.
    await page.getByLabel('Filter materials by type').selectOption('text');
    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();

    // Filtering to Link hides it (the material is a textbook, not a link).
    await page.getByLabel('Filter materials by type').selectOption('link');
    await expect(page.getByRole('heading', { name: TITLE })).toBeHidden();

    await page.getByLabel('Filter materials by type').selectOption('all');
    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
  });

  test('edits the text material content', async () => {
    await page.goto('/course-materials');
    await materialCard().getByRole('button', { name: 'Edit' }).click();

    await expect(
      page.getByRole('heading', { name: 'Edit Textbook' })
    ).toBeVisible();
    await page.getByPlaceholder('Paste your text content here...').fill(EDITED_BODY);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Textbook updated successfully')).toBeVisible();
  });

  test('deletes the text material', async () => {
    await page.goto('/course-materials');
    await materialCard().getByRole('button', { name: 'Delete' }).click();

    await expect(
      page.getByRole('heading', { name: 'Delete Material' })
    ).toBeVisible();
    // The confirm dialog names the material being removed.
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(TITLE)).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('Material deleted successfully')).toBeVisible();
    await expect(page.getByRole('heading', { name: TITLE })).toBeHidden();
  });
});
