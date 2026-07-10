// @ts-check
const { test, expect } = require('@playwright/test');
const { expectNoA11yViolations } = require('./axe-helper');
const { BIO_PROF2_AUTH_FILE, BIO_STUDENT_AUTH_FILE } = require('../e2e/auth');
const { SEED, resetSeededAiQuizAttemptState } = require('../e2e/seed');
const { startQuizFromList } = require('../e2e/helpers');
const {
  IDP_ENABLED,
  prepareSeededStudentCourse,
  prepareSeededInstructorCourse,
  selectSeededInstructorCourse,
} = require('./authenticated-helper');

// Accessibility scans for the LLM-grading UI (issue #45): the student's
// AI-graded feedback panel (verdict + per-criterion list) and the instructor's
// review modal with AI feedback and override controls, plus the two new grading
// prompt editors in Settings.
//
// MANUAL: verify a screen reader announces the pass/fail verdict and each
// criterion's met/not-met state when the feedback panel appears — the icons
// carry aria-hidden and the state is conveyed with visually-hidden text, which
// axe cannot validate for timing/announcement.

test.describe('Accessibility: AI-graded student feedback (issue #45)', () => {
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

  test('open-ended AI verdict + per-criterion feedback has no blocking axe violations', async ({
    page,
  }) => {
    await startAiQuiz(page);
    await goToOpenEndedAiQuestion(page);
    await expect(
      page.getByText(SEED.AI_OPEN_ENDED_TITLE, { exact: true })
    ).toBeVisible();

    // Un-graded input state.
    await expectNoA11yViolations(page);

    await page
      .getByLabel('Your response')
      .fill(`Apparent Km increases; Vmax unchanged. ${SEED.AI_PASS_MARKER}`);
    await page.getByRole('button', { name: 'Submit answer' }).click();

    await expect(page.getByText('Correct!')).toBeVisible();
    await expect(page.getByText(/Graded by AI/)).toBeVisible();
    // Graded feedback state, with the per-criterion list rendered.
    await expectNoA11yViolations(page);
  });

  test('fill-in-the-blank rescued feedback state has no blocking axe violations', async ({
    page,
  }) => {
    await startAiQuiz(page);

    if (!(await page.getByText(SEED.AI_FIB_TITLE, { exact: true }).isVisible())) {
      await page.getByLabel('Your response').fill('placeholder');
      await page.getByRole('button', { name: 'Submit answer' }).click();
      await page.getByRole('button', { name: /Next|Finish/ }).click();
    }
    await expect(
      page.getByText(SEED.AI_FIB_TITLE, { exact: true })
    ).toBeVisible();

    await page
      .getByLabel('Your answer')
      .fill(`k m value ${SEED.AI_EQUIVALENT_MARKER}`);
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(page.getByText('Correct!')).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

test.describe('Accessibility: instructor review modal with AI grade (issue #45)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');

  test('review modal AI feedback + override controls have no blocking axe violations', async ({
    browser,
  }) => {
    await resetSeededAiQuizAttemptState();

    // Student takes the AI quiz so there is an attempt to review.
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

    // Instructor opens the review modal. Select the seeded course WITHOUT
    // re-seeding — re-seeding wipes the attempt the student just submitted, so
    // the score row would show "Not Taken" and never render.
    // A dedicated context (not browser.newPage) is required: axe-core rejects
    // pages on the default context.
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
    await row.click();
    await expect(instructorPage.getByRole('dialog')).toBeVisible();
    await expect(
      instructorPage.getByText(/AI Feedback/).first()
    ).toBeVisible();

    await expectNoA11yViolations(instructorPage, { include: '[role="dialog"]' });
    await instructorContext.close();
  });
});

test.describe('Accessibility: grading prompt settings (issue #45)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  test('Course Prompts tab with grading prompts has no blocking axe violations', async ({
    page,
  }) => {
    await prepareSeededInstructorCourse(page);
    await page.goto('/settings');

    await page.getByRole('button', { name: 'Course Prompts' }).click();
    await expect(page.getByRole('heading', { name: 'LLM Prompts' })).toBeVisible();

    // The two new grading prompt editors are present and labelled.
    await expect(
      page.getByLabel('Open-Ended Answer Grading Prompt')
    ).toBeVisible();
    await expect(
      page.getByLabel('Fill-in-the-Blank Fallback Grading Prompt')
    ).toBeVisible();

    await expectNoA11yViolations(page);
  });
});
