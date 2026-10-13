const { test, expect } = require('@playwright/test');
const { MongoClient } = require('mongodb');
const { BIO_PROF2_AUTH_FILE } = require('./auth');
const { SEED } = require('./seed');
const { selectSeededCourse } = require('./helpers');

// Removing a multiple-choice answer option (issue #165): the remove button
// used to hand the form { rows } instead of { options }, which crashed the
// page in both the add-question wizard and the edit dialog. bio_prof2 builds
// a true/false question in the wizard by removing two of the four rows, then
// in the edit dialog adds a third option and removes "True"; the remaining
// rows re-letter and the correct answer follows its row.
// Opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';

async function withQuestions(fn) {
  const client = new MongoClient(process.env.MONGODB_URI, { connectTimeoutMS: 8000 });
  await client.connect();
  try {
    return await fn(client.db(process.env.MONGODB_DB_NAME || undefined).collection('grasp_question'));
  } finally {
    await client.close();
  }
}

test.describe('Instructor removes multiple-choice options (issue #165)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  test('removes options in the wizard and the edit dialog without crashing', async ({ page }) => {
    const title = `Glycolysis requires oxygen. ${Date.now()}`;

    try {
      await selectSeededCourse(page, { role: 'instructor' });
      await page.goto('/question-bank');

      // --- Add wizard: four rows down to True / False.
      await page.getByRole('button', { name: 'Add New Question' }).click();
      await page.getByRole('button', { name: 'Create a Question' }).click();
      await page.getByRole('button', { name: /Multiple Choice/ }).click();
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByLabel('Meta Learning Objective').selectOption({ label: SEED.OBJECTIVE_NAME });
      await page.getByLabel('Granular Learning Objective').selectOption({ label: SEED.GRANULAR_NAME });
      await page.getByLabel("Bloom's Taxonomy Level").selectOption('Remember');
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByRole('button', { name: /Provide my own/ }).click();
      await page.getByRole('button', { name: 'Next' }).click();

      await page.getByLabel('Question title').fill(title);
      await page.getByLabel('Question stem').fill('True or false?');
      await page.getByLabel('Option A text').fill('True');
      await page.getByLabel('Option B text').fill('Not sure');
      await page.getByLabel('Option C text').fill('False');
      await page.getByLabel('Mark option C as the correct answer').check();

      // Removing B re-letters C to B, and the correct answer moves with it.
      await page.getByRole('button', { name: 'Remove option B' }).click();
      await expect(page.getByLabel('Option B text')).toHaveValue('False');
      await expect(page.getByLabel('Mark option B as the correct answer')).toBeChecked();
      await page.getByRole('button', { name: 'Remove option C' }).click();
      await expect(page.getByLabel('Option C text')).toHaveCount(0);

      // Two rows is the floor.
      for (const id of ['A', 'B']) {
        const remove = page.getByRole('button', { name: `Remove option ${id}` });
        await expect(remove).toBeDisabled();
        await expect(remove).toHaveAttribute('title', 'Keep at least 2 options');
      }

      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page.getByRole('heading', { name: 'Review & Save' })).toBeVisible();
      await page.getByRole('button', { name: 'Save Question' }).click();
      await expect(page.getByText('Question added successfully')).toBeVisible();

      const saved = await withQuestions((questions) => questions.findOne({ title }));
      expect(saved.options).toEqual({
        A: { text: 'True', feedback: '' },
        B: { text: 'False', feedback: '' },
      });
      expect(saved.correctAnswer).toBe('B');

      // --- Edit dialog: add a third option, then remove "True".
      await page
        .getByRole('row')
        .filter({ hasText: title })
        .getByRole('button', { name: 'View/Edit' })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Edit question' });
      await expect(dialog.getByLabel('Option A text')).toHaveValue('True');
      await expect(dialog.getByRole('button', { name: 'Remove option A' })).toBeDisabled();

      await dialog.getByRole('button', { name: /Add option/ }).click();
      await dialog.getByLabel('Option C text').fill('It depends on the cell type');
      await dialog.getByRole('button', { name: 'Remove option A' }).click();

      await expect(dialog.getByLabel('Option A text')).toHaveValue('False');
      await expect(dialog.getByLabel('Option B text')).toHaveValue('It depends on the cell type');
      await expect(dialog.getByLabel('Mark option A as the correct answer')).toBeChecked();
      await dialog.getByRole('button', { name: 'Save Changes' }).click();
      await expect(page.getByText('Question updated successfully')).toBeVisible();
      await expect(dialog).toBeHidden();

      const edited = await withQuestions((questions) => questions.findOne({ title }));
      expect(edited.options).toEqual({
        A: { text: 'False', feedback: '' },
        B: { text: 'It depends on the cell type', feedback: '' },
      });
      expect(edited.correctAnswer).toBe('A');
    } finally {
      await withQuestions((questions) => questions.deleteMany({ title }));
    }
  });
});
