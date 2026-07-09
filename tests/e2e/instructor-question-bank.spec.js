const { test, expect } = require('@playwright/test');
const { BIO_PROF2_AUTH_FILE } = require('./auth');
const { SEED } = require('./seed');
const { selectSeededCourse } = require('./helpers');

// Question Bank browsing for bio_prof2 against the seeded BIOC 302 course:
// the questions table, its search/status filters, single-question flagging,
// and the Learning Objectives tab. Bulk approval is exercised by the
// instructor journey; this spec covers the read/filter surface the journey
// skips. Opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';

test.describe('Instructor question bank (seeded course)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  test('lists the seeded questions as approved with their objective', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/question-bank');

    // The hardcoded notification bell was removed (issue #27); the instructor
    // sidebar keeps its Profile and Settings controls. Exact match targets the
    // round Settings icon (aria-label "Settings"), not the "  Settings" nav row.
    await expect(page.getByRole('button', { name: 'Notifications' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Profile' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Settings', exact: true })
    ).toBeVisible();

    for (const title of SEED.QUESTION_TITLES) {
      await expect(page.getByRole('cell', { name: title })).toBeVisible();
    }
    // Every seeded question is Approved. Cell-scoped so the identical entries
    // in the filter dropdowns don't match.
    await expect(page.getByRole('cell', { name: 'Approved' })).toHaveCount(
      SEED.QUESTION_COUNT + SEED.AI_QUESTION_COUNT
    );
    // The "Associated GLO" column shows the PARENT objective name, which the
    // backend derives from each question's granularObjectiveId
    // (getQuestionsByCourseId maps granular → parent), not the granular text.
    await expect(
      page.getByRole('cell', { name: SEED.OBJECTIVE_NAME })
    ).toHaveCount(SEED.QUESTION_COUNT + SEED.AI_QUESTION_COUNT);
  });

  test('search narrows the table to matching questions', async ({ page }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/question-bank');
    await expect(
      page.getByRole('cell', { name: SEED.QUESTION_TITLES[0] })
    ).toBeVisible();

    await page
      .getByPlaceholder('Search questions...')
      .fill('Michaelis constant');

    await expect(
      page.getByRole('cell', { name: SEED.QUESTION_TITLES[0] })
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: SEED.QUESTION_TITLES[1] })
    ).toBeHidden();
  });

  test('status filter hides questions of other statuses', async ({ page }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/question-bank');
    await expect(
      page.getByRole('cell', { name: SEED.QUESTION_TITLES[0] })
    ).toBeVisible();

    // All seeded questions are Approved, so filtering to Draft empties the table.
    await page.getByLabel('Status').selectOption('Draft');
    await expect(page.getByText('No questions available.')).toBeVisible();

    await page.getByLabel('Status').selectOption('Approved');
    await expect(
      page.getByRole('cell', { name: SEED.QUESTION_TITLES[0] })
    ).toBeVisible();
  });

  test('flags a question and finds it with the flagged-only filter', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/question-bank');

    // The row action buttons reveal on hover.
    const firstTitleCell = page.getByRole('cell', {
      name: SEED.QUESTION_TITLES[0],
    });
    await firstTitleCell.hover();
    // The button's accessible name carries the FontAwesome glyph as a prefix,
    // so match the end of the name. /Flag$/ (case-sensitive) hits "Flag" but
    // not "Unflag" (which ends in lowercase "flag").
    await firstTitleCell.getByRole('button', { name: /Flag$/ }).click();
    await expect(page.getByText('Question flagged successfully')).toBeVisible();

    // The flagged-only filter keeps just the flagged question.
    await page.getByRole('checkbox', { name: 'Show flagged only' }).check();
    await expect(firstTitleCell).toBeVisible();
    await expect(
      page.getByRole('cell', { name: SEED.QUESTION_TITLES[1] })
    ).toBeHidden();

    // Unflag to restore the seeded state; the filtered view empties.
    await firstTitleCell.hover();
    await firstTitleCell.getByRole('button', { name: /Unflag$/ }).click();
    await expect(
      page.getByText('Question unflagged successfully')
    ).toBeVisible();
    await expect(page.getByText('No questions available.')).toBeVisible();

    await page.getByRole('checkbox', { name: 'Show flagged only' }).uncheck();
    await expect(firstTitleCell).toBeVisible();
  });

  test('learning objectives tab shows the seeded objective hierarchy', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/question-bank');

    await page.getByRole('button', { name: 'Learning Objectives' }).click();

    await expect(
      page.getByRole('heading', { name: SEED.OBJECTIVE_NAME })
    ).toBeVisible();
    await expect(page.getByText(SEED.GRANULAR_NAME)).toBeVisible();
  });
});
