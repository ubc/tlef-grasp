const { test, expect } = require('@playwright/test');
const { BIO_PROF2_AUTH_FILE } = require('./auth');
const { SEED } = require('./seed');
const { selectSeededCourse } = require('./helpers');

// The Question Bank add-question wizard's AI branch (issue #44): the instructor
// picks a type, a learning objective and Bloom level, then chooses to generate
// with AI instead of authoring by hand. The LLM/RAG layer is stubbed
// (start-server-with-stubs.js), so generation is deterministic and never
// reaches a real model. The manual branch is also covered to guard the step
// reorder that the AI branch introduced. Opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';

test.describe('Instructor add-question wizard: AI generation (issue #44)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  async function openWizard(page) {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/question-bank');
    await page.getByRole('button', { name: 'Add New Question' }).click();
    await expect(
      page.getByRole('heading', { name: 'Select Question Type' })
    ).toBeVisible();
  }

  // Step 1 (type) → step 2 (objective + Bloom) → lands on step 3 (source).
  async function pickTypeAndObjective(page) {
    await page.getByRole('button', { name: /Multiple Choice/ }).click();
    await page.getByRole('button', { name: 'Next' }).click();

    await expect(
      page.getByRole('heading', { name: 'Associate Learning Objective' })
    ).toBeVisible();
    await page
      .getByLabel('Meta Learning Objective')
      .selectOption({ label: SEED.OBJECTIVE_NAME });
    await page
      .getByLabel('Granular Learning Objective')
      .selectOption({ label: SEED.GRANULAR_NAME });
    await page.getByLabel("Bloom's Taxonomy Level").selectOption('Understand');
    await page.getByRole('button', { name: 'Next' }).click();

    await expect(
      page.getByRole('heading', { name: 'Choose How to Create' })
    ).toBeVisible();
  }

  test('generates a multiple-choice question with AI, then saves it', async ({
    page,
  }) => {
    await openWizard(page);
    await pickTypeAndObjective(page);

    // The seeded objective has a linked material, so AI generation is offered.
    const aiCard = page.getByRole('button', { name: /Generate with AI/ });
    await expect(aiCard).toBeEnabled();
    await aiCard.click();

    // The primary button becomes "Generate" once AI is selected.
    await page.getByRole('button', { name: 'Generate', exact: true }).click();

    // The stubbed draft lands in the editable Details fields for review.
    await expect(page.getByText('AI-drafted', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Question title')).not.toHaveValue('');
    await expect(
      page.getByRole('button', { name: /Regenerate/ })
    ).toBeVisible();

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(
      page.getByRole('heading', { name: 'Review & Save' })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Save Question' }).click();

    await expect(page.getByText('Question added successfully')).toBeVisible();
  });

  test('regenerating with AI replaces the drafted question', async ({ page }) => {
    await openWizard(page);
    await pickTypeAndObjective(page);

    await page.getByRole('button', { name: /Generate with AI/ }).click();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();

    const title = page.getByLabel('Question title');
    await expect(title).not.toHaveValue('');
    const firstDraft = await title.inputValue();

    // The stub yields a distinct string on each generation, so regenerating
    // must overwrite the previous draft in place.
    await page.getByRole('button', { name: /Regenerate/ }).click();
    await expect(title).not.toHaveValue('');
    await expect(title).not.toHaveValue(firstDraft);
  });

  test('manual authoring still works through the reordered steps', async ({
    page,
  }) => {
    await openWizard(page);
    await pickTypeAndObjective(page);

    // Choose to author the question by hand (the default source).
    await page.getByRole('button', { name: /Provide my own/ }).click();
    await page.getByRole('button', { name: 'Next' }).click();

    await expect(
      page.getByRole('heading', { name: 'Fill in Question Details' })
    ).toBeVisible();

    const stamp = Date.now();
    await page.getByLabel('Question title').fill(`Manual MCQ ${stamp}`);
    await page.getByLabel('Question stem').fill('Select the best answer:');
    for (const [id, text] of [
      ['A', `Alpha ${stamp}`],
      ['B', `Bravo ${stamp}`],
      ['C', `Charlie ${stamp}`],
      ['D', `Delta ${stamp}`],
    ]) {
      await page.getByLabel(`Option ${id} text`).fill(text);
    }
    await page
      .getByLabel('Mark option A as the correct answer')
      .check();

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(
      page.getByRole('heading', { name: 'Review & Save' })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Save Question' }).click();

    await expect(page.getByText('Question added successfully')).toBeVisible();
  });
});
