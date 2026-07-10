// @ts-check
const { test, expect } = require('@playwright/test');
const { expectNoA11yViolations } = require('./axe-helper');
const { FACULTY_AUTH_FILE, BIO_PROF2_AUTH_FILE } = require('../e2e/auth');
const { SEED } = require('../e2e/seed');
const { getQuizCard } = require('../e2e/helpers');
const {
  IDP_ENABLED,
  gotoCoursePage,
  prepareAuthenticatedCourse,
  prepareSeededInstructorCourse,
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
    ready: (page) => page.getByRole('heading', { name: 'Questions' }),
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

  test('onboarding tabs and setup form have no blocking axe violations', async ({
    page,
  }) => {
    await page.goto('/onboarding');

    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Course Setup' })).toBeVisible();

    await page.getByRole('button', { name: 'New Course Setup' }).click();
    await expect(page.getByLabel('Campus')).toBeVisible();
    await expect(page.getByLabel('Academic period')).toBeVisible();
    await expect(page.getByText('Select an academic period to see your sections.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Course' })).toBeDisabled();

    await expectNoA11yViolations(page);
  });

  for (const pageCase of INSTRUCTOR_PAGES) {
    test(`${pageCase.name} page has no blocking axe violations`, async ({ page }) => {
      await gotoCoursePage(page, pageCase.path, pageCase.ready);
      await expectNoA11yViolations(page);
    });
  }

  test('dashboard course path is labelled, keyboard reachable, and has no blocking axe violations', async ({ page }) => {
    await gotoCoursePage(page, '/dashboard', (p) =>
      p.getByRole('heading', { name: /course progress|continue building your course|your course is ready|build your first quiz/i })
    );

    const path = page.getByRole('region');
    await expect(path.getByRole('link', { name: /continue:|manage quizzes/i })).toBeVisible();
    await expect(path.getByRole('link', { name: 'Upload', exact: true })).toBeVisible();
    await expect(path.getByRole('link', { name: 'Publish' })).toBeVisible();

    await path.getByRole('link', { name: 'Upload', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(path.getByRole('link', { name: 'Create objectives' })).toBeFocused();
    await expectNoA11yViolations(page, { include: '[aria-labelledby="course-path-heading"]' });
  });

  test('co-instructor permissions tab has no blocking axe violations', async ({
    page,
  }) => {
    // The owner-only permissions tab holds the switches and the Reset to
    // Defaults control added for issue #33.
    await gotoCoursePage(page, '/settings', (p) =>
      p.getByRole('heading', { name: 'Settings' })
    );
    await page.getByRole('button', { name: 'Co-Instructor Permissions' }).click();
    await expect(
      page.getByRole('heading', { name: 'Co-Instructor Permissions' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Reset to Defaults' })
    ).toBeVisible();
    await expectNoA11yViolations(page);
  });

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

  test(
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

test.describe('Accessibility: seeded instructor populated states', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  test('seeded quiz card and export dialog have no blocking axe violations', async ({
    page,
  }) => {
    await prepareSeededInstructorCourse(page);
    await page.goto('/quizzes');

    await expect(page.getByRole('button', { name: 'Manage Quizzes' })).toBeVisible();
    const quizCard = getQuizCard(page, SEED.QUIZ_NAME);
    await expect(quizCard).toBeVisible();
    await expect(quizCard.getByRole('button', { name: 'Export' })).toBeVisible();
    await expectNoA11yViolations(page);

    await quizCard.getByRole('button', { name: 'Export' }).click();
    await expect(page.getByText('Export Quiz')).toBeVisible();
    await expect(page.getByRole('button', { name: /Canvas \(QTI\)/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /CSV/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /JSON/ })).toBeVisible();
    await expectNoA11yViolations(page, { include: '.fixed.inset-0' });
  });

  test('seeded schedule edit dialog documents field-label violations', async ({
    page,
  }) => {
    await prepareSeededInstructorCourse(page);
    await page.goto('/quizzes');

    const quizCard = getQuizCard(page, SEED.QUIZ_NAME);
    await expect(quizCard).toBeVisible();

    await quizCard.getByRole('button', { name: /101\s+Active/ }).click();
    await expect(page.getByText('Edit section schedule')).toBeVisible();
    await expect(page.locator('input[type="datetime-local"]').first()).toBeVisible();
    await expect(page.locator('input[type="datetime-local"]').nth(1)).toBeVisible();

    // FINDINGS.md Accessibility: ScheduleModal date fields have visible labels
    // that are not programmatically associated with their inputs yet.
    await expectNoA11yViolations(page, {
      include: '.fixed.inset-0',
      disableRules: ['label'],
    });
  });

  test('populated question bank table documents filter-label violations', async ({
    page,
  }) => {
    await prepareSeededInstructorCourse(page);
    await page.goto('/question-bank');
    await page.getByLabel('Quiz').selectOption({ label: SEED.QUIZ_NAME });

    await expect(page.getByRole('button', { name: 'Questions' })).toBeVisible();
    await expect(page.getByText(/Michaelis constant|competitive inhibitor/i).first()).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Select all questions' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add New Question' })).toBeVisible();

    await page.getByRole('checkbox', { name: 'Select all questions' }).check();
    await expect(page.getByText(`${SEED.QUESTION_COUNT} questions selected`)).toBeVisible();
    await expect(page.getByRole('button', { name: /Approve$/ }).first()).toBeVisible();

    // FINDINGS.md Accessibility: QuestionBank filter selects/search input have
    // visible labels/placeholders but no programmatic names.
    await expectNoA11yViolations(page, { disableRules: ['label'] });
  });

  test('add-question wizard AI branch has no blocking axe violations', async ({
    page,
  }) => {
    await prepareSeededInstructorCourse(page);
    await page.goto('/question-bank');

    await page.getByRole('button', { name: 'Add New Question' }).click();
    await expect(
      page.getByRole('heading', { name: 'Select Question Type' })
    ).toBeVisible();
    // The wizard is a self-contained modal; scope scans to it so the page's
    // known filter-label findings don't mask regressions inside the wizard.
    await expectNoA11yViolations(page, { include: '.fixed.inset-0' });

    // Step 1 → 2: type, then objective + Bloom (labels are associated).
    await page.getByRole('button', { name: /Multiple Choice/ }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page
      .getByLabel('Meta Learning Objective')
      .selectOption({ label: SEED.OBJECTIVE_NAME });
    await page
      .getByLabel('Granular Learning Objective')
      .selectOption({ label: SEED.GRANULAR_NAME });
    await page.getByLabel("Bloom's Taxonomy Level").selectOption('Understand');
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 3: the manual-vs-AI source choice (new decision UI).
    await expect(
      page.getByRole('heading', { name: 'Choose How to Create' })
    ).toBeVisible();
    await expectNoA11yViolations(page, { include: '.fixed.inset-0' });

    // Step 4: the AI-drafted, editable Details fields.
    await page.getByRole('button', { name: /Generate with AI/ }).click();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.getByText('AI-drafted', { exact: false })).toBeVisible();
    await expectNoA11yViolations(page, { include: '.fixed.inset-0' });
  });
});
