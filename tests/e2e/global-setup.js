const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
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

// Opt-in SAML login global-setup (enabled by E2E_SAML=1 in playwright.config.js).
//
// It drives the SP-initiated login through the LOCAL docker-simple-saml IdP
// once per role, then saves the resulting sessions as storage state so
// authenticated specs can `test.use({ storageState })` without logging in again.
// It NEVER automates real CWL/SSO — only the local IdP's test users, whose
// credentials come from env vars (defaults match docker-simple-saml's
// `faculty`/`faculty`, `staff`/`staff`, and `student`/`student`).
//
// The IdP's SimpleSAMLphp form exposes accessible fields labelled "Login Name"
// and "Password" with a submit button named "Login" (verified against the local
// docker-simple-saml IdP).
module.exports = async () => {
  const PORT = process.env.TLEF_GRASP_PORT || 8052;
  const baseURL = `http://localhost:${PORT}`;
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
    // Named personas (docker-simple-saml + FakeAcademicAPI seed, password ==
    // login) for the instructor/student journey specs: bio_prof2 drives the
    // full course setup, bio_student takes the seeded BIOC 302 quiz, and
    // bio_student3 is enrolled in bio_prof2's BIOC 410.
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

  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const role of roles) {
      const context = await browser.newContext();
      const page = await context.newPage();

      // global-setup runs outside Playwright's fixtures, so there is no
      // automatic trace/screenshot on failure. Log the SAML endpoints' status
      // codes so a CI-only failure is diagnosable.
      page.on('response', (res) => {
        const u = res.url();
        if (u.includes('/auth/saml/callback') || u.includes('/auth/ubcshib')) {
          console.log(
            `[global-setup:${role.label}] ${res.status()} ${res.request().method()} ${u}`
          );
        }
      });

      try {
        // SP-initiated login → redirected to the IdP's SimpleSAMLphp form.
        await page.goto(`${baseURL}/auth/ubcshib`);

        await page.getByLabel('Login Name').fill(role.username);
        await page.getByLabel('Password').fill(role.password);
        await page.getByRole('button', { name: 'Login', exact: true }).click();

        // The SAML callback lands the user on /onboarding (see
        // src/controllers/auth.js callbackSuccess); wait until the session is
        // really live rather than trusting the redirect URL.
        await page.waitForURL(`${baseURL}/onboarding`, { timeout: 30_000 });
        await page.getByRole('button', { name: /sign out/i }).waitFor();

        await context.storageState({ path: role.storageState });
      } catch (err) {
        // Capture where the login actually ended up. final URL still on the IdP
        // (:8080) → credentials/login rejected; on /auth/saml/callback → SAML
        // assertion rejected (401); back on '/' → session cookie didn't stick.
        const resultsDir = 'test-results';
        fs.mkdirSync(resultsDir, { recursive: true });
        let bodyText = '';
        try {
          await page.screenshot({
            path: path.join(resultsDir, `global-setup-${role.label}-failure.png`),
            fullPage: true,
          });
          bodyText = (await page.locator('body').innerText()).slice(0, 800);
        } catch { /* page may be in a bad state */ }
        console.error(
          `[global-setup:${role.label}] SAML login failed to reach /onboarding.`
        );
        console.error(`[global-setup:${role.label}] final URL :`, page.url());
        console.error(
          `[global-setup:${role.label}] page text:`,
          bodyText.replace(/\s+/g, ' ').trim()
        );
        throw err;
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  // Logging in created the bio_* user records; now seed the shared BIOC 302
  // course (approved questions + a published, currently-open quiz) that the
  // student journey spec consumes without re-creating it per test.
  await seedStudentJourneyCourse();
};
