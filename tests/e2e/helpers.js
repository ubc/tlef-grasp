const { expect } = require('@playwright/test');
const { SEED } = require('./seed');

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

async function completeSeededQuiz(page) {
  await page.goto('/quiz');
  await expect(page.getByRole('heading', { name: SEED.QUIZ_NAME })).toBeVisible();
  await page.getByRole('button', { name: /Start Quiz|Retake Quiz/ }).first().click();
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
  completeSeededQuiz,
};
