// @ts-check
const { test, expect } = require('@playwright/test');
const { expectNoA11yViolations } = require('./axe-helper');
const { FACULTY_AUTH_FILE, BIO_STUDENT_AUTH_FILE } = require('../e2e/auth');
const { SEED } = require('../e2e/seed');
const { getQuizCard, startQuizFromList } = require('../e2e/helpers');
const {
  IDP_ENABLED,
  prepareAuthenticatedCourse,
  prepareSeededStudentCourse,
} = require('./authenticated-helper');

// MANUAL: verify quiz timers and feedback announcements with a screen reader,
// and verify that the quiz summary's arrow-key shortcuts do not trap keyboard
// users. Axe cannot validate announcement timing or shortcut discoverability.
async function prepareStudentView(page) {
  await prepareAuthenticatedCourse(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('grasp-current-role', 'student');
  });
}

const STUDENT_PAGES = [
  {
    path: '/student-dashboard',
    name: 'student dashboard',
    ready: (page) => page.getByRole('heading', { name: /Hello,/ }),
  },
  {
    path: '/quiz',
    name: 'available quizzes',
    ready: (page) => page.getByRole('heading', { name: 'Available Quizzes' }),
  },
  {
    path: '/achievements',
    name: 'achievements',
    ready: (page) => page.getByRole('heading', { name: 'My Achievements' }),
  },
  {
    path: '/quiz-summary',
    name: 'quiz summary error state',
    ready: (page) =>
      page.getByRole('heading', { name: 'Unable to Load Quiz Summary' }),
  },
];

test.describe('Accessibility: authenticated student pages', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');
  test.use({ storageState: FACULTY_AUTH_FILE });

  for (const pageCase of STUDENT_PAGES) {
    test(`${pageCase.name} page has no blocking axe violations`, async ({ page }) => {
      await prepareStudentView(page);
      await page.goto(pageCase.path);

      await expect(page).toHaveURL(new RegExp(`${pageCase.path}(?:[?#].*)?$`));
      await expect(pageCase.ready(page)).toBeVisible();
      await expectNoA11yViolations(page);
    });
  }

  test('student dashboard quick links are keyboard reachable', async ({ page }) => {
    await prepareStudentView(page);
    await page.goto('/student-dashboard');

    const quizLink = page.getByRole('link', { name: 'My Quizzes' }).first();
    const achievementsLink = page.getByRole('link', { name: 'Achievements' }).first();
    await expect(quizLink).toBeVisible();
    await expect(achievementsLink).toBeVisible();

    await quizLink.focus();
    await expect(quizLink).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(achievementsLink).toBeFocused();

    await expectNoA11yViolations(page);
  });

  test('instructor student preview keeps the selected course and labels the preview', async ({ page }) => {
    await prepareStudentView(page);
    await page.goto('/student-dashboard');

    const progress = page.getByRole('region');
    await expect(progress.getByText('Student preview:')).toBeVisible();
    await expect(
      progress.locator('ol').getByRole('link', { name: 'Find quizzes', exact: true })
    ).toBeVisible();
    await expectNoA11yViolations(page, { include: '[aria-labelledby="learning-path-heading"]' });
  });
});

test.describe('Accessibility: seeded student quiz states', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');
  test.use({ storageState: BIO_STUDENT_AUTH_FILE });

  async function startSeededQuiz(page) {
    await prepareSeededStudentCourse(page);
    await page.goto('/quiz');

    await expect(page.getByRole('heading', { name: 'Available Quizzes' })).toBeVisible();
    await expect(page.getByRole('heading', { name: SEED.QUIZ_NAME })).toBeVisible();
    await startQuizFromList(page, SEED.QUIZ_NAME);
    await expect(page.getByRole('heading', { name: SEED.QUIZ_NAME })).toBeVisible();
    await expect(page.getByText(new RegExp(`1 of ${SEED.QUESTION_COUNT}`))).toBeVisible();
  }

  async function answerCurrentQuestionCorrectly(page) {
    const correctOption = page.getByRole('button', {
      name: new RegExp(SEED.CORRECT_OPTION_TEXTS.map(escapeRegExp).join('|')),
    });
    await correctOption.first().click();
    await expect(page.getByText('Correct!')).toBeVisible();
  }

  async function answerAllCorrectly(page) {
    for (let index = 0; index < SEED.QUESTION_COUNT; index += 1) {
      await answerCurrentQuestionCorrectly(page);
      await page.getByRole('button', { name: /Next|Finish/ }).click();
    }
  }

  test('seeded quiz list and first-question feedback state have no blocking axe violations', async ({
    page,
  }) => {
    await prepareSeededStudentCourse(page);
    await page.goto('/quiz');

    await expect(page.getByRole('heading', { name: 'Pending Quizzes' })).toBeVisible();
    await expect(page.getByRole('heading', { name: SEED.QUIZ_NAME })).toBeVisible();
    await expect(
      getQuizCard(page, SEED.QUIZ_NAME).getByRole('button', { name: 'Start Quiz' })
    ).toBeVisible();
    await expectNoA11yViolations(page);

    await startQuizFromList(page, SEED.QUIZ_NAME);
    await expect(page.getByRole('heading', { name: SEED.QUIZ_NAME })).toBeVisible();
    await expect(page.getByRole('button', { name: SEED.CORRECT_OPTION_TEXTS[0] })).toBeVisible();
    await expectNoA11yViolations(page);

    await answerCurrentQuestionCorrectly(page);
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
    await expectNoA11yViolations(page);
  });

  test('quiz calendar events and month controls are keyboard accessible', async ({ page }) => {
    await prepareSeededStudentCourse(page);
    await page.goto('/student-dashboard');

    const calendar = page.getByLabel('Quiz calendar');
    const previous = calendar.getByRole('button', { name: 'Previous month' });
    const next = calendar.getByRole('button', { name: 'Next month' });
    await previous.focus();
    await expect(previous).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(next).toBeFocused();

    await expect(calendar.getByText(SEED.QUIZ_NAME).first()).toBeVisible();
    await expect(calendar.getByRole('link', { name: /Start quiz|Retake quiz/ }).first()).toBeVisible();
    await expectNoA11yViolations(page, { include: '[aria-label="Quiz calendar"]' });
  });

  test('completion, retake list, and populated achievements states have no blocking axe violations', async ({
    page,
  }) => {
    await startSeededQuiz(page);
    await answerAllCorrectly(page);

    await expect(page.getByRole('heading', { name: 'Quiz Complete!' })).toBeVisible();
    await expect(page.getByText('100%')).toBeVisible();
    await expectNoA11yViolations(page);

    await page.getByRole('button', { name: 'Back to Quizzes' }).click();
    await expect(page.getByRole('heading', { name: 'Completed Quizzes' })).toBeVisible();
    await expect(
      getQuizCard(page, SEED.QUIZ_NAME).getByRole('button', { name: 'Retake Quiz' })
    ).toBeVisible();
    await expectNoA11yViolations(page);

    await page.goto('/achievements');
    await expect(page.getByRole('heading', { name: 'My Achievements' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quiz Completed' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Perfect Score!' }).first()).toBeVisible();
    await expect(page.getByText(`Quiz: ${SEED.QUIZ_NAME}`).first()).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
