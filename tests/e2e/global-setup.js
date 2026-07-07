const fs = require('fs');
const { chromium } = require('@playwright/test');
const { AUTH_DIR, FACULTY_AUTH_FILE } = require('./auth');

// Opt-in SAML login global-setup (enabled by E2E_SAML=1 in playwright.config.js).
//
// It drives the SP-initiated login through the LOCAL docker-simple-saml IdP
// once, then saves the resulting session as storage state so authenticated
// specs can `test.use({ storageState: FACULTY_AUTH_FILE })` without logging in
// again. It NEVER automates real CWL/SSO — only the local IdP's test users,
// whose credentials come from env vars (defaults match docker-simple-saml's
// `faculty`/`faculty`).
//
// The IdP's SimpleSAMLphp form exposes accessible fields labelled "Login Name"
// and "Password" with a submit button named "Login" (verified against the local
// docker-simple-saml IdP). Add per-role setup (staff/student) as those specs are
// added — see the "TODO: authenticated E2E" note in agents.e2e.md.
module.exports = async () => {
  const PORT = process.env.TLEF_GRASP_PORT || 8052;
  const baseURL = `http://localhost:${PORT}`;
  const username = process.env.E2E_USERNAME || 'faculty';
  const password = process.env.E2E_PASSWORD || 'faculty';

  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    // SP-initiated login → redirected to the IdP's SimpleSAMLphp form.
    await page.goto(`${baseURL}/auth/ubcshib`);

    await page.getByLabel('Login Name').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Login', exact: true }).click();

    // The SAML callback lands the user on /onboarding (see
    // src/controllers/auth.js callbackSuccess); wait until the session is really
    // live rather than trusting the redirect URL (the client bounces back to '/'
    // if the cookie didn't stick).
    await page.waitForURL(`${baseURL}/onboarding`, { timeout: 30_000 });
    await page.getByRole('button', { name: /sign out/i }).waitFor();

    await page.context().storageState({ path: FACULTY_AUTH_FILE });
  } finally {
    await browser.close();
  }
};
