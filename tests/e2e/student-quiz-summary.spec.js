const { test, expect } = require('@playwright/test');
const { BIO_STUDENT_AUTH_FILE } = require('./auth');
const { SEED } = require('./seed');
const { selectSeededCourse, completeSeededQuiz } = require('./helpers');

// Quiz Summary page (/quiz-summary?quiz=<id>) for bio_student: the error state
// when no quiz is specified, and a real post-attempt review of the seeded quiz.
// The route is only reachable by URL today (no in-app link), so the specs
// navigate directly. Opt-in (E2E_SAML=1) like the rest of the authenticated
// suite.
const IDP_ENABLED = process.env.E2E_SAML === '1';

test.describe('Student quiz summary (authenticated)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_STUDENT_AUTH_FILE });

  test('shows a recoverable error when no quiz is specified', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'student' });
    await page.goto('/quiz-summary');

    await expect(
      page.getByRole('heading', { name: 'Unable to Load Quiz Summary' })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Return to Dashboard' }).click();
    await expect(page).toHaveURL('/student-dashboard');
  });

  // FIXME: the results endpoint backing this page is a 501 stub, so the review
  // never loads for a real attempt — see FINDINGS.md ("Quiz Summary results
  // endpoint unimplemented"). The assertions below describe the intended
  // behaviour; unskip when getQuizResultsHandler is implemented.
  test.fixme('reviews a completed attempt question by question', async ({ page }) => {
    const course = await selectSeededCourse(page, { role: 'student' });
    // A fresh perfect attempt makes the summary deterministic regardless of
    // what earlier specs (or previous runs) did to attempt state.
    await completeSeededQuiz(page);

    // Resolve the seeded quiz id from the same overview API the list view uses.
    const overview = await page.request.get(
      `/api/quiz/course/${course.id}/student-overview`
    );
    expect(overview.ok(), 'student can read the quiz overview').toBe(true);
    const { quizzes } = await overview.json();
    const quiz = (quizzes || []).find((q) => q.name === SEED.QUIZ_NAME);
    expect(quiz, `seeded quiz "${SEED.QUIZ_NAME}" is in the overview`).toBeTruthy();

    await page.goto(`/quiz-summary?quiz=${quiz._id || quiz.id}`);

    // Sidebar: perfect score over all seeded questions.
    await expect(page.getByRole('heading', { name: 'Quiz Summary' })).toBeVisible();
    await expect(
      page.getByText(`${SEED.QUESTION_COUNT}/${SEED.QUESTION_COUNT}`)
    ).toBeVisible();
    await expect(page.getByText('100% Score')).toBeVisible();

    // Detail pane starts on question 1, marked correct, showing the answer the
    // student picked (always a seeded known-correct option text).
    await expect(
      page.getByRole('heading', {
        name: `Question 1 of ${SEED.QUESTION_COUNT}`,
      })
    ).toBeVisible();
    await expect(page.getByText('Correct', { exact: true })).toBeVisible();
    await expect(
      page
        .getByText(new RegExp(SEED.CORRECT_OPTION_TEXTS.map(escapeRegExp).join('|')))
        .first()
    ).toBeVisible();

    // Paging: Next advances, the numbered sidebar buttons jump, and Next is
    // disabled on the last question.
    await page.getByRole('button', { name: 'Next Question' }).click();
    await expect(
      page.getByRole('heading', {
        name: `Question 2 of ${SEED.QUESTION_COUNT}`,
      })
    ).toBeVisible();

    await page
      .getByRole('button', { name: `Go to question ${SEED.QUESTION_COUNT}` })
      .click();
    await expect(
      page.getByRole('heading', {
        name: `Question ${SEED.QUESTION_COUNT} of ${SEED.QUESTION_COUNT}`,
      })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next Question' })).toBeDisabled();
  });
});

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
