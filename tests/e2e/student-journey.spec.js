const { test, expect } = require('@playwright/test');
const { BIO_STUDENT_AUTH_FILE } = require('./auth');
const { SEED } = require('./seed');

// Full student journey for bio_student (a named IdP persona enrolled in the
// seeded BIOC 302 section): log in, find the published quiz seeded by
// saml.setup.js, take it answering correctly, see the score, then retry it.
//
// The course + approved questions + published/open quiz are seeded once by
// tests/e2e/seed.js (called from saml.setup.js), so this spec never has to
// create instructor-side data. It is opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';

const COURSE_KEY = 'grasp-selected-course';
const ROLE_KEY = 'grasp-current-role';

test.describe('Student journey: bio_student takes the seeded quiz', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');
  test.use({ storageState: BIO_STUDENT_AUTH_FILE });

  // Make the seeded course the active one before any student page renders.
  // Playwright's storageState does NOT carry sessionStorage, and the app keeps
  // the selected course there, so we resolve the course id from the API (the
  // stored SAML cookie authenticates the request) and inject it per test.
  async function selectSeededCourse(page) {
    const response = await page.request.get('/api/student/courses');
    expect(response.ok(), 'bio_student can read their courses').toBe(true);
    const body = await response.json();
    const course = (body.courses || []).find(
      (c) => (c.courseName || c.name) === SEED.COURSE_NAME
    );
    expect(
      course,
      `seeded course "${SEED.COURSE_NAME}" is present for bio_student`
    ).toBeTruthy();

    await page.addInitScript(
      ({ courseKey, roleKey, selected }) => {
        window.sessionStorage.setItem(courseKey, JSON.stringify(selected));
        window.localStorage.setItem(roleKey, 'student');
      },
      {
        courseKey: COURSE_KEY,
        roleKey: ROLE_KEY,
        selected: {
          id: String(course._id || course.id),
          name: course.courseName || course.name,
        },
      }
    );
    return course;
  }

  // Answer every question with its correct option, advancing to the end.
  // Each question shows exactly one of the seeded known-correct option texts
  // (correct answers are seeded as option A of every question), so one union
  // locator auto-waits for whichever question is on screen — no branching.
  async function answerAllCorrectly(page) {
    const correctOption = page.getByRole('button', {
      name: new RegExp(SEED.CORRECT_OPTION_TEXTS.map(escapeRegExp).join('|')),
    });
    for (let i = 0; i < SEED.QUESTION_COUNT; i++) {
      await correctOption.first().click();
      await expect(page.getByText('Correct!')).toBeVisible();
      // "Next" between questions, "Finish" on the last one.
      await page.getByRole('button', { name: /Next|Finish/ }).click();
    }
  }

  test('finds the seeded quiz in the available list and starts it', async ({
    page,
  }) => {
    await selectSeededCourse(page);
    await page.goto('/quiz');

    await expect(
      page.getByRole('heading', { name: 'Available Quizzes' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: SEED.QUIZ_NAME })
    ).toBeVisible();

    await page.getByRole('button', { name: /Start Quiz|Retake Quiz/ }).click();

    // Quiz taking view: header shows the quiz title and the first question.
    await expect(
      page.getByRole('heading', { name: SEED.QUIZ_NAME })
    ).toBeVisible();
    await expect(page.getByText(/1 of \d+/)).toBeVisible();
  });

  test('resumes at the first unanswered question after a reload (#36)', async ({
    page,
  }) => {
    await selectSeededCourse(page);
    await page.goto('/quiz');
    await page.getByRole('button', { name: /Start Quiz|Retake Quiz/ }).click();
    await expect(page.getByText(/1 of \d+/)).toBeVisible();

    // Answer only the first question, then simulate an accidental reload.
    const correctOption = page.getByRole('button', {
      name: new RegExp(SEED.CORRECT_OPTION_TEXTS.map(escapeRegExp).join('|')),
    });
    await correctOption.first().click();
    await expect(page.getByText('Correct!')).toBeVisible();
    await page.goto('/quiz');

    // Re-entering the quiz restores the recorded answer and lands on the
    // first unanswered question instead of question 1.
    await page.getByRole('button', { name: /Start Quiz|Retake Quiz/ }).click();
    await expect(page.getByText(/2 of \d+/)).toBeVisible();

    // Going back shows question 1 already answered correctly.
    await page.getByRole('button', { name: 'Previous' }).click();
    await expect(page.getByText(/1 of \d+/)).toBeVisible();
    await expect(page.getByText('Correct!')).toBeVisible();
    await page.getByRole('button', { name: /Next/ }).click();

    // Finish the attempt so the rest of the journey starts from a clean,
    // completed state (the restored q1 answer counts toward the score).
    for (let i = 0; i < SEED.QUESTION_COUNT - 1; i++) {
      await correctOption.first().click();
      await expect(page.getByText('Correct!')).toBeVisible();
      await page.getByRole('button', { name: /Next|Finish/ }).click();
    }
    await expect(
      page.getByRole('heading', { name: 'Quiz Complete!' })
    ).toBeVisible();
    await expect(page.getByText('100%')).toBeVisible();
  });

  test('completes the quiz correctly and sees a perfect score', async ({
    page,
  }) => {
    await selectSeededCourse(page);
    await page.goto('/quiz');
    await page.getByRole('button', { name: /Start Quiz|Retake Quiz/ }).click();
    await expect(page.getByText(/1 of \d+/)).toBeVisible();

    await answerAllCorrectly(page);

    await expect(
      page.getByRole('heading', { name: 'Quiz Complete!' })
    ).toBeVisible();
    // All answers correct → 100%.
    await expect(page.getByText('100%')).toBeVisible();
  });

  test('can retry the quiz after completing it', async ({ page }) => {
    await selectSeededCourse(page);
    await page.goto('/quiz');

    // The previous step completed the quiz, so it now sits under "Completed
    // Quizzes" and the list offers a Retake instead of Start.
    await expect(
      page.getByRole('heading', { name: 'Completed Quizzes' })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Retake Quiz' }).click();
    await expect(page.getByText(/1 of \d+/)).toBeVisible();
    await answerAllCorrectly(page);
    await expect(
      page.getByRole('heading', { name: 'Quiz Complete!' })
    ).toBeVisible();

    // Restart returns to the first question of a fresh attempt.
    await page.getByRole('button', { name: 'Restart Quiz' }).click();
    await expect(page.getByText(/1 of \d+/)).toBeVisible();
    await expect(page.getByText('Correct!')).toHaveCount(0);
  });

  test('earned completion and perfect-score achievements for the quiz', async ({
    page,
  }) => {
    await selectSeededCourse(page);
    await page.goto('/achievements');

    await expect(
      page.getByRole('heading', { name: 'My Achievements' })
    ).toBeVisible();

    // The perfect run earlier in the journey awarded both achievement types,
    // and the cards name the seeded quiz with the 100% score.
    await expect(
      page.getByRole('heading', { name: 'Quiz Completed' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Perfect Score!' })
    ).toBeVisible();
    await expect(page.getByText(`Quiz: ${SEED.QUIZ_NAME}`).first()).toBeVisible();
    await expect(page.getByText('Score: 100%').first()).toBeVisible();
  });
});

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
