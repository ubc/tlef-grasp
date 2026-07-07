# agents.e2e.md — Playwright E2E testing (with Monocart reporting)

Instructions for coding agents adding or maintaining **end-to-end browser tests** in
this repository. The blueprint is [`tlef-financebot`](https://github.com/ubc/tlef-financebot)
(structure, configs, auth pattern) with the Monocart reporter setup taken from
[`tlef-biocbot`](https://github.com/ubc/tlef-biocbot). Adapt, don't copy: GRASP is a
CommonJS Express server (`src/`) serving a built React 18 + Vite client (`client/dist`),
not FINANCEBOT's TypeScript skeleton or BIOCBOT's server-rendered pages.

## Purpose of this layer

E2E tests drive the **real app in a real browser** and validate **user-visible
behaviour**: an instructor can log in, create a course, upload materials, generate and
review questions, publish a quiz; a student can take that quiz and see their score.
They are the only layer that exercises the React client, the Express API, MongoDB, and
the session/auth stack together. They do **not** re-test pure logic (that's
`agents.unit.md`) and they do **not** run axe scans (that's `agents.a11y.md`).

> **Cypress is gone — don't bring it back.** The repo previously had a Cypress suite
> (`client/cypress/`) that ran against the Vite dev server with the entire backend
> stubbed via `cy.intercept`; it was removed in favour of this Playwright layer. Do
> not reintroduce Cypress, and do not recreate its stub-everything style in
> Playwright — a Playwright test that intercepts every API call tests nothing real.
> Playwright against the real server + DB is the only browser-test layer.

## Where tests live & naming

```
tests/
  e2e/
    global-setup.js        # logs in once via SAML, saves storage state per role
    .auth/                 # saved sessions (git-ignored)
    landing.spec.js        # logged-out flows
    instructor-quizzes.spec.js
    student-quiz.spec.js
playwright.config.js       # repo root
```

- Directory: `tests/e2e/` at the **repo root** (same as FINANCEBOT/BIOCBOT). Root-level
  because the suite spans server + client; do not put it under `client/`.
- Naming: `<area>.spec.js`, kebab-case, one user-facing area per file
  (`instructor-question-bank.spec.js`, not `test1.spec.js`). Prefix by role when the
  file is role-specific (`instructor-…`, `student-…`), matching BIOCBOT's convention.
- Tests are plain JavaScript (CommonJS or ESM per Playwright default) — this repo is
  not TypeScript; do not introduce ts-jest/tsx just for tests.

## Required tooling

Add to the **root** `package.json` (devDependencies):

- `@playwright/test`
- `monocart-reporter` (E2E HTML report; BIOCBOT pattern)
- `cross-env` (already present)

Scripts to add (FINANCEBOT naming):

```json
"test:e2e": "playwright test",
"test:e2e:headed": "playwright test --headed",
"test:ui": "playwright test --ui",
"test:report": "playwright show-report"
```

## Playwright config (create `playwright.config.js` at repo root)

Follow FINANCEBOT's config, adjusted for GRASP:

- `testDir: './tests/e2e'`
- `baseURL`: `http://localhost:${process.env.TLEF_GRASP_PORT || 8052}` — the Express
  server serves the built client from `client/dist`, so **one port covers everything**.
- `webServer`: `command: 'npm run build && npm start'`, `reuseExistingServer: !process.env.CI`
  (locally it reuses a running `npm run dev`), `timeout: 120_000`.
- `fullyParallel: false`, `workers: 1` — the suite shares login sessions and writes to a
  real database; parallel workers make tests flaky and order-dependent.
- `retries: process.env.CI ? 2 : 0`, `trace: 'retain-on-failure'`,
  `screenshot: 'only-on-failure'`, `video: 'retain-on-failure'`.
- `reducedMotion: 'reduce'` in `use` (FINANCEBOT does this to stop assertions racing
  CSS transitions).
- Single project: chromium / Desktop Chrome. Add more browsers only if a real
  cross-browser bug motivates it.
- Reporters:

```js
reporter: [
  ['html', { open: 'never' }],
  ['list'],
  ['monocart-reporter', {
    name: 'GRASP Playwright E2E Report',
    outputFile: './monocart-report/index.html',
    json: true,
  }],
],
```

BIOCBOT additionally wires V8 **coverage collection** into monocart-reporter
(`coverage: { … }` with `entryFilter`/`sourceFilter` over `src/` and the client
bundle). That is optional here and non-trivial with a Vite-bundled client (needs
source maps); add it later if E2E coverage numbers become a goal — don't block the
first tests on it.

Git-ignore: `playwright-report/`, `monocart-report/`, `test-results/`, `tests/e2e/.auth/`.

## Authentication, test data, environment

- **Login is real SAML** (passport-ubcshib → the `docker-simple-saml` IdP on :8080).
  There is no dev bypass in `src/middleware/passport.js`. Follow FINANCEBOT's
  `tests/e2e/global-setup.js`: drive the SP-initiated login (`/auth/…` → the
  SimpleSAMLphp form → back to the app) once per role, save storage state to
  `tests/e2e/.auth/<role>.json`. GRASP has three roles (`faculty`, `staff`,
  `student` — see `src/utils/auth.js`); save one state per role you need.
- Logged-out specs use the default context (no `storageState`). Logged-in specs opt in
  at the top of the file: `test.use({ storageState: FACULTY_AUTH_FILE })`.
- Credentials come from env vars (`E2E_USERNAME` / `E2E_PASSWORD` style, with the local
  IdP's defaults as fallbacks). **Never hard-code real CWL credentials**; the local IdP
  users (`faculty`/`faculty` etc.) are the only ones tests may embed as defaults.
- Prerequisites locally: MongoDB (:27017) and the SAML IdP (:8080) running, SAML certs
  configured in `.env` (see `.env.example`). The UBC academic API should run in mock
  mode (`UBC_API_USE_MOCK=true` against the fake on :3689) or the relevant flows should
  be exercised with seeded data — never hit the real UBC API from tests.
- **No real AI calls, ever — hard rule.** Qdrant/Ollama/OpenAI are **not** E2E
  dependencies. Before writing any test that touches an LLM/RAG flow (question
  generation, RAG chat), an app-level stub flag **must** be added to GRASP (e.g.
  `GRASP_TEST_LLM_STUB=1` honoured by `src/services/llm.js` / `rag.js`, mirroring
  BIOCBOT's `BIOCBOT_TEST_LLM_STUB`), set on the Playwright `webServer` command so it
  never leaks into production config. A test that hits a live LLM is nondeterministic,
  slow, and costs money — reject it in review regardless of what it asserts.
- **Test data**: tests that create data (courses, quizzes, questions) must create their
  own uniquely-named records (e.g. suffix with `Date.now()`) and not depend on records
  another test created. Clean up in the test or tolerate leftovers — but never assert
  on global counts that leftovers would break.

## What to test (priority order)

1. **The login flow itself** (`auth.spec.js`) — the SAML round-trip must be a
   first-class spec, not just plumbing hidden in global-setup: a logged-out user
   clicks the app's login entry point, is redirected to the IdP (the CWL stand-in),
   submits credentials on the SimpleSAMLphp form, lands back in the app
   authenticated with the right name/role visible; a wrong password stays on the IdP
   form; logout ends the session (a subsequent protected-page visit redirects to
   login again). Global-setup *reuses* a saved session for the other specs, but this
   spec proves the journey works.
2. **Auth gating**: logged-out user landing on a protected page is sent to login;
   student cannot reach instructor pages (`/users`, question generation); role-scoped
   nav renders correctly.
3. **Core instructor loop**: onboarding/setup wizard → course + section creation →
   material upload → objectives → question review/bank → quiz assembly + scheduling.
4. **Core student loop**: student dashboard → take a quiz (`StudentQuiz`) → answers are
   accepted/validated → score appears in quiz scores/achievements.
5. **Error states**: invalid form submissions show validation messages; API failures
   surface a user-visible error, not a blank page.
6. Everything else (settings, users admin, co-instructor permissions) after the above.

## Selectors

- Prefer accessible, user-facing locators in this order: `getByRole` (with `name:`),
  `getByLabel`, `getByPlaceholder`, `getByText`. This doubles as a cheap accessibility
  check — if `getByRole('button', { name: 'Save' })` can't find it, a screen reader
  can't either.
- `data-testid` is the fallback for genuinely unnameable elements; add the attribute to
  the component rather than reaching for CSS.
- **Never** use long CSS chains (`div.card > div:nth-child(2) span`), auto-generated
  class names (Tailwind utility soup), or XPath. These break on every refactor without
  the feature breaking.

## Keeping tests independent and deterministic

- Each `test()` must pass when run alone (`npx playwright test -g "title"`), in any
  order within its file. Shared login state is fine; shared *data* state is not.
- Use Playwright's auto-waiting assertions (`await expect(locator).toBeVisible()`),
  never `page.waitForTimeout()`. If you need a timeout, the selector or the app is
  wrong.
- No conditionals on page state (`if (await x.isVisible())`) — a test that branches is
  a test that silently stops asserting.
- Avoid screenshot/visual snapshots unless a layout regression is the actual thing
  being protected (e.g. KaTeX/SMILES rendering). Text and role assertions are cheaper
  and less brittle.

## Running locally

```bash
# prerequisites: MongoDB + SAML IdP up, .env configured, browsers installed once:
npx playwright install chromium

npm run test:e2e          # headless, builds + starts the app itself
npm run test:e2e:headed   # visible browser
npm run test:ui           # Playwright UI mode
npm run test:report       # open last HTML report; monocart-report/index.html also exists
```

With `npm run dev` already running on :8052, Playwright reuses it (faster iteration).

## GitHub Actions

E2E gets its **own workflow**, `.github/workflows/e2e-tests.yml`, separate from unit
and a11y (model: BIOCBOT's `playwright.yml`). It must be independently runnable
(`workflow_dispatch`) and must not gate local development.

- Runner: `ubuntu-latest`, Node 20, `timeout-minutes: 30`.
- Services: `mongo:7` (with healthcheck). **Qdrant is not needed** — LLM/RAG is always
  stubbed (see above).
- **SAML in CI**: locally the SimpleSAMLphp IdP simulates the live CWL workpath and
  the tests log in through it for real — keep that in CI. The IdP is public:
  [ubc/docker-simple-saml](https://github.com/ubc/docker-simple-saml) ships the test
  users (`authsources.php`) and the SP registrations (`saml20-sp-remote.php`), so the
  workflow clones it **outside the checkout** (a sibling dir on the runner) and runs
  `docker compose up -d --build` as an extra step — nothing IdP-related is committed
  to this repo, and CI always tests against the current IdP. Keep the cloned ref in a
  single workflow env var (`IDP_REF: main`) so a breaking upstream change can be
  pinned to a known-good SHA in a one-line edit. After `compose up`, poll the IdP's
  metadata endpoint until it responds (BIOCBOT's "Wait for Qdrant" pattern), then
  fetch the signing cert from that metadata before booting GRASP (port an equivalent
  of FINANCEBOT's `npm run saml:fetch-cert` script) — never commit a cert. Note the
  IdP's own port in CI is whatever the **upstream** compose publishes (its README
  says :6122); set `SAML_ENTRY_POINT` to match the upstream compose file. **Port**:
  GRASP runs on **:8052 everywhere** — local and CI — because that is the port
  registered for `https://tlef-grasp` in the public IdP config (ACS
  `http://localhost:8052/auth/saml/callback`). Never move GRASP to a port that isn't
  registered upstream in `saml20-sp-remote.php`; the env vars (`TLEF_GRASP_PORT`,
  `SAML_ISSUER`, `SAML_CALLBACK_URL`) and Playwright's baseURL all follow the port.
  Do not copy BIOCBOT's approach here: BIOCBOT's e2e suite never touches SAML — it
  logs in through its separate `local` passport strategy (register/login API) — but
  GRASP is SAML-only, and adding a test-only auth door is a last resort, not the
  plan. Never skip auth-gated tests to get a green check.
- Steps: checkout → setup-node → `npm install` (root **and** `client/`) —
  `package-lock.json` is git-ignored in this repo (same as BIOCBOT), so `npm ci` is
  not available → `npx playwright install --with-deps chromium` → `npm run test:e2e`.
- Artifacts (all `if: ${{ !cancelled() }}` except traces, `retention-days: 14`):
  - `playwright-report/` (HTML report)
  - `monocart-report/` (Monocart report — **required artifact**)
  - `test-results/` (traces/videos/screenshots) — `if: failure()`

## Current implementation status

The Playwright foundation is in place, including a working SAML-authenticated
layer. What exists today:

- **Config**: `playwright.config.js` (repo root) — `testDir: ./tests/e2e`, single
  chromium project, `workers: 1` / `fullyParallel: false`, `baseURL`
  `http://localhost:${TLEF_GRASP_PORT || 8052}`,
  `webServer: 'npm run build && npm run start:test'` with `reuseExistingServer: !CI`,
  `trace/screenshot/video` on failure, `reducedMotion: 'reduce'`. Reporters:
  `list` + `html` + `monocart-reporter` (→ `monocart-report/index.html`, also
  emits `index.json`).
- **Scripts** (root `package.json`): `start:test` (runs the server with
  `NODE_ENV=test` — see the cookie finding below), `test:e2e`, `test:e2e:headed`,
  `test:ui`, `test:report`.
- **Public specs** (always run): `tests/e2e/landing.spec.js` — logged-out landing
  shows the `Welcome to GRASP` heading and a `Log in with CWL` link → `/auth/ubcshib`;
  a deep-link to `/dashboard` while logged out is bounced back to the landing page.
- **Authenticated specs** (opt-in, `E2E_SAML=1`; skipped otherwise):
  - `tests/e2e/auth.spec.js` — the SAML round-trip (priority #1): logged-out user
    clicks the CWL link, submits `faculty`/`faculty` on the SimpleSAMLphp form,
    lands back authenticated (Sign Out control + faculty-only "New Course Setup"
    tab visible); a wrong password keeps them on the IdP form.
  - `tests/e2e/faculty-onboarding.spec.js` — demonstrates the storage-state
    pattern (`test.use({ storageState: FACULTY_AUTH_FILE })`) reusing the session
    saved by global-setup.
- **Auth wiring**: `tests/e2e/auth.js` (per-role storage-state paths) and
  `tests/e2e/global-setup.js` (logs in once as faculty via the local IdP, saves
  `tests/e2e/.auth/faculty.json`). Global-setup is wired in only when `E2E_SAML=1`.
- **CI**: `.github/workflows/e2e-tests.yml` runs the **full** suite against a real
  IdP (`E2E_SAML=1`). It clones [ubc/docker-simple-saml](https://github.com/ubc/docker-simple-saml)
  (pinned via `IDP_REF`, default `main`) into a sibling dir on the runner, brings
  it up with `docker compose up -d --build`, and **republishes it on :8080** via a
  compose override (upstream publishes `6122:80`, but `passport-ubcshib` LOCAL
  targets `http://localhost:8080`). It polls the IdP metadata endpoint until
  ready, then **`chmod 0644`s the IdP's `cert/server.pem`** inside the container:
  its `startup.sh` writes the key as root mode `0600`, but SimpleSAMLphp runs as
  `www-data` and otherwise can't read it, so assertion signing 500s ("Unable to
  load private key") and login never completes — this only surfaces on a real
  Linux runner, since Docker Desktop/macOS bind mounts ignore uid/perms. The IdP
  certs are **git-ignored**, so the container generates a fresh keypair into the
  bind-mounted `cert/` dir; `SAML_CERT_PATH` points at that generated
  `cert/server.crt` (GRASP reads it at boot, which happens later). Runs a mongo:7
  service and `UBC_API_USE_MOCK=true`, then lets Playwright boot GRASP and log in
  for real. `global-setup.js` logs the SAML endpoint status codes and, on
  failure, dumps the final URL + page text + a screenshot to `test-results/`.
  `origin/main` of the IdP repo carries the `faculty:faculty` test user and the
  `tlef-grasp`→`:8052` SP registration. Uploads `playwright-report/` and
  `monocart-report/` always, `test-results/` on failure, and dumps IdP logs on
  failure.

Runs verified locally: `E2E_SAML=1 npx playwright test` → 5 passed (incl. the real
SAML round-trip); `npx playwright test` (no IdP) → 2 passed, 3 skipped.

### Repo-specific findings

- **The E2E server must run in test mode, not production.** The session cookie is
  `secure: NODE_ENV === 'production'` (`src/middleware/session.js`). Under the
  original `npm start` (production) the browser silently refuses to store
  `grasp.sid` over plain `http://localhost`, so the SAML callback 302s to
  `/onboarding` but the session never persists → `/api/current-user` 401s → the
  client bounces back to `/`. Hence `start:test` (`NODE_ENV=test`, cookie
  non-secure) in the `webServer` command. `NODE_ENV` is only read in two places
  (this cookie flag and a comment in `src/utils/llm-provider.js` — LLM provider
  selection is deliberately independent of it), so test mode is otherwise inert.
- **IdP login form (docker-simple-saml)**: fields are labelled `Login Name` and
  `Password`; the submit control is a button named `Login` (there is also a
  non-submit "UBC Search" button — use `{ name: 'Login', exact: true }`). SP-init
  login (`/auth/ubcshib`) redirects to `http://localhost:8080/...` (the IdP port;
  `SAML_ENVIRONMENT=LOCAL` in `passport-ubcshib` supplies the entryPoint — the
  `SAML_ENTRY_POINT`/`SAML_*_URL` lines in `.env` are unused placeholders marked
  "NOT THE SAME").
- **Faculty test user** resolves to `displayName: faculty@ubc.ca`,
  `affiliation: faculty`, `puid: 12345678`, `role: faculty`.
- **Stable authenticated selectors on `/onboarding`**: the `Sign Out` button
  (rendered for any authenticated user) and the faculty-only `New Course Setup` /
  `Join a course` tabs. The onboarding *heading* is NOT stable — it's
  `Welcome Back` (returning user with courses) or `Welcome to GRASP!` (setup
  wizard, no courses) depending on DB state; don't assert on it.
- **Protected routes are client-guarded, not server 302s.** The Express SPA
  fallback serves `index.html` for any non-`/api`/`/auth` GET; the React
  `RequireAuth` guard then redirects logged-out users to `/`. Assert the **client
  URL** ends at `/`, not an HTTP status. (The API returns 401 JSON.)
- **`SAML_PRIVATE_KEY_PATH` is unset** in the local `.env` and the server still
  boots — only `SAML_CERT_PATH` is read synchronously
  (`src/middleware/passport.js`), so CI only needs a readable cert file to boot.

### TODO: authenticated E2E (next passes)

- **Logout / SLO spec.** Not covered yet — `/auth/logout` triggers a SAML Single
  Logout round-trip to the IdP; add a spec that logs out and confirms a
  subsequent protected-page visit redirects to login.
- **Staff and student roles.** Only faculty storage state is saved today. Add
  `staff`/`student` logins in global-setup and role-gating specs (student cannot
  reach `/users` or question generation).
- **Confirm the CI IdP job on a real runner.** The workflow is wired end-to-end
  and every piece is verified locally, but it has not yet run on a GitHub runner —
  watch the first run for docker-build time and IdP readiness timing, and pin
  `IDP_REF` to a SHA if upstream `main` drifts. (Note the IdP's `basehostname` is
  `:6122`; SimpleSAMLphp still serves fine when hit on `:8080`, which is what the
  login flow uses — the absolute `:6122` URLs only surface in SLO/metadata.)
- **Add `GRASP_TEST_LLM_STUB` before any LLM/RAG-touching spec** (question
  generation, RAG chat) and set it on the `webServer` command — no live LLM
  calls, ever. LLM/RAG boot init is lazy and does not block `server.listen`.

## Found a bug? Document it, don't fix it

Same policy as BIOCBOT's `tests/e2e/FINDINGS.md`: writing tests **will** surface real
app bugs and inconsistencies. When that happens, do **not** fix the app code in the
same change, and do **not** relax the assertion to make the test green. Instead:

1. Write the test asserting the **expected** (correct) behaviour and leave it failing.
2. Record the discrepancy in the shared **`FINDINGS.md`** at the repo root, under the
   **`## E2E`** section: what the test expected, what the app actually did, the spec
   file and the app file(s) involved, and enough reproduction context to triage it
   without re-running the suite.
3. The failing test + the FINDINGS entry together prompt the real fix as its own
   change. (If a failing test would block CI unacceptably, mark it `test.fixme()` with
   a comment pointing at the FINDINGS entry — never delete or weaken it.)

Create `FINDINGS.md` (sections `## E2E`, `## Unit`, `## Accessibility`) if it doesn't
exist yet. Entries are removed only when the underlying bug is fixed and the test
passes.

## How to validate that these tests are useful

Before merging any E2E test, review it against all of these:

- **Would it fail if the feature broke?** Mentally (or actually) break the feature —
  comment out the route handler, remove the button — and confirm the test fails with a
  readable error. A test that passes against a broken app is worse than no test.
- **Are the assertions specific?** `expect(page.getByRole('heading', { name: 'Quiz 3 published' }))…`
  beats `expect(page.url()).toContain('/quizzes')`. Asserting "the page loaded" or
  "no error was thrown" is not a test.
- **Does it test behaviour, not implementation?** It should read as a user story
  (click, type, see), never assert on internal fetch payloads, store state, or CSS
  classes. If it needs `page.evaluate` to reach app internals, rethink it.
- **Does it cover a realistic success or failure path end-to-end?** At least one of:
  the happy path completes with a user-visible outcome, or an invalid action produces
  a user-visible validation/error message.
- **Is it deterministic?** No random data (unless seeded and echoed in the failure
  message), no time-of-day dependence, no ordering dependence on other tests, no live
  LLM calls, no `waitForTimeout`.
- **Does it follow the conventions here and in FINANCEBOT/BIOCBOT?** Storage-state
  opt-in per file, serial suite, role-prefixed file names, accessible selectors.
