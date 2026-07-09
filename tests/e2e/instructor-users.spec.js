const { test, expect } = require('@playwright/test');
const { BIO_PROF2_AUTH_FILE } = require('./auth');
const { selectSeededCourse } = require('./helpers');

// Course Users page for bio_prof2 against the seeded BIOC 302 course: the
// member table (instructor + the two seeded students), the section filter,
// and the remove-user confirmation modal (cancelled — this suite never
// actually removes a seeded member). Opt-in (E2E_SAML=1).
//
// How a member's name renders depends on DB state: passport's fallback is the
// email (no displayName attribute on the local IdP personas), but a roster
// sync can enrich a student's name to their IdP givenName + surname. A clean
// CI DB shows emails; a locally-synced DB shows "Bruno/Bennett Student". So the
// student rows are matched by a regex accepting EITHER rendering, and the
// instructor (never part of a synced roster) stays on the email.
const PROF_NAME = 'bio_prof2@ubc.ca';
const STUDENT_ROW = /bio_student@student\.ubc\.ca|Bruno Student/;
const STUDENT3_ROW = /bio_student3@student\.ubc\.ca|Bennett Student/;

const IDP_ENABLED = process.env.E2E_SAML === '1';

test.describe('Instructor course users (seeded course)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  test('lists the seeded members with roles and marks the current user', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/users');

    await expect(page.getByRole('heading', { name: 'Course Users' })).toBeVisible();

    // exact text matches: the role badge is exactly "Faculty"/"Student", while
    // the name cells contain "student" as a substring — exact avoids matching
    // those.
    const profRow = page.getByRole('row').filter({ hasText: PROF_NAME });
    await expect(profRow.getByText('You', { exact: true })).toBeVisible();
    await expect(profRow.getByText('Faculty', { exact: true })).toBeVisible();

    for (const student of [STUDENT_ROW, STUDENT3_ROW]) {
      const row = page.getByRole('row').filter({ hasText: student });
      await expect(row.getByText('Student', { exact: true })).toBeVisible();
      // The seeded students are enrolled in section 101.
      await expect(row.getByText('101', { exact: true })).toBeVisible();
    }
  });

  test('section filter scopes the list to enrolled students', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/users');
    await expect(page.getByRole('row').filter({ hasText: PROF_NAME })).toBeVisible();

    // Filter to section 101: both students stay, the instructor (who has no
    // section membership) drops out.
    await page.getByLabel('Section:').selectOption({ label: '101' });
    await expect(
      page.getByRole('row').filter({ hasText: STUDENT_ROW })
    ).toBeVisible();
    await expect(
      page.getByRole('row').filter({ hasText: STUDENT3_ROW })
    ).toBeVisible();
    await expect(
      page.getByRole('row').filter({ hasText: PROF_NAME })
    ).toBeHidden();

    await page.getByLabel('Section:').selectOption({ label: 'All Sections' });
    await expect(
      page.getByRole('row').filter({ hasText: PROF_NAME })
    ).toBeVisible();
  });

  test('cancelling the remove-user dialog keeps the member', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/users');

    const studentRow = page.getByRole('row').filter({ hasText: STUDENT_ROW });
    await studentRow.getByRole('button', { name: 'Remove' }).click();

    await expect(
      page.getByRole('heading', { name: 'Remove User from Course' })
    ).toBeVisible();
    // The confirm message names the member (email or synced name); assert only
    // the stable prefix so the test is independent of that rendering.
    await expect(
      page.getByText(/Are you sure you want to remove/)
    ).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(
      page.getByRole('heading', { name: 'Remove User from Course' })
    ).toBeHidden();
    await expect(studentRow).toBeVisible();
  });
});
