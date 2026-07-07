const fs = require('fs');
const path = require('path');
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

  // global-setup runs outside Playwright's fixtures, so there is no automatic
  // trace/screenshot on failure. Log the SAML endpoints' status codes so a
  // CI-only failure is diagnosable: a failed assertion makes passport respond
  // 401 at /auth/saml/callback, which otherwise just looks like a nav timeout.
  page.on('response', (res) => {
    const u = res.url();
    if (u.includes('/auth/saml/callback') || u.includes('/auth/ubcshib')) {
      console.log(`[global-setup] ${res.status()} ${res.request().method()} ${u}`);
    }
  });

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
  } catch (err) {
    // Capture where the login actually ended up. final URL still on the IdP
    // (:8080) → credentials/login rejected; on /auth/saml/callback → SAML
    // assertion rejected (401); back on '/' → session cookie didn't stick.
    const resultsDir = 'test-results';
    fs.mkdirSync(resultsDir, { recursive: true });
    let bodyText = '';
    try {
      await page.screenshot({
        path: path.join(resultsDir, 'global-setup-failure.png'),
        fullPage: true,
      });
      bodyText = (await page.locator('body').innerText()).slice(0, 800);
    } catch { /* page may be in a bad state */ }
    console.error('[global-setup] SAML login failed to reach /onboarding.');
    console.error('[global-setup] final URL :', page.url());
    console.error('[global-setup] page text:', bodyText.replace(/\s+/g, ' ').trim());
    throw err;
  } finally {
    await browser.close();
  }
};
