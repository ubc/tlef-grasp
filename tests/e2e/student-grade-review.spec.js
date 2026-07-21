const { test, expect } = require('@playwright/test');
const { BIO_PROF2_AUTH_FILE, BIO_STUDENT_AUTH_FILE } = require('./auth');
const { SEED, resetSeededAiQuizAttemptState } = require('./seed');
const { selectSeededCourse, startQuizFromList } = require('./helpers');

// Student review step between AI auto-grading and instructor review (issue #76):
// after the LLM grades an answer the student sees the verdict and can Accept
// (the default) or Deny it. A denial flags the attempt so the instructor can
// find it quickly in the quiz-scores review view.
//
// Reuses the seeded AI-graded quiz and the deterministic E2E LLM stub markers
// (see tests/e2e/stubs/llm-stubs.js). Opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';

async function startAiQuiz(page) {
  await page.goto('/quiz');
  await startQuizFromList(page, SEED.AI_QUIZ_NAME);
  await expect(page.getByText(/1 of \d+/)).toBeVisible();
}

// Land on the open-ended question, answering the fill-in-the-blank first if the
// quiz served it before the open-ended item (Mongo does not guarantee order).
async function goToOpenEndedAiQuestion(page) {
  const openEndedQuestion = page.getByText(SEED.AI_OPEN_ENDED_TITLE, { exact: true });
  if (await openEndedQuestion.isVisible()) return;

  await expect(page.getByText(SEED.AI_FIB_TITLE, { exact: true })).toBeVisible();
  await page.getByLabel('Your answer').fill('placeholder');
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByText(/Correct!|Incorrect\./).first()).toBeVisible();
  await page.getByRole('button', { name: /Next|Finish/ }).click();
  await expect(openEndedQuestion).toBeVisible();
}

// Answer both questions to reach the completion screen; `openEndedAction`
// optionally clicks Accept/Deny on the open-ended AI grade before advancing.
async function takeAiQuiz(page, { openEndedAnswer, fibAnswer, openEndedAction }) {
  for (let i = 0; i < 2; i++) {
    const onOpenEnded = await page
      .getByText(SEED.AI_OPEN_ENDED_TITLE, { exact: true })
      .isVisible();
    const answer = onOpenEnded ? openEndedAnswer : fibAnswer;

    await page.getByLabel(onOpenEnded ? 'Your response' : 'Your answer').fill(answer);
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(
      page.getByText(/Correct!|Incorrect\.|Graded by AI/).first()
    ).toBeVisible();

    if (onOpenEnded && openEndedAction) {
      await openEndedAction(page);
    }

    const completionResponse = i === 1
      ? page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            /\/api\/student\/quizzes\/[^/]+\/submit$/.test(new URL(response.url()).pathname)
        )
      : null;
    await page.getByRole('button', { name: /Next|Finish/ }).click();
    if (completionResponse) {
      expect((await completionResponse).ok()).toBe(true);
    }
  }
}

test.describe('Student reviews an AI grade (issue #76)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');
  test.use({ storageState: BIO_STUDENT_AUTH_FILE });

  test.beforeEach(async () => {
    await resetSeededAiQuizAttemptState();
  });

  test('accept is the default state on an AI-graded answer', async ({ page }) => {
    await selectSeededCourse(page, { role: 'student' });
    await startAiQuiz(page);
    await goToOpenEndedAiQuestion(page);

    await page
      .getByLabel('Your response')
      .fill(`Apparent Km increases; Vmax unchanged. ${SEED.AI_PASS_MARKER}`);
    await page.getByRole('button', { name: 'Submit answer' }).click();

    await expect(page.getByText('Correct!')).toBeVisible();
    await expect(page.getByText(/Do you agree with this AI grade\?/)).toBeVisible();

    // Default state: Accept is pressed, Deny is not, and no dispute notice shows.
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.getByRole('button', { name: 'Deny' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await expect(
      page.getByText(/You flagged this grade for your instructor to review\./)
    ).toHaveCount(0);
  });

  test('denying the grade records it and shows the flagged notice', async ({ page }) => {
    await selectSeededCourse(page, { role: 'student' });
    await startAiQuiz(page);
    await goToOpenEndedAiQuestion(page);

    await page
      .getByLabel('Your response')
      .fill(`Apparent Km increases; Vmax unchanged. ${SEED.AI_PASS_MARKER}`);
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(page.getByText('Correct!')).toBeVisible();

    // The deny request is persisted server-side.
    const reviewResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        /\/api\/quiz\/[^/]+\/question\/[^/]+\/grade-review$/.test(
          new URL(response.url()).pathname
        )
    );
    await page.getByRole('button', { name: 'Deny' }).click();
    expect((await reviewResponse).ok()).toBe(true);

    await expect(page.getByRole('button', { name: 'Deny' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(
      page.getByText(/You flagged this grade for your instructor to review\./)
    ).toBeVisible();
  });
});

test.describe('Instructor sees a denied AI grade flagged for review (issue #76)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');

  test('student denies the AI grade, then the instructor sees the needs-review flag', async ({
    browser,
  }) => {
    await resetSeededAiQuizAttemptState();

    // --- Student takes the quiz and denies the open-ended AI grade. ---
    const studentContext = await browser.newContext({
      storageState: BIO_STUDENT_AUTH_FILE,
    });
    const studentPage = await studentContext.newPage();
    await selectSeededCourse(studentPage, { role: 'student' });
    await startAiQuiz(studentPage);
    await takeAiQuiz(studentPage, {
      openEndedAnswer: `Apparent Km rises, Vmax unchanged. ${SEED.AI_PASS_MARKER}`,
      fibAnswer: 'Michaelis constant',
      openEndedAction: async (page) => {
        const reviewResponse = page.waitForResponse(
          (response) =>
            response.request().method() === 'PUT' &&
            /\/grade-review$/.test(new URL(response.url()).pathname)
        );
        await page.getByRole('button', { name: 'Deny' }).click();
        expect((await reviewResponse).ok()).toBe(true);
      },
    });
    await expect(
      studentPage.getByRole('heading', { name: 'Quiz Complete!' })
    ).toBeVisible();
    await studentContext.close();

    // --- Instructor reviews the attempt. ---
    const instructorContext = await browser.newContext({
      storageState: BIO_PROF2_AUTH_FILE,
    });
    const instructorPage = await instructorContext.newPage();
    await selectSeededCourse(instructorPage, { role: 'instructor' });
    await instructorPage.goto('/quiz-scores');
    await instructorPage
      .getByLabel('Filter scores by quiz')
      .selectOption({ label: SEED.AI_QUIZ_NAME });

    // Row-level flag: the student's row is tagged "Needs review" in the
    // dedicated Flagged column.
    const studentRow = instructorPage.getByRole('row').filter({ hasText: /%/ }).first();
    await expect(studentRow.getByText('Needs review')).toBeVisible();

    // The "Flagged for review only" filter keeps the flagged row and the flag
    // stays visible (a student with no denial would be filtered out).
    await instructorPage
      .getByLabel('Flagged for review only')
      .check();
    await expect(
      instructorPage.getByRole('row').filter({ hasText: 'Needs review' }).first()
    ).toBeVisible();

    // Modal-level flag: the denied open-ended answer shows the dispute badge.
    await instructorPage
      .getByRole('row')
      .filter({ hasText: 'Needs review' })
      .first()
      .click();
    await expect(instructorPage.getByRole('dialog')).toBeVisible();
    await expect(
      instructorPage.getByText(/Student disagreed — needs review/).first()
    ).toBeVisible();

    await instructorContext.close();
  });
});
