const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { BIO_PROF2_AUTH_FILE, BIO_STUDENT_AUTH_FILE } = require('./auth');
const { SEED, getPersonaUser, seedGradeCsvQuizzes, removeGradeCsvQuizzes } = require('./seed');
const { selectSeededCourse } = require('./helpers');

// Grade CSV for Canvas's gradebook import (#126), on two quizzes this spec
// seeds and removes: one closed, where bio_student scored and bio_student3
// didn't, and one that hasn't opened. The instructor picks quizzes in the
// dialog and downloads the file; a TA (bio_student3, promoted for the test and
// demoted after) and a student are refused. The local `staff` login is not
// used: its PUID is an app administrator in .env, and admins may export.
// Opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';
const BASE_URL = `http://localhost:${process.env.TLEF_GRASP_PORT || 8052}`;

// Enough of RFC 4180 for this file: quoted fields with doubled quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') continue;
    else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  return rows;
}

async function expectRefused(api, courseId) {
  const query = `sectionId=${SEED.SECTION_ID}`;
  expect((await api.get(`/api/quiz/course/${courseId}/grade-export?${query}`)).status()).toBe(403);
  expect((await api.get(`/api/quiz/course/${courseId}/grade-export/csv?${query}&quizIds=x`)).status()).toBe(403);
}

test.describe('Grade CSV', () => {
  test.skip(!IDP_ENABLED, 'Set E2E_SAML=1 to run against the local SAML IdP');
  test.describe.configure({ mode: 'serial' });

  let courseId = null;
  test.beforeAll(async () => {
    ({ courseId } = await seedGradeCsvQuizzes());
  });
  test.afterAll(async () => {
    await removeGradeCsvQuizzes();
  });

  test.describe('instructor', () => {
    test.use({ storageState: BIO_PROF2_AUTH_FILE });

    test('downloads the chosen quizzes with PUIDs, 0 for a closed quiz missed, blank for one not open', async ({ page }) => {
      await selectSeededCourse(page, { role: 'instructor' });
      await page.goto('/quiz-scores');
      await page.getByRole('button', { name: 'Download grades (CSV)' }).click();

      const dialog = page.getByRole('dialog', { name: 'Download grades (CSV)' });
      await expect(dialog).toBeVisible();
      const closedBox = dialog.getByRole('checkbox', { name: SEED.GRADE_CSV_CLOSED_QUIZ_NAME, exact: true });
      const upcomingBox = dialog.getByRole('checkbox', { name: SEED.GRADE_CSV_UPCOMING_QUIZ_NAME, exact: true });
      await expect(closedBox).toBeChecked();
      await expect(closedBox).toHaveAccessibleDescription(/^Closed /);
      await expect(upcomingBox).toHaveAccessibleDescription(/^Opens /);

      // "All quizzes" clears every tick, then just the two seeded ones go back.
      const allBox = dialog.getByRole('checkbox', { name: 'All quizzes' });
      await expect(allBox).toBeChecked();
      await allBox.uncheck();
      await expect(dialog.getByRole('button', { name: 'Download CSV' })).toBeDisabled();
      await closedBox.check();
      await upcomingBox.check();

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        dialog.getByRole('button', { name: 'Download CSV' }).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/^grasp-grades-E2E-BIOC-302-101-\d{4}-\d{2}-\d{2}\.csv$/);

      const text = fs.readFileSync(await download.path(), 'utf8');
      expect(text.charCodeAt(0)).toBe(0xfeff);
      const [header, points, ...students] = parseCsv(text.slice(1));
      expect(header).toEqual([
        'Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Integration ID', 'Section',
        `GRASP: ${SEED.GRADE_CSV_CLOSED_QUIZ_NAME}`,
        `GRASP: ${SEED.GRADE_CSV_UPCOMING_QUIZ_NAME}`,
        'GRASP: Average',
      ]);
      expect(points).toEqual(['Points Possible', '', '', '', '', '', '100', '100', '100']);

      const byPuid = (puid) => students.find((row) => row[4] === puid);
      const score = String(SEED.GRADE_CSV_SCORE);
      expect(byPuid(SEED.BIO_STUDENT_PUID).slice(5)).toEqual(['101', score, '', score]);
      expect(byPuid(SEED.BIO_STUDENT3_PUID).slice(5)).toEqual(['101', '0', '', '0']);
      // Instructors are never rows.
      expect(byPuid(SEED.BIO_PROF2_PUID)).toBeUndefined();

      // Opt-in: a read-only "(correct)" column after each quiz.
      const questionsCorrect = dialog.getByRole('checkbox', { name: 'Include questions correct' });
      await expect(questionsCorrect).not.toBeChecked();
      await questionsCorrect.check();
      const [second] = await Promise.all([
        page.waitForEvent('download'),
        dialog.getByRole('button', { name: 'Download CSV' }).click(),
      ]);
      const [header2, points2, ...students2] = parseCsv(
        fs.readFileSync(await second.path(), 'utf8').slice(1)
      );
      expect(header2.slice(6)).toEqual([
        `GRASP: ${SEED.GRADE_CSV_CLOSED_QUIZ_NAME}`,
        `GRASP: ${SEED.GRADE_CSV_CLOSED_QUIZ_NAME} (correct)`,
        `GRASP: ${SEED.GRADE_CSV_UPCOMING_QUIZ_NAME}`,
        `GRASP: ${SEED.GRADE_CSV_UPCOMING_QUIZ_NAME} (correct)`,
        'GRASP: Average',
      ]);
      expect(points2.slice(6)).toEqual(['100', '(read only)', '100', '(read only)', '100']);
      const bruno = students2.find((row) => row[4] === SEED.BIO_STUDENT_PUID);
      expect(bruno.slice(6)).toEqual([score, '4 of 5', '', '', score]);
    });
  });

  test('refuses a student', async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: BASE_URL, storageState: BIO_STUDENT_AUTH_FILE });
    try {
      await expectRefused(api, courseId);
    } finally {
      await api.dispose();
    }
  });

  test('refuses a TA and shows them no download button', async ({ browser, playwright }) => {
    const instructor = await playwright.request.newContext({ baseURL: BASE_URL, storageState: BIO_PROF2_AUTH_FILE });
    const student3 = await getPersonaUser(SEED.BIO_STUDENT3_PUID);
    const promotion = await instructor.post(`/api/users/course/${courseId}/promote`, {
      data: { userId: student3._id },
    });
    expect(promotion.ok(), `promoting bio_student3 to TA (HTTP ${promotion.status()})`).toBe(true);

    // Promotion applies on the TA's next login, so sign in fresh.
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    try {
      await page.goto('/auth/ubcshib');
      await page.getByLabel('Login Name').fill('bio_student3');
      await page.getByLabel('Password').fill('bio_student3');
      await Promise.all([
        page.waitForURL(/\/onboarding(?:\?.*)?$/i, { timeout: 30_000 }),
        page.getByRole('button', { name: 'Login', exact: true }).click(),
      ]);

      await expectRefused(page.request, courseId);

      await selectSeededCourse(page, { role: 'instructor' });
      await page.goto('/quiz-scores');
      await expect(page.getByRole('heading', { name: 'Quiz Scores' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Download grades (CSV)' })).toHaveCount(0);
    } finally {
      await context.close();
      const demotion = await instructor.post(`/api/users/course/${courseId}/demote`, {
        data: { userId: student3._id },
      });
      expect(demotion.ok(), 'demoting bio_student3 again').toBe(true);
      await instructor.dispose();
    }
  });
});
