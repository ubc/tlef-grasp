// @ts-check
const { test, expect } = require('@playwright/test');
const { expectNoA11yViolations } = require('./axe-helper');
const { FACULTY_AUTH_FILE } = require('../e2e/auth');
const {
  IDP_ENABLED,
  prepareAuthenticatedCourse,
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
});
