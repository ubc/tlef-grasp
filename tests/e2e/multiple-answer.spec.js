const { test, expect } = require('@playwright/test');
const { MongoClient } = require('mongodb');
const { BIO_PROF2_AUTH_FILE, BIO_STUDENT_AUTH_FILE } = require('./auth');
const { SEED, seedMultipleAnswerQuiz, removeMultipleAnswerQuiz } = require('./seed');
const { escapeRegExp, selectSeededCourse, startQuizFromList } = require('./helpers');

// Multiple-answer questions ("select all that apply") end to end, on a quiz
// this spec seeds and removes. A student ticks options and checks them: a
// wrong check names the wrong options ticked and says a correct one was
// missed, never which; the hints come back after a reload; only the exact set
// is right, and only the first check is graded. The instructor's review shows
// what was ticked, and an instructor writes one in the Add Question wizard.
// Opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';
const { MA_QUESTION } = SEED;

// One option's checkbox; its name is the letter, the option text and, once
// marked, "(correct)" or "(incorrect)".
const optionBox = (page, key) =>
  page.getByRole('checkbox', {
    name: new RegExp(
      `^${key}\\s*${escapeRegExp(MA_QUESTION.options[key].text)}(\\s*\\((in)?correct\\))?$`
    ),
  });

// The JSON body of the next answer check the page sends.
const nextCheckBody = (page) =>
  page
    .waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/quiz\/[^/]+\/question\/[^/]+\/check$/.test(new URL(response.url()).pathname)
    )
    .then((response) => response.json());

async function withQuestions(fn) {
  const client = new MongoClient(process.env.MONGODB_URI, { connectTimeoutMS: 8000 });
  await client.connect();
  try {
    return await fn(client.db(process.env.MONGODB_DB_NAME || undefined).collection('grasp_question'));
  } finally {
    await client.close();
  }
}

