// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// GRASP is a single Express server that also serves the built React client from
// client/dist, so one port (8052 everywhere — see agents.e2e.md) covers the API,
// the SPA and the SAML endpoints.
const PORT = process.env.TLEF_GRASP_PORT || 8052;
const baseURL = `http://localhost:${PORT}`;

// SAML-authenticated specs are opt-in. They require the docker-simple-saml IdP
// running locally and are enabled with E2E_SAML=1, which wires in the login
// setup project (see tests/e2e/saml.setup.js). By default the suite runs only
// public / unauthenticated flows, which need no IdP and no stored session.
const useSaml = process.env.E2E_SAML === '1';

module.exports = defineConfig({
  testDir: './tests/e2e',

  // The suite shares login sessions and writes to a real database, so it runs
  // serially with a single worker — parallel workers make it flaky and
  // order-dependent.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },

  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    [
      'monocart-reporter',
      {
        name: 'GRASP Playwright E2E Report',
        outputFile: './monocart-report/index.html',
      },
    ],
  ],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Stop assertions racing CSS transitions (FINANCEBOT pattern).
    reducedMotion: 'reduce',
  },

  projects: useSaml
    ? [
        {
          name: 'saml-setup',
          testMatch: /.*\.setup\.js/,
          use: { ...devices['Desktop Chrome'] },
        },
        {
          name: 'chromium',
          dependencies: ['saml-setup'],
          testIgnore: /.*\.setup\.js/,
          use: { ...devices['Desktop Chrome'] },
        },
      ]
    : [
        {
          name: 'chromium',
          testIgnore: /.*\.setup\.js/,
          use: { ...devices['Desktop Chrome'] },
        },
      ],

  // Playwright boots the app itself in CI (build the client, start the server).
  // Locally, if `npm run dev` is already serving :8052 it reuses that server for
  // faster iteration.
  //
  // NOTE: the server runs with NODE_ENV=test, NOT production. In production
  // the session cookie is `secure` (session.js), which the browser refuses to
  // store over plain http://localhost — so the SAML session never persists and
  // every request 401s. Test mode keeps the cookie non-secure so authenticated
  // E2E works over http. See agents.e2e.md.
  //
  // start-server-with-stubs.js boots the same server with the LLM/RAG modules
  // swapped for in-memory test stubs (no live LLM / Qdrant — hard rule). If a
  // dev server is reused locally instead, LLM-touching specs would hit the
  // real provider — run the suite with :8052 free so Playwright boots this one.
  webServer: {
    command:
      'npm run build && cross-env NODE_ENV=test node tests/e2e/start-server-with-stubs.js',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
