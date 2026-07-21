// @ts-check
const { test, expect } = require('@playwright/test');
const { expectNoA11yViolations } = require('./axe-helper');
const { BIO_PROF2_AUTH_FILE, BIO_STUDENT_AUTH_FILE } = require('../e2e/auth');
const { SEED, resetSeededAiQuizAttemptState } = require('../e2e/seed');
const { startQuizFromList } = require('../e2e/helpers');
const {
  IDP_ENABLED,
  prepareSeededStudentCourse,
  selectSeededInstructorCourse,
} = require('./authenticated-helper');

// Accessibility scans for the student grade-review step (issue #76): the
// Accept/Deny control on an AI grade and the instructor's "needs review" flag
// in the quiz-scores review view.
//
// MANUAL: verify a screen reader announces the Accept/Deny toggle state
// (aria-pressed) and reads the "You flagged this grade..." status when Deny is
// chosen — axe cannot validate live-region announcement timing.

test.describe('Accessibility: student Accept/Deny AI grade (issue #76)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');
  test.use({ storageState: BIO_STUDENT_AUTH_FILE });

  test.beforeEach(async () => {
    await resetSeededAiQuizAttemptState();
  });

  async function startAiQuiz(page) {
    await prepareSeededStudentCourse(page);
    await page.goto('/quiz');
    await startQuizFromList(page, SEED.AI_QUIZ_NAME);
    await expect(page.getByText(/1 of \d+/)).toBeVisible();
  }

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

  test('Accept/Deny control and the denied notice have no blocking axe violations', async ({
    page,
  }) => {
    await startAiQuiz(page);
    await goToOpenEndedAiQuestion(page);

    await page
      .getByLabel('Your response')
      .fill(`Apparent Km increases; Vmax unchanged. ${SEED.AI_PASS_MARKER}`);
    await page.getByRole('button', { name: 'Submit answer' }).click();

    await expect(page.getByText('Correct!')).toBeVisible();
    await expect(page.getByText(/Do you agree with this AI grade\?/)).toBeVisible();
    // Default (Accept pressed) state.
    await expectNoA11yViolations(page);

    // Denied state, with the flagged-for-review status message rendered.
    await page.getByRole('button', { name: 'Deny' }).click();
    await expect(
      page.getByText(/You flagged this grade for your instructor to review\./)
    ).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

test.describe('Accessibility: instructor needs-review flag (issue #76)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');

  test('quiz-scores review modal with a disputed grade has no blocking axe violations', async ({
    browser,
  }) => {
    await resetSeededAiQuizAttemptState();

    // Student takes the AI quiz and denies the open-ended AI grade.
    const studentContext = await browser.newContext({
      storageState: BIO_STUDENT_AUTH_FILE,
    });
    const studentPage = await studentContext.newPage();
    await prepareSeededStudentCourse(studentPage);
    await studentPage.goto('/quiz');
    await startQuizFromList(studentPage, SEED.AI_QUIZ_NAME);
    await expect(studentPage.getByText(/1 of \d+/)).toBeVisible();

    for (let i = 0; i < 2; i++) {
      const onOpenEnded = await studentPage
        .getByText(SEED.AI_OPEN_ENDED_TITLE, { exact: true })
        .isVisible();
      if (onOpenEnded) {
        await studentPage
          .getByLabel('Your response')
          .fill(`Km up, Vmax unchanged. ${SEED.AI_PASS_MARKER}`);
      } else {
        await studentPage.getByLabel('Your answer').fill('Michaelis constant');
      }
      await studentPage.getByRole('button', { name: 'Submit answer' }).click();
      await expect(
        studentPage.getByText(/Correct!|Incorrect\./).first()
      ).toBeVisible();

      if (onOpenEnded) {
        const reviewResponse = studentPage.waitForResponse(
          (response) =>
            response.request().method() === 'PUT' &&
            /\/grade-review$/.test(new URL(response.url()).pathname)
        );
        await studentPage.getByRole('button', { name: 'Deny' }).click();
        expect((await reviewResponse).ok()).toBe(true);
      }

      const completionResponse = i === 1
        ? studentPage.waitForResponse(
            (response) =>
              response.request().method() === 'POST' &&
              /\/api\/student\/quizzes\/[^/]+\/submit$/.test(new URL(response.url()).pathname)
          )
        : null;
      await studentPage.getByRole('button', { name: /Next|Finish/ }).click();
      if (completionResponse) {
        expect((await completionResponse).ok()).toBe(true);
      }
    }
    await expect(
      studentPage.getByRole('heading', { name: 'Quiz Complete!' })
    ).toBeVisible();
    await studentContext.close();

    // Instructor opens the review modal (dedicated context — axe-core rejects
    // pages on the default context; no re-seed, which would wipe the attempt).
    const instructorContext = await browser.newContext({
      storageState: BIO_PROF2_AUTH_FILE,
    });
    const instructorPage = await instructorContext.newPage();
    await selectSeededInstructorCourse(instructorPage);
    await instructorPage.goto('/quiz-scores');
    await instructorPage
      .getByLabel('Filter scores by quiz')
      .selectOption({ label: SEED.AI_QUIZ_NAME });

    const row = instructorPage.getByRole('row').filter({ hasText: /%/ }).first();
    await expect(row.getByText('Needs review')).toBeVisible();
    await row.click();
    await expect(instructorPage.getByRole('dialog')).toBeVisible();
    await expect(
      instructorPage.getByText(/Student disagreed — needs review/).first()
    ).toBeVisible();

    await expectNoA11yViolations(instructorPage, { include: '[role="dialog"]' });
    await instructorContext.close();
  });
});