test.describe('Multiple-answer questions', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');

  test.beforeAll(async () => {
    if (!IDP_ENABLED) return;
    await removeMultipleAnswerQuiz();
    await seedMultipleAnswerQuiz();
  });

  test.afterAll(async () => {
    if (!IDP_ENABLED) return;
    await removeMultipleAnswerQuiz();
  });

  test('a student retries a wrong set with hints until it is exact; the first check is graded', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: BIO_STUDENT_AUTH_FILE });
    const page = await context.newPage();
    await selectSeededCourse(page, { role: 'student' });
    await page.goto('/quiz');
    await startQuizFromList(page, SEED.MA_QUIZ_NAME);
    await expect(page.getByText(/1 of 1/)).toBeVisible();
    await expect(page.getByText(MA_QUESTION.title, { exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Select all that apply.' })).toBeVisible();

    const check = page.getByRole('button', { name: 'Check answer' });
    await expect(check).toBeDisabled();

    // A is right, B is wrong, and D (also right) is left unticked.
    await optionBox(page, 'A').check();
    await optionBox(page, 'B').check();
    const wrongCheck = nextCheckBody(page);
    await check.click();
    expect(await wrongCheck).toEqual({
      success: true,
      isCorrect: false,
      feedback: `B: ${MA_QUESTION.options.B.feedback}`,
      optionFeedback: [{ key: 'B', feedback: MA_QUESTION.options.B.feedback }],
      wrongKeys: ['B'],
      missedCorrect: true,
      correctAnswer: null,
      correctOptionText: null,
    });

    const hints = async () => {
      await expect(page.getByText('Incorrect.')).toBeVisible();
      await expect(page.getByText('Option B, which you ticked, is not correct.')).toBeVisible();
      await expect(page.getByText(MA_QUESTION.options.B.feedback)).toBeVisible();
      await expect(page.getByText('You missed at least one correct option.')).toBeVisible();
      await expect(page.getByText(/Only your first answer counts toward your grade/)).toBeVisible();
      // The wrong option can't be ticked again; nothing marks the missed one.
      await expect(optionBox(page, 'B')).toBeDisabled();
      await expect(optionBox(page, 'B')).not.toBeChecked();
      await expect(optionBox(page, 'D')).toBeEnabled();
      await expect(optionBox(page, 'D')).not.toBeChecked();
    };
    await hints();
    await expect(optionBox(page, 'A')).toBeChecked();

    // Resuming restores the graded check and its hints, still without the answer.
    await page.goto('/quiz');
    const questionsResponse = page.waitForResponse((response) =>
      /\/api\/student\/quizzes\/[^/]+\/questions$/.test(new URL(response.url()).pathname)
    );
    await startQuizFromList(page, SEED.MA_QUIZ_NAME);
    const { data } = await (await questionsResponse).json();
    expect(Object.values(data.previousAnswers)).toEqual([
      expect.objectContaining({
        isCorrect: false,
        selectedAnswer: ['A', 'B'],
        correctAnswer: null,
        wrongKeys: ['B'],
        missedCorrect: true,
      }),
    ]);
    await hints();

    // An ungraded retry finds the set; the grade stays on the first check.
    await optionBox(page, 'D').check();
    const rightCheck = nextCheckBody(page);
    await page.getByRole('button', { name: 'Check again' }).click();
    expect(await rightCheck).toMatchObject({ isCorrect: true, correctAnswer: ['A', 'D'] });
    await expect(page.getByText('Correct!')).toBeVisible();
    await expect(page.getByText(/still counts as missed/)).toBeVisible();
    await expect(optionBox(page, 'A')).toBeChecked();
    await expect(optionBox(page, 'D')).toBeChecked();

    await page.getByRole('button', { name: /Finish/ }).click();
    await expect(page.getByRole('heading', { name: 'Quiz Complete!' })).toBeVisible();
    await expect(page.getByText('0%', { exact: true })).toBeVisible();
    await context.close();
  });

  test("the instructor's review shows which options the student ticked", async ({ browser }) => {
    const context = await browser.newContext({ storageState: BIO_PROF2_AUTH_FILE });
    const page = await context.newPage();
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/quiz-scores');
    await page.getByLabel('Filter scores by quiz').selectOption({ label: SEED.MA_QUIZ_NAME });
    await page.getByRole('row').filter({ hasText: /%/ }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Multiple Answer', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Incorrect', { exact: true })).toBeVisible();
    // A ticked and right, B ticked and wrong, D right but missed on the graded check.
    await expect(dialog.getByText('Correct, ticked', { exact: true })).toHaveCount(1);
    await expect(dialog.getByText('Wrong, ticked', { exact: true })).toHaveCount(1);
    await expect(dialog.getByText('Correct, not ticked', { exact: true })).toHaveCount(1);
    await context.close();
  });

  test('an instructor writes one in the Add Question wizard and edits it', async ({ browser }) => {
    const title = `Which of these are noble gases? ${Date.now()}`;
    const context = await browser.newContext({ storageState: BIO_PROF2_AUTH_FILE });
    const page = await context.newPage();
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/question-bank');

    await page.getByRole('button', { name: 'Add New Question' }).click();
    await page.getByRole('button', { name: 'Create a Question' }).click();
    await page.getByRole('button', { name: /Multiple Answer/ }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Meta Learning Objective').selectOption({ label: SEED.OBJECTIVE_NAME });
    await page.getByLabel('Granular Learning Objective').selectOption({ label: SEED.GRANULAR_NAME });
    await page.getByLabel("Bloom's Taxonomy Level").selectOption('Remember');
    await page.getByRole('button', { name: 'Next' }).click();

    // AI can't draft this type yet, so the question is written by hand.
    await expect(page.getByRole('button', { name: /Generate with AI/ })).toBeDisabled();
    await expect(page.getByText("AI can't draft multiple-answer questions yet.")).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();

    await page.getByLabel('Question title').fill(title);
    await page.getByLabel('Question stem').fill('Tick every noble gas.');
    await page.getByLabel('Option A text').fill('Neon');
    await page.getByLabel('Option B text').fill('Nitrogen');
    await page.getByLabel('Option C text').fill('Argon');
    await page.getByLabel('Option D text').fill('Chlorine');

    // Nothing ticked yet: the wizard asks for a correct option.
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Tick at least one correct option')).toBeVisible();

    await page.getByLabel('Mark option A as a correct answer').check();
    await page.getByLabel('Mark option C as a correct answer').check();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Save Question' }).click();
    await expect(page.getByText('Question added successfully')).toBeVisible();

    const saved = await withQuestions((questions) => questions.findOne({ title }));
    expect(saved).toMatchObject({ questionType: 'multiple-answer', correctAnswer: ['A', 'C'] });

    // The bank labels it, and the edit dialog ticks its correct options; the
    // ticks follow their rows when one is removed.
    const row = page.getByRole('row').filter({ hasText: title });
    await expect(row.getByText('Multiple answer')).toBeVisible();
    await row.getByRole('button', { name: 'View/Edit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit question' });
    await expect(dialog.getByLabel('Mark option A as a correct answer')).toBeChecked();
    await expect(dialog.getByLabel('Mark option B as a correct answer')).not.toBeChecked();
    await expect(dialog.getByLabel('Mark option C as a correct answer')).toBeChecked();
    await dialog.getByRole('button', { name: 'Remove option B' }).click();
    await expect(dialog.getByLabel('Option B text')).toHaveValue('Argon');
    await expect(dialog.getByLabel('Mark option B as a correct answer')).toBeChecked();
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByText('Question updated successfully')).toBeVisible();

    const edited = await withQuestions((questions) => questions.findOne({ title }));
    expect(edited.correctAnswer).toEqual(['A', 'B']);
    expect(Object.keys(edited.options)).toEqual(['A', 'B', 'C']);
    await context.close();
  });
});
