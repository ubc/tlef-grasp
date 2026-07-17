const { expect } = require('@playwright/test');
const { SEED, resetSeededQuizAttemptState } = require('./seed');

const COURSE_KEY = 'grasp-selected-course';
const ROLE_KEY = 'grasp-current-role';

async function selectSeededCourse(page, { role }) {
  const endpoint = role === 'student' ? '/api/student/courses' : '/api/courses/my';
  const response = await page.request.get(endpoint);
  expect(response.ok(), `${role} can read available courses`).toBe(true);

  const body = await response.json();
  const course = (body.courses || []).find(
    (candidate) => (candidate.courseName || candidate.name) === SEED.COURSE_NAME
  );
  expect(
    course,
    `seeded course "${SEED.COURSE_NAME}" is present for ${role}`
  ).toBeTruthy();

  const selected = {
    id: String(course._id || course.id),
    name: course.courseName || course.name,
  };

  await page.addInitScript(
    ({ courseKey, roleKey, selectedCourse, currentRole }) => {
      window.sessionStorage.setItem(courseKey, JSON.stringify(selectedCourse));
      window.localStorage.setItem(roleKey, currentRole);
    },
    {
      courseKey: COURSE_KEY,
      roleKey: ROLE_KEY,
      selectedCourse: selected,
      currentRole: role === 'student' ? 'student' : 'instructor',
    }
  );

  return selected;
}

async function answerSeededQuizCorrectly(page) {
  const correctOption = page.getByRole('button', {
    name: new RegExp(SEED.CORRECT_OPTION_TEXTS.map(escapeRegExp).join('|')),
  });

  for (let i = 0; i < SEED.QUESTION_COUNT; i++) {
    await correctOption.first().click();
    await expect(page.getByText('Correct!')).toBeVisible();
    await page.getByRole('button', { name: /Next|Finish/ }).click();
  }
}

function getQuizCard(page, quizName) {
  // The heading sits inside the card header, so its grandparent is the card
  // containing the corresponding controls. Scoping controls to this card keeps
  // the tests deterministic when a course has more than one published quiz.
  return page
    .getByRole('heading', { name: quizName, exact: true })
    .locator('xpath=../..');
}

async function startQuizFromList(page, quizName) {
  const quizCard = getQuizCard(page, quizName);
  await expect(quizCard).toBeVisible();
  await quizCard
    .getByRole('button', { name: /Start Quiz|Retake Quiz/ })
    .click();
}

async function completeSeededQuiz(page) {
  // Only the first attempt is graded ("Quiz Complete!" + score); any later run
  // is an ungraded practice round. Wipe whatever attempt state earlier specs
  // or previous runs left so this attempt is the graded one.
  await resetSeededQuizAttemptState();

  await page.goto('/quiz');
  await expect(page.getByRole('heading', { name: SEED.QUIZ_NAME })).toBeVisible();
  await startQuizFromList(page, SEED.QUIZ_NAME);
  await expect(page.getByText(/1 of \d+/)).toBeVisible();

  await answerSeededQuizCorrectly(page);

  await expect(
    page.getByRole('heading', { name: 'Quiz Complete!' })
  ).toBeVisible();
  await expect(page.getByText('100%')).toBeVisible();
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  selectSeededCourse,
  answerSeededQuizCorrectly,
  getQuizCard,
  startQuizFromList,
  completeSeededQuiz,
};
