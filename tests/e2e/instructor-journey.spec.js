const { test, expect } = require('@playwright/test');
const { BIO_PROF2_AUTH_FILE } = require('./auth');

// Full instructor journey for bio_prof2 (a named faculty persona from the local
// IdP + FakeAcademicAPI seed): set up a course from a real UBC section through
// onboarding, upload material, generate learning objectives and questions
// (LLM/RAG are stubbed by start-server-with-stubs.js — no live AI), approve the
// questions, then assemble, schedule and publish a quiz.
//
// This is one user story, so the steps run serially and share a page: each step
// depends on the state the previous one created. It is opt-in (E2E_SAML=1) like
// the rest of the authenticated suite.
const IDP_ENABLED = process.env.E2E_SAML === '1';

// A run-unique suffix keeps the created course/quiz from colliding with data a
// previous run left in the shared database.
const RUN = Date.now().toString().slice(-6);
const MATERIAL_TITLE = `Enzyme Kinetics Notes ${RUN}`;
const MATERIAL_BODY =
  'Enzyme kinetics describes reaction rates catalysed by enzymes. The ' +
  'Michaelis constant (Km) is the substrate concentration at half of Vmax. ' +
  'Competitive inhibitors raise the apparent Km while leaving Vmax unchanged. ' +
  'At saturating substrate the rate approaches Vmax.';
const QUIZ_NAME = `Instructor Journey Quiz ${RUN}`;

test.describe('Instructor journey: bio_prof2 builds and publishes a quiz', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('sets up a new course from a UBC section via onboarding', async () => {
    await page.goto('/onboarding');

    // Faculty land on the setup wizard (or reach it via the tab if they already
    // have courses from a previous run).
    const setupTab = page.getByRole('button', { name: 'New Course Setup' });
    if (await setupTab.isVisible()) await setupTab.click();

    await expect(
      page.getByRole('heading', { name: 'Set up your course' })
    ).toBeVisible();

    // Campus → academic period → the instructor's own sections come from the
    // FakeAcademicAPI mock. Pick the first real option at each step.
    const campus = page.locator('#setup-campus');
    await expect(campus.locator('option')).not.toHaveCount(1); // more than the placeholder
    await campus.selectOption({ index: 1 });

    const period = page.locator('#setup-academic-period');
    await expect(period).toBeEnabled();
    await expect(period.locator('option')).not.toHaveCount(1);
    await period.selectOption({ index: 1 });

    // bio_prof2 teaches BIOC sections; wait for at least one to load, pick it.
    const sectionCheckbox = page
      .getByRole('checkbox')
      .filter({ hasNot: page.locator('[disabled]') })
      .first();
    await expect(page.getByText(/BIOC/).first()).toBeVisible();
    await page.getByRole('checkbox').first().check();

    await page.getByRole('button', { name: 'Create Course' }).click();

    // Either a clean create or the "shell already exists" path (a prior run) —
    // both resolve to an owned course. Handle the conflict by creating anyway.
    const createAnyway = page.getByRole('button', { name: 'Create anyway' });
    if (await createAnyway.isVisible().catch(() => false)) {
      await createAnyway.click();
    }

    await expect(
      page.getByRole('heading', { name: 'Welcome to GRASP!' })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Go to Dashboard' }).click();
    await expect(page).toHaveURL('/dashboard');
  });

  test('uploads a text material for the course', async () => {
    await page.getByRole('link', { name: 'Course Materials' }).click();
    await expect(page).toHaveURL('/course-materials');

    // The Text quick-add tile opens the "Add Text Content" modal.
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Add Text Content' })
    ).toBeVisible();

    await page.getByPlaceholder('Enter document title...').fill(MATERIAL_TITLE);
    await page
      .getByPlaceholder('Paste your text content here...')
      .fill(MATERIAL_BODY);
    await page.getByRole('button', { name: 'Save' }).click();

    // The new material appears as a card in the grid.
    await expect(page.getByText(MATERIAL_TITLE)).toBeVisible();
  });

  test('generates learning objectives from the material', async () => {
    await page.getByRole('link', { name: 'Question Generation' }).click();
    await expect(page).toHaveURL('/question-generation');

    await expect(
      page.getByRole('heading', { name: 'Create Objectives' })
    ).toBeVisible();

    // Open the AI objective generator, pick the material, generate (stubbed).
    await page.getByRole('button', { name: 'Create Learning Objectives' }).click();
    await expect(
      page.getByRole('heading', { name: 'Generate Learning Objectives' })
    ).toBeVisible();

    await page
      .getByRole('dialog')
      .getByText(MATERIAL_TITLE)
      .click();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();

    // Stubbed generation returns objectives; save them onto the page.
    const saveSelected = page.getByRole('button', { name: /Save Selected/ });
    await expect(saveSelected).toBeEnabled({ timeout: 30_000 });
    await saveSelected.click();

    // The saved objective group is now rendered as an editable card on step 1.
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  test('generates questions and saves them into a new quiz', async () => {
    // Step 1 → 2: generate questions for the objective (stubbed).
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(
      page.getByRole('heading', { name: 'Generate Questions' })
    ).toBeVisible();

    // Wait out the "Generating…/Reviewing…" states until the Add-to-Quiz action
    // is enabled, i.e. at least one question exists.
    const toStep3 = page.getByRole('button', { name: 'Add to Quiz' });
    await expect(toStep3).toBeEnabled({ timeout: 60_000 });
    await toStep3.click();

    // Step 3: create a new quiz holding the generated questions.
    await expect(
      page.getByRole('heading', { name: 'Save Quiz to Question Bank' })
    ).toBeVisible();
    await page.getByPlaceholder('Enter quiz name...').fill(QUIZ_NAME);
    await page.getByRole('button', { name: 'Save to Quiz' }).click();

    await expect(
      page.getByRole('heading', { name: 'Questions Saved Successfully!' })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Go to Question Bank' }).click();
    await expect(page).toHaveURL(/\/question-bank/);
  });

  test('approves the generated questions in the question bank', async () => {
    // Draft questions are selectable; select all and bulk-approve.
    const rows = page.getByRole('row');
    await expect(rows.first()).toBeVisible();

    // The header "select all" checkbox is the first checkbox in the table.
    await page.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: 'Approve' }).click();

    // At least one row now shows the Approved status.
    await expect(page.getByText('Approved').first()).toBeVisible();
  });

  test('schedules the quiz for a section and publishes it', async () => {
    await page.getByRole('link', { name: 'Quizzes', exact: true }).click();
    await expect(page).toHaveURL('/quizzes');

    // Locate the journey's quiz card.
    const card = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: QUIZ_NAME }) })
      .first();
    await expect(card.getByRole('heading', { name: QUIZ_NAME })).toBeVisible();

    // Schedule the (single owned) section with a release/expire window so the
    // published quiz is actually visible to students.
    await card.getByRole('button', { name: 'Schedule' }).click();
    await expect(
      page.getByRole('heading', { name: 'Schedule a section' })
    ).toBeVisible();
    await page.locator('select').first().selectOption({ index: 1 });

    const release = page.locator('input[type="datetime-local"]').first();
    const expire = page.locator('input[type="datetime-local"]').nth(1);
    await release.fill('2020-01-01T00:00');
    await expire.fill('2100-01-01T00:00');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Schedule a section' })
    ).toBeHidden();

    // Publish it.
    await card.getByRole('button', { name: 'Publish' }).click();
    await expect(card.getByRole('button', { name: 'Unpublish' })).toBeVisible();
  });
});
