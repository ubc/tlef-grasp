const { test, expect } = require('@playwright/test');
const { BIO_PROF2_AUTH_FILE, BIO_STUDENT_AUTH_FILE } = require('./auth');
const { SEED, resetSeededAiQuizAttemptState } = require('./seed');
const { selectSeededCourse, startQuizFromList } = require('./helpers');

// LLM-graded question types (issue #45) end to end, against the seeded
// AI-graded quiz (one open-ended + one fill-in-the-blank question in the BIOC
// 302 course). The E2E LLM stub grades deterministically from markers the
// student types into the answer box (see tests/e2e/stubs/llm-stubs.js):
//   - open-ended answer containing "[[e2e-pass]]" → judge passes it
//   - fill-in-the-blank answer containing "[[e2e-equivalent]]" → rescued correct
// so no live model is ever called. Opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';

const COURSE_KEY = 'grasp-selected-course';
const ROLE_KEY = 'grasp-current-role';

// Open the seeded AI-graded quiz from the student quiz list and land on Q1.
async function startAiQuiz(page) {
  await page.goto('/quiz');
  await startQuizFromList(page, SEED.AI_QUIZ_NAME);
  await expect(page.getByText(/1 of \d+/)).toBeVisible();
}

// Advance through the quiz answering both questions to reach the summary.
// `openEndedAnswer` decides whether the AI judge passes the open-ended item.
async function takeAiQuiz(page, { openEndedAnswer, fibAnswer }) {
  for (let i = 0; i < 2; i++) {
    const heading = await page.getByRole('heading').allTextContents();
    const onOpenEnded = heading.some((h) => h.includes(SEED.AI_OPEN_ENDED_TITLE));
    const answer = onOpenEnded ? openEndedAnswer : fibAnswer;

    await page.getByLabel(onOpenEnded ? 'Your response' : 'Your answer').fill(answer);
    await page.getByRole('button', { name: 'Submit answer' }).click();
    // The feedback panel resolves once grading returns.
    await expect(
      page.getByText(/Correct!|Incorrect\.|Graded by AI/).first()
    ).toBeVisible();

    await page.getByRole('button', { name: /Next|Finish/ }).click();
  }
}

test.describe('Student AI-graded quiz (issue #45)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');
  test.use({ storageState: BIO_STUDENT_AUTH_FILE });

  test.beforeEach(async () => {
    // Each test takes the quiz fresh; reset any prior attempt/score first.
    await resetSeededAiQuizAttemptState();
  });

  test('open-ended answer that meets the criteria is graded correct with per-criterion feedback', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'student' });
    await startAiQuiz(page);

    // Land on the open-ended question (quiz order is deterministic, but assert
    // rather than assume) and submit a passing answer.
    await expect(
      page.getByRole('heading', { name: SEED.AI_OPEN_ENDED_TITLE })
    ).toBeVisible();
    await page
      .getByLabel('Your response')
      .fill(`Apparent Km increases while Vmax is unchanged. ${SEED.AI_PASS_MARKER}`);
    await page.getByRole('button', { name: 'Submit answer' }).click();

    // AI verdict, the AI-graded disclaimer, and the per-criterion breakdown.
    await expect(page.getByText('Correct!')).toBeVisible();
    await expect(page.getByText(/Graded by AI/)).toBeVisible();
    await expect(page.getByText('Key concept coverage', { exact: false })).toBeVisible();
    await expect(page.getByText('Accuracy', { exact: false })).toBeVisible();
  });

  test('open-ended answer that misses the criteria is graded incorrect', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'student' });
    await startAiQuiz(page);

    await expect(
      page.getByRole('heading', { name: SEED.AI_OPEN_ENDED_TITLE })
    ).toBeVisible();
    await page.getByLabel('Your response').fill('I am not sure.');
    await page.getByRole('button', { name: 'Submit answer' }).click();

    await expect(page.getByText('Incorrect.')).toBeVisible();
    await expect(page.getByText(/Graded by AI/)).toBeVisible();
  });

  test('fill-in-the-blank exact match is correct without an LLM call', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'student' });
    await startAiQuiz(page);

    // Navigate to the fill-in-the-blank question.
    if (!(await page.getByRole('heading', { name: SEED.AI_FIB_TITLE }).isVisible())) {
      // Submit a throwaway open-ended answer to advance.
      await page.getByLabel('Your response').fill('placeholder');
      await page.getByRole('button', { name: 'Submit answer' }).click();
      await page.getByRole('button', { name: /Next|Finish/ }).click();
    }
    await expect(
      page.getByRole('heading', { name: SEED.AI_FIB_TITLE })
    ).toBeVisible();

    // Exact canonical answer — graded correct by string match, no marker needed.
    await page.getByLabel('Your answer').fill('Michaelis constant');
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(page.getByText('Correct!')).toBeVisible();
  });

  test('fill-in-the-blank equivalent answer is rescued by the LLM fallback', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'student' });
    await startAiQuiz(page);

    if (!(await page.getByRole('heading', { name: SEED.AI_FIB_TITLE }).isVisible())) {
      await page.getByLabel('Your response').fill('placeholder');
      await page.getByRole('button', { name: 'Submit answer' }).click();
      await page.getByRole('button', { name: /Next|Finish/ }).click();
    }
    await expect(
      page.getByRole('heading', { name: SEED.AI_FIB_TITLE })
    ).toBeVisible();

    // A non-matching answer carrying the rescue marker: exact match fails, the
    // LLM fallback flips it to correct and shows its feedback.
    await page
      .getByLabel('Your answer')
      .fill(`the K m value ${SEED.AI_EQUIVALENT_MARKER}`);
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(page.getByText('Correct!')).toBeVisible();
    await expect(page.getByText(/equivalent to the expected answer/)).toBeVisible();
  });
});

