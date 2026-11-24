const { test, expect } = require('@playwright/test');
const { BIO_PROF2_AUTH_FILE } = require('./auth');
const { selectSeededCourse } = require('./helpers');
const {
  seedPanoptoTranscript,
  getPanoptoTranscriptObjectives,
  removePanoptoTranscript,
} = require('./seed');

// Learning objectives from a Panopto transcript (issue #218), for bio_prof2 in
// the seeded BIOC 302 course: the offer after an import, editing the
// generated objectives, saving them linked to the transcript, and the
// material card's button. Serial: the second test counts what the first saved.
//
// There is no fake Panopto, so the browser's /api/panopto calls are answered
// here and the "import" names a transcript material the seed already put in
// the course. Generation and saving go through the real server (with the
// stubbed LLM). The server runs with PANOPTO_OBJECTIVES_ENABLED=true
// (playwright.config.js); the last test has the status say it is off.
// Opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';

const EDITED_NAME = 'Explain how inhibitors change Km and Vmax';
const ADDED_SUB = 'Distinguish competitive from noncompetitive inhibition on a plot';

// `panopto.objectives` is what /api/panopto/status reports for the flag.
async function answerPanoptoCalls(page, transcript, panopto) {
  await page.route('**/api/panopto/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/panopto/status') {
      return route.fulfill({
        json: {
          success: true,
          configured: true,
          connected: true,
          host: 'panopto.e2e.invalid',
          objectives: panopto.objectives,
        },
      });
    }
    if (pathname === '/api/panopto/folders') {
      return route.fulfill({
        json: { success: true, folders: [{ id: transcript.folderId, name: 'BIOC 302', parentName: '' }] },
      });
    }
    if (pathname.endsWith(`/folders/${transcript.folderId}/sessions`)) {
      return route.fulfill({
        json: {
          success: true,
          sessions: [
            {
              id: transcript.sessionId,
              name: transcript.documentTitle,
              startTime: '2026-11-17T17:00:00Z',
              durationSeconds: 3000,
              viewerUrl: null,
              captions: true,
              imported: null,
            },
          ],
        },
      });
    }
    if (pathname.endsWith(`/sessions/${transcript.sessionId}/import`) && route.request().method() === 'POST') {
      return route.fulfill({
        status: 201,
        json: {
          success: true,
          material: { sourceId: transcript.sourceId, documentTitle: transcript.documentTitle },
        },
      });
    }
    return route.fulfill({ status: 404, json: { success: false, error: `Unexpected Panopto call ${pathname}` } });
  });
}

test.describe('Learning objectives from a Panopto transcript (seeded course)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  /** @type {import('@playwright/test').Page} */
  let page;
  let transcript;
  const panopto = { objectives: true };

  test.beforeAll(async ({ browser }) => {
    await removePanoptoTranscript();
    transcript = await seedPanoptoTranscript();
    page = await browser.newPage();
    await answerPanoptoCalls(page, transcript, panopto);
    await selectSeededCourse(page, { role: 'instructor' });
  });

  test.afterAll(async () => {
    await page?.close();
    await removePanoptoTranscript();
  });

  test('offers objectives after a Panopto import, and saves them as edited', async () => {
    await page.goto('/course-materials', { waitUntil: 'networkidle' });
    const panoptoTile = page.getByRole('button', { name: /From Panopto/ });
    if (!(await panoptoTile.isVisible())) {
      await page.getByRole('button', { name: 'Upload Materials' }).click();
    }
    await panoptoTile.click();

    const picker = page.getByRole('dialog', { name: 'Import from Panopto' });
    await picker.getByRole('checkbox', { name: transcript.documentTitle }).check();
    await picker.getByRole('button', { name: 'Import 1 video' }).click();

    // The picker gives way to the offer, which names the video and waits.
    const offer = page.getByRole('dialog', { name: 'Create learning objectives' });
    await expect(offer).toBeVisible();
    await expect(picker).toBeHidden();
    await expect(offer.getByText(transcript.documentTitle)).toBeVisible();
    await offer.getByRole('button', { name: 'Create learning objectives', exact: true }).click();
    await expect(offer.getByText('Ready to review')).toBeVisible();

    // The stub writes two objectives with two sub-objectives each: keep one,
    // rename it, drop a sub-objective and add one of our own.
    const secondName = await offer.getByRole('textbox', { name: 'Name of objective 2', exact: true }).inputValue();
    await offer.getByRole('button', { name: `Remove objective "${secondName}"` }).click();
    await offer.getByRole('textbox', { name: 'Name of objective 1', exact: true }).fill(EDITED_NAME);
    const keptSub = await offer.getByRole('textbox', { name: `Sub-objective 1 of "${EDITED_NAME}"`, exact: true }).inputValue();
    await offer.getByRole('button', { name: `Remove sub-objective 2 of "${EDITED_NAME}"` }).click();
    await offer.getByRole('button', { name: 'Add sub-objective' }).click();
    await offer.getByRole('textbox', { name: `Sub-objective 2 of "${EDITED_NAME}"`, exact: true }).fill(ADDED_SUB);

    // Nothing is saved before Save.
    expect(await getPanoptoTranscriptObjectives()).toEqual([]);

    await offer.getByRole('button', { name: 'Save 1 objective' }).click();
    await expect(offer.getByText('Saved 1 learning objective.')).toBeVisible();
    await expect(offer.getByRole('button', { name: 'Make questions from them' })).toBeVisible();

    expect(await getPanoptoTranscriptObjectives()).toEqual([
      { name: EDITED_NAME, granulars: [keptSub, ADDED_SUB] },
    ]);

    await offer.getByRole('button', { name: 'Done' }).click();
    await expect(offer).toBeHidden();
  });

  test("the transcript's card makes objectives without asking, and Discard saves nothing", async () => {
    await page.goto('/course-materials', { waitUntil: 'networkidle' });
    await page
      .getByRole('button', { name: `Create learning objectives from ${transcript.documentTitle}` })
      .click();

    const dialog = page.getByRole('dialog', { name: 'Create learning objectives' });
    await expect(dialog.getByText('Ready to review')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Not now' })).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Discard' }).click();
    const confirm = page.getByRole('dialog', { name: 'Discard these objectives?' });
    await confirm.getByRole('button', { name: 'Discard' }).click();
    await expect(dialog).toBeHidden();

    // Still only what the first test saved.
    expect(await getPanoptoTranscriptObjectives()).toHaveLength(1);
  });

  test('while the feature is off, an import offers nothing and the card has no link', async () => {
    panopto.objectives = false;
    try {
      await page.goto('/course-materials', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: transcript.documentTitle })).toBeVisible();
      await expect(
        page.getByRole('button', { name: `Create learning objectives from ${transcript.documentTitle}` })
      ).toHaveCount(0);

      const panoptoTile = page.getByRole('button', { name: /From Panopto/ });
      if (!(await panoptoTile.isVisible())) {
        await page.getByRole('button', { name: 'Upload Materials' }).click();
      }
      await panoptoTile.click();
      const picker = page.getByRole('dialog', { name: 'Import from Panopto' });
      await picker.getByRole('checkbox', { name: transcript.documentTitle }).check();
      await picker.getByRole('button', { name: 'Import 1 video' }).click();

      // The import finishes as it did before the feature: the picker closes
      // with its toast, and no offer follows.
      await expect(page.getByText('Captions of 1 video imported from Panopto')).toBeVisible();
      await expect(picker).toBeHidden();
      await expect(page.getByRole('dialog', { name: 'Create learning objectives' })).toHaveCount(0);
    } finally {
      panopto.objectives = true;
    }
  });
});
