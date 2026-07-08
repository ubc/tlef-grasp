const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  AUTH_DIR,
  FACULTY_AUTH_FILE,
  STAFF_AUTH_FILE,
  STUDENT_AUTH_FILE,
  BIO_PROF2_AUTH_FILE,
  BIO_STUDENT_AUTH_FILE,
  BIO_STUDENT3_AUTH_FILE,
} = require('./auth');
const { seedStudentJourneyCourse } = require('./seed');

const roles = [
  {
    label: 'faculty',
    username:
      process.env.E2E_FACULTY_USERNAME || process.env.E2E_USERNAME || 'faculty',
    password:
      process.env.E2E_FACULTY_PASSWORD || process.env.E2E_PASSWORD || 'faculty',
    storageState: FACULTY_AUTH_FILE,
  },
  {
    label: 'staff',
    username: process.env.E2E_STAFF_USERNAME || 'staff',
    password: process.env.E2E_STAFF_PASSWORD || 'staff',
    storageState: STAFF_AUTH_FILE,
  },
  {
    label: 'student',
    username: process.env.E2E_STUDENT_USERNAME || 'student',
    password: process.env.E2E_STUDENT_PASSWORD || 'student',
    storageState: STUDENT_AUTH_FILE,
  },
  {
    label: 'bio_prof2',
    username: process.env.E2E_BIO_PROF2_USERNAME || 'bio_prof2',
    password: process.env.E2E_BIO_PROF2_PASSWORD || 'bio_prof2',
    storageState: BIO_PROF2_AUTH_FILE,
  },
  {
    label: 'bio_student',
    username: process.env.E2E_BIO_STUDENT_USERNAME || 'bio_student',
    password: process.env.E2E_BIO_STUDENT_PASSWORD || 'bio_student',
    storageState: BIO_STUDENT_AUTH_FILE,
  },
  {
    label: 'bio_student3',
    username: process.env.E2E_BIO_STUDENT3_USERNAME || 'bio_student3',
    password: process.env.E2E_BIO_STUDENT3_PASSWORD || 'bio_student3',
    storageState: BIO_STUDENT3_AUTH_FILE,
  },
];

test('save SAML sessions and seed authenticated e2e data', async ({
  browser,
  baseURL,
}) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  for (const role of roles) {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();

    page.on('response', (res) => {
      const url = res.url();
      if (url.includes('/auth/saml/callback') || url.includes('/auth/ubcshib')) {
        console.log(
          `[saml-setup:${role.label}] ${res.status()} ${res.request().method()} ${url}`
        );
      }
    });

    try {
      await page.goto('/auth/ubcshib');
      await page.getByLabel('Login Name').fill(role.username);
      await page.getByLabel('Password').fill(role.password);
      await page.getByRole('button', { name: 'Login', exact: true }).click();

      await page.waitForURL(`${baseURL}/onboarding`, { timeout: 30_000 });
      await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();

      await context.storageState({ path: role.storageState });
    } catch (err) {
      const failurePath = path.join(
        'test-results',
        `saml-setup-${role.label}-failure.png`
      );
      try {
        fs.mkdirSync('test-results', { recursive: true });
        await page.screenshot({ path: failurePath, fullPage: true });
      } catch {
        // The page may already be closed or unusable.
      }
      throw err;
    } finally {
      await context.close();
    }
  }

  await seedStudentJourneyCourse();
});
