// @ts-check
const { test, expect } = require('@playwright/test');
const { expectNoA11yViolations } = require('./axe-helper');
const { FACULTY_AUTH_FILE } = require('../e2e/auth');
const {
  IDP_ENABLED,
  gotoCoursePage,
  prepareAuthenticatedCourse,
} = require('./authenticated-helper');

// MANUAL: verify sidebar reading order, mobile drawer focus behavior, icon-only
// controls' descriptions, and whether dense tables remain understandable with a
// screen reader. Axe cannot judge those interaction-level qualities.
const INSTRUCTOR_PAGES = [
  {
    path: '/dashboard',
    name: 'dashboard',
    ready: (page) => page.getByRole('heading', { name: /hello,/i }),
  },
  {
    path: '/course-materials',
    name: 'course materials',
    ready: (page) => page.getByRole('heading', { name: 'Course Materials' }),
  },
  {
    path: '/question-generation',
    name: 'question generation',
    ready: (page) =>
      page.getByRole('heading', { name: /No Course Materials Found|Create Objectives/i }),
  },
  {
    path: '/question-bank',
    name: 'question bank questions tab',
    ready: (page) => page.getByRole('button', { name: 'Questions' }),
  },
  {
    path: '/question-bank?tab=objectives',
    name: 'question bank objectives tab',
    ready: (page) => page.getByRole('button', { name: 'Learning Objectives' }),
  },
  {
    path: '/question-review',
    name: 'question review',
    ready: (page) => page.getByText(/No questions|Question Review|Review/i).first(),
  },
  {
    path: '/quizzes',
    name: 'quizzes',
    ready: (page) => page.getByRole('button', { name: 'Manage Quizzes' }),
  },
  {
    path: '/quiz-scores',
    name: 'quiz scores',
    ready: (page) => page.getByRole('heading', { name: 'Quiz Scores' }),
  },
  {
    path: '/my-sections',
    name: 'my sections',
    ready: (page) => page.getByRole('heading', { name: 'My Sections' }),
  },
  {
    path: '/users',
    name: 'users',
    ready: (page) => page.getByRole('heading', { name: 'Course Users' }),
  },
  {
    path: '/settings',
    name: 'settings',
    ready: (page) => page.getByRole('heading', { name: 'Settings' }),
  },
];

test.describe('Accessibility: authenticated instructor pages', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');
  test.use({ storageState: FACULTY_AUTH_FILE });

  test('onboarding tabs and validation state have no blocking axe violations', async ({
    page,
  }) => {
    await page.goto('/onboarding');

    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Course Setup' })).toBeVisible();

    await page.getByRole('button', { name: 'New Course Setup' }).click();
    await expect(page.getByLabel('Campus')).toBeVisible();
    await page.getByRole('button', { name: 'Create Course' }).click();
    await expect(
      page.getByText('Select a campus, academic period, and at least one section.')
    ).toBeVisible();

    await expectNoA11yViolations(page);
  });

  for (const pageCase of INSTRUCTOR_PAGES) {
    test(`${pageCase.name} page has no blocking axe violations`, async ({ page }) => {
      await gotoCoursePage(page, pageCase.path, pageCase.ready);
      await expectNoA11yViolations(page);
    });
  }

  test('mobile navigation drawer open state has no blocking axe violations', async ({
    page,
  }) => {
    await prepareAuthenticatedCourse(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');

    const trigger = page.getByRole('button', { name: 'Open navigation menu' });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const close = page.getByRole('button', { name: 'Close navigation menu' });
    await expect(close).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test.fixme(
    'mobile navigation drawer moves focus inside and closes with Escape',
    async ({ page }) => {
      await prepareAuthenticatedCourse(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/dashboard');

      const trigger = page.getByRole('button', { name: 'Open navigation menu' });
      await trigger.focus();
      await page.keyboard.press('Enter');

      const close = page.getByRole('button', { name: 'Close navigation menu' });
      await expect(close).toBeVisible();
      // See FINDINGS.md Accessibility: AppLayout/Sidebar mobile drawer focus.
      await expect(close).toBeFocused();

      await page.keyboard.press('Escape');
      await expect(close).toBeHidden();
      await expect(trigger).toBeFocused();
    }
  );
});
