const { test, expect } = require('@playwright/test');
const { BIO_PROF2_AUTH_FILE } = require('./auth');
const { selectSeededCourse } = require('./helpers');

// Course Users page for bio_prof2 against the seeded BIOC 302 course: the
// member table (instructor + the two seeded students), the section filter,
// and the remove-user confirmation modal (cancelled — this suite never
// actually removes a seeded member). Opt-in (E2E_SAML=1).
//
// The owner (bio_prof2) renders by the email passport derives when no
// displayName attribute is present. The enrolled students render by their
// IdP givenName + surname (Bruno/Bennett Student) — the names the course-users
// view shows. Both are fixed in the local IdP config, so they're stable.
const PROF_NAME = 'bio_prof2@ubc.ca';
const STUDENT_NAME = 'Bruno Student';
const STUDENT3_NAME = 'Bennett Student';

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

    // exact text matches: the students' emails contain "student" as a
    // substring, which a non-exact match would also hit.
    const profRow = page.getByRole('row').filter({ hasText: PROF_NAME });
    await expect(profRow.getByText('You', { exact: true })).toBeVisible();
    await expect(profRow.getByText('Faculty', { exact: true })).toBeVisible();

    for (const student of [STUDENT_NAME, STUDENT3_NAME]) {
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
      page.getByRole('row').filter({ hasText: STUDENT_NAME })
    ).toBeVisible();
    await expect(
      page.getByRole('row').filter({ hasText: STUDENT3_NAME })
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

    const studentRow = page.getByRole('row').filter({ hasText: STUDENT_NAME });
    await studentRow.getByRole('button', { name: 'Remove' }).click();

    await expect(
      page.getByRole('heading', { name: 'Remove User from Course' })
    ).toBeVisible();
    await expect(
      page.getByText(`Are you sure you want to remove ${STUDENT_NAME}`)
    ).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(
      page.getByRole('heading', { name: 'Remove User from Course' })
    ).toBeHidden();
    await expect(studentRow).toBeVisible();
  });
});
