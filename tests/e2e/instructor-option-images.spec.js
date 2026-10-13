const { test, expect } = require('@playwright/test');
const { MongoClient } = require('mongodb');
const sharp = require('sharp');
const { BIO_PROF2_AUTH_FILE } = require('./auth');
const { SEED } = require('./seed');
const { selectSeededCourse } = require('./helpers');

// Images in multiple-choice answer options (issue #146): bio_prof2 authors a
// draft question in the add-question wizard with an image-only option and an
// option with text and an image, then replaces and removes them in the edit
// modal. Stored files follow the question: a replaced or removed image is
// deleted on save, and cancelling an edit never deletes a saved one.
// Opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';

// A small solid-colour PNG per option, so each upload is a distinct file.
async function pngFile(name, colour) {
  const buffer = await sharp({
    create: { width: 48, height: 48, channels: 3, background: colour },
  })
    .png()
    .toBuffer();
  return { name, mimeType: 'image/png', buffer };
}

async function deleteQuestionsByTitle(page, title) {
  const uri = process.env.MONGODB_URI;
  if (!uri) return;
  const client = new MongoClient(uri, { connectTimeoutMS: 8000 });
  await client.connect();
  try {
    const questions = await client
      .db(process.env.MONGODB_DB_NAME || undefined)
      .collection('grasp_question')
      .find({ title }, { projection: { _id: 1 } })
      .toArray();
    // Through the API, so the question's images are cleaned up with it.
    for (const question of questions) {
      await page.request.delete(`/api/question/${question._id}`);
    }
  } finally {
    await client.close();
  }
}

// The file id an <img> is served from (/api/image/<id>).
async function imageIdOf(locator) {
  const src = await locator.getAttribute('src');
  return src.split('/').pop();
}

async function attachOptionImage(page, scope, optionId, file) {
  const chooser = page.waitForEvent('filechooser');
  await scope
    .getByRole('button', { name: new RegExp(`^(Attach|Replace) image for Option ${optionId}$`) })
    .click();
  await (await chooser).setFiles(file);
  await expect(scope.getByLabel(`Option ${optionId} image alt text`)).toBeVisible();
}

test.describe('Instructor option images (issue #146)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  test('adds, replaces and removes option images and cleans up the files', async ({
    page,
  }) => {
    const title = `Which ring is aromatic? ${Date.now()}`;

    try {
      await selectSeededCourse(page, { role: 'instructor' });
      await page.goto('/question-bank');

      // --- Add wizard: one image-only option, one with text and an image.
      await page.getByRole('button', { name: 'Add New Question' }).click();
      await page.getByRole('button', { name: 'Create a Question' }).click();
      await page.getByRole('button', { name: /Multiple Choice/ }).click();
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByLabel('Meta Learning Objective').selectOption({ label: SEED.OBJECTIVE_NAME });
      await page.getByLabel('Granular Learning Objective').selectOption({ label: SEED.GRANULAR_NAME });
      await page.getByLabel("Bloom's Taxonomy Level").selectOption('Understand');
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByRole('button', { name: /Provide my own/ }).click();
      await page.getByRole('button', { name: 'Next' }).click();

      await page.getByLabel('Question title').fill(title);
      await page.getByLabel('Question stem').fill('Select the aromatic ring:');
      await page.getByLabel('Option B text').fill('Cyclohexane');
      await page.getByLabel('Option C text').fill('Cyclohexene');
      await page.getByLabel('Option D text').fill('Cyclopentane');

      // An option with neither text nor an image cannot be saved.
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page.getByText('Each option needs text or an image')).toBeVisible();

      await attachOptionImage(page, page, 'A', await pngFile('benzene.png', '#1d4ed8'));
      await page.getByLabel('Option A image alt text').fill('Six-membered ring with alternating double bonds');
      await attachOptionImage(page, page, 'B', await pngFile('cyclohexane.png', '#047857'));
      await page.getByLabel('Mark option A as the correct answer').check();

      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page.getByRole('heading', { name: 'Review & Save' })).toBeVisible();
      await page.getByRole('button', { name: 'Save Question' }).click();
      await expect(page.getByText('Question added successfully')).toBeVisible();

      // --- Edit modal: the saved images come back.
      const openEditor = async () => {
        await page
          .getByRole('row')
          .filter({ hasText: title })
          .getByRole('button', { name: 'View/Edit' })
          .click();
        const dialog = page.getByRole('dialog', { name: 'Edit question' });
        await expect(dialog.getByLabel('Option A text')).toBeVisible();
        return dialog;
      };
      let dialog = await openEditor();
      const imageA = dialog.getByRole('img', { name: 'Six-membered ring with alternating double bonds' });
      await expect(imageA).toBeVisible();
      const firstA = await imageIdOf(imageA);
      const firstB = await imageIdOf(dialog.locator('img[src^="/api/image/"]').nth(1));
      expect(firstB).not.toBe(firstA);

      // Replace A's image and remove B's, then save.
      await attachOptionImage(page, dialog, 'A', await pngFile('benzene-v2.png', '#b91c1c'));
      await dialog.getByRole('button', { name: 'Remove the image from Option B' }).click();
      await expect(
        dialog.getByRole('button', { name: 'Attach image for Option B' })
      ).toBeVisible();
      await dialog.getByRole('button', { name: 'Save Changes' }).click();
      await expect(page.getByText('Question updated successfully')).toBeVisible();
      await expect(dialog).toBeHidden();

      // Both dropped files are gone from storage.
      expect((await page.request.get(`/api/image/${firstA}`)).status()).toBe(404);
      expect((await page.request.get(`/api/image/${firstB}`)).status()).toBe(404);

      dialog = await openEditor();
      const secondA = await imageIdOf(dialog.locator('img[src^="/api/image/"]').first());
      expect(secondA).not.toBe(firstA);
      await expect(dialog.locator('img[src^="/api/image/"]')).toHaveCount(1);

      // Removing an image and then cancelling keeps the saved file.
      await dialog.getByRole('button', { name: 'Remove the image from Option A' }).click();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();
      expect((await page.request.get(`/api/image/${secondA}`)).status()).toBe(200);

      dialog = await openEditor();
      await expect(dialog.locator(`img[src="/api/image/${secondA}"]`)).toBeVisible();
    } finally {
      await deleteQuestionsByTitle(page, title);
    }
  });
});
