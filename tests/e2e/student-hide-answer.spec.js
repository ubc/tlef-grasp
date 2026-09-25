const { test, expect } = require('@playwright/test');
const { BIO_STUDENT_AUTH_FILE } = require('./auth');
const {
  SEED,
  resetSeededQuizAttemptState,
  resetSeededAiQuizAttemptState,
} = require('./seed');
const {
  escapeRegExp,
  getQuizCard,
  selectSeededCourse,
  startQuizFromList,
} = require('./helpers');

// Issue #128: the first answer is still the graded one, but a wrong
// multiple-choice answer no longer reveals the correct option. The student
// retries, ungraded, until they find it — in the graded attempt and in practice
// rounds alike. Fill-in-the-blank is answered once and still shows the correct
// answer. Opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';

// Each seeded question shows exactly one of these texts, so one union locator
// finds the option on whichever question is on screen.
const optionMatching = (page, texts) =>
  page
    .getByRole('button', { name: new RegExp(texts.map(escapeRegExp).join('|')) })
    .first();

// The JSON body of the next answer check the page sends.
const nextCheckBody = (page) =>
  page
    .waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/quiz\/[^/]+\/question\/[^/]+\/check$/.test(new URL(response.url()).pathname)
    )
    .then((response) => response.json());

test.describe('Correct answer stays hidden until the student finds it (issue #128)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');
  test.use({ storageState: BIO_STUDENT_AUTH_FILE });

  test.afterAll(async () => {
    if (!IDP_ENABLED) return;
    // Leave both seeded quizzes un-taken for whichever spec runs next.
    await resetSeededQuizAttemptState();
    await resetSeededAiQuizAttemptState();
  });

  test('a wrong multiple-choice answer is graded without revealing the correct one', async ({
    page,
  }) => {
    await resetSeededQuizAttemptState();
    await selectSeededCourse(page, { role: 'student' });
    await page.goto('/quiz');
    await startQuizFromList(page, SEED.QUIZ_NAME);
    await expect(page.getByText(/1 of \d+/)).toBeVisible();

    const correctOption = optionMatching(page, SEED.CORRECT_OPTION_TEXTS);
    const wrongOption = optionMatching(page, SEED.WRONG_OPTION_TEXTS);

    // The graded first answer is wrong, and the server's reply names no answer...
    const wrongCheck = nextCheckBody(page);
    await wrongOption.click();
    expect(await wrongCheck).toMatchObject({
      isCorrect: false,
      correctAnswer: null,
      correctOptionText: null,
    });

    // ...nor does the page: nothing marks the right option, which stays open.
    await expect(page.getByText('Incorrect.')).toBeVisible();
    await expect(page.getByText(/The correct answer is/)).toHaveCount(0);
    await expect(
      page.getByText(/Only your first answer counts toward your grade/)
    ).toBeVisible();
    await expect(wrongOption).toBeDisabled();
    await expect(correctOption).toBeEnabled();

    // An ungraded retry finds it; the grade stays on the first answer.
    await correctOption.click();
    await expect(page.getByText('Correct!')).toBeVisible();
    await expect(page.getByText(/still counts as missed/)).toBeVisible();

    // Resuming restores the recorded wrong answer — still without the correct
    // one, since the retry was never recorded.
    await page.goto('/quiz');
    const questionsResponse = page.waitForResponse((response) =>
      /\/api\/student\/quizzes\/[^/]+\/questions$/.test(new URL(response.url()).pathname)
    );
    await startQuizFromList(page, SEED.QUIZ_NAME);
    const { data } = await (await questionsResponse).json();
    const recorded = Object.values(data.previousAnswers);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      isCorrect: false,
      correctAnswer: null,
      correctOptionText: null,
    });

    await expect(page.getByText(/2 of \d+/)).toBeVisible();
    await page.getByRole('button', { name: 'Previous' }).click();
    await expect(page.getByText(/1 of \d+/)).toBeVisible();
    await expect(page.getByText('Incorrect.')).toBeVisible();
    await expect(page.getByText(/The correct answer is/)).toHaveCount(0);
    await expect(correctOption).toBeEnabled();

    // Answer the rest correctly: the wrong first answer still costs a point.
    await page.getByRole('button', { name: /Next/ }).click();
    for (let i = 1; i < SEED.QUESTION_COUNT; i++) {
      await correctOption.click();
      await expect(page.getByText('Correct!')).toBeVisible();
      await page.getByRole('button', { name: /Next|Finish/ }).click();
    }
    await expect(page.getByRole('heading', { name: 'Quiz Complete!' })).toBeVisible();
    await expect(page.getByText('67%')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Practice the 1 you missed' })
    ).toBeVisible();
  });

  test('a practice round keeps the correct answer hidden too', async ({ page }) => {
    // The previous test recorded a graded attempt, so a retake is practice.
    await selectSeededCourse(page, { role: 'student' });
    await page.goto('/quiz');
    await getQuizCard(page, SEED.QUIZ_NAME)
      .getByRole('button', { name: 'Retake Quiz' })
      .click();
    await expect(page.getByText('Practice (not graded)')).toBeVisible();

    const correctOption = optionMatching(page, SEED.CORRECT_OPTION_TEXTS);
    const wrongOption = optionMatching(page, SEED.WRONG_OPTION_TEXTS);

    const wrongCheck = nextCheckBody(page);
    await wrongOption.click();
    expect(await wrongCheck).toMatchObject({
      isCorrect: false,
      correctAnswer: null,
      correctOptionText: null,
    });
    await expect(page.getByText('Incorrect.')).toBeVisible();
    await expect(page.getByText(/The correct answer is/)).toHaveCount(0);
    await expect(page.getByText(/Try again until you find the right answer/)).toBeVisible();
    // Practice is never graded, so nothing mentions the grade.
    await expect(page.getByText(/toward your grade/)).toHaveCount(0);

    await correctOption.click();
    await expect(page.getByText('Correct!')).toBeVisible();
    await expect(page.getByText(/still counts as missed/)).toHaveCount(0);
  });

  test('a wrong fill-in-the-blank answer is final and shows the correct answer', async ({
    page,
  }) => {
    await resetSeededAiQuizAttemptState();
    await selectSeededCourse(page, { role: 'student' });
    await page.goto('/quiz');
    await startQuizFromList(page, SEED.AI_QUIZ_NAME);
    await expect(page.getByText(/1 of \d+/)).toBeVisible();

    // Question order is not guaranteed; get past the open-ended item if first.
    if (!(await page.getByText(SEED.AI_FIB_TITLE, { exact: true }).isVisible())) {
      await page.getByLabel('Your response').fill('placeholder');
      await page.getByRole('button', { name: 'Submit answer' }).click();
      await page.getByRole('button', { name: /Next|Finish/ }).click();
    }
    await expect(page.getByText(SEED.AI_FIB_TITLE, { exact: true })).toBeVisible();

    await page.getByLabel('Your answer').fill('nucleus');
    await page.getByRole('button', { name: 'Submit answer' }).click();

    await expect(page.getByText('Incorrect.')).toBeVisible();
    await expect(
      page.getByText('The correct answer is Michaelis constant.')
    ).toBeVisible();
    // One attempt only — typed answers are not retried.
    await expect(page.getByLabel('Your answer')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Submit answer' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  });
});