test.describe('Instructor overrides an AI grade (issue #45)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');

  test('student takes the AI quiz, then the instructor reviews and overrides', async ({
    browser,
  }) => {
    await resetSeededAiQuizAttemptState();

    // --- Student takes the quiz: open-ended passes, FIB exact match. ---
    const studentContext = await browser.newContext({
      storageState: BIO_STUDENT_AUTH_FILE,
    });
    const studentPage = await studentContext.newPage();
    await selectSeededCourse(studentPage, { role: 'student' });
    await startAiQuiz(studentPage);
    await takeAiQuiz(studentPage, {
      openEndedAnswer: `Apparent Km rises, Vmax unchanged. ${SEED.AI_PASS_MARKER}`,
      fibAnswer: 'Michaelis constant',
    });
    await expect(
      studentPage.getByRole('heading', { name: 'Quiz Complete!' })
    ).toBeVisible();
    await studentContext.close();

    // --- Instructor reviews the attempt and overrides the AI grade. ---
    const instructorContext = await browser.newContext({
      storageState: BIO_PROF2_AUTH_FILE,
    });
    const instructorPage = await instructorContext.newPage();
    await selectSeededCourse(instructorPage, { role: 'instructor' });
    await instructorPage.goto('/quiz-scores');

    // Pick the AI-graded quiz, then open the student's attempt row.
    await instructorPage
      .getByLabel('Filter scores by quiz')
      .selectOption({ label: SEED.AI_QUIZ_NAME });
    const studentRow = instructorPage
      .getByRole('row')
      .filter({ hasText: /./ })
      .filter({ hasText: /%/ })
      .first();
    await studentRow.click();

    // The review modal shows the AI-graded badge, the AI feedback block, and the
    // override buttons.
    await expect(
      instructorPage.getByRole('dialog').getByText('AI-graded').first()
    ).toBeVisible();
    await expect(
      instructorPage.getByText('This answer was graded by AI. You can override the grade below.')
    ).toBeVisible();

    // Override the passing grade to incorrect.
    await instructorPage.getByRole('button', { name: 'Mark Incorrect' }).first().click();
    await expect(
      instructorPage.getByText('Incorrect').first()
    ).toBeVisible();

    await instructorContext.close();
  });
});
