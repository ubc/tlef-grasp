# agents.unit.md — Jest unit & integration testing

Instructions for coding agents adding or maintaining **Jest unit/integration tests** in
this repository. The blueprint is [`tlef-financebot`](https://github.com/ubc/tlef-financebot)
(`tests/unit/`, `jest.config.js`, `jest.monocart.config.js`, `tests/AGENTS.md`), with
BIOCBOT's CI workflow as the model. FINANCEBOT is TypeScript; GRASP is **CommonJS
JavaScript** — same patterns, no ts-jest.

## Purpose of this layer

Fast, deterministic tests of **server-side logic in isolation**: pure functions,
services with their external components mocked, and Express routers driven over HTTP
with supertest. No MongoDB, no Qdrant/Ollama, no IdP, no network, no browser. They must
run in seconds with zero prerequisites (`npm test` on a fresh clone must pass).

Browser/user flows belong to `agents.e2e.md`; axe scans to `agents.a11y.md`. Client
(React) code is exercised by those browser layers — do **not** add jsdom/React
Testing Library unless a real need appears (FINANCEBOT explicitly deferred this too).

## What is worth unit testing (priority order)

1. **Pure functions and business logic** — highest value per line:
   - `src/utils/auth.js` (`getUserRole`, role precedence, `isAppAdministrator`)
   - `src/utils/co-instructor-permissions.js` (permission matrix — recently added,
     security-relevant)
   - `src/utils/slug.js`, `src/utils/structured-llm.js` (schema/output parsing),
     answer/`expr-eval` logic in `src/services/calculation-question.js`
   - Validation and shaping logic in `src/models/questions/` and `src/constants/`
2. **Services with components mocked** — e.g. `src/services/rag.js`,
   `src/services/llm.js`, `src/services/quiz-schedule.js`, `src/services/ubcApiService.js`:
   `jest.mock()` the toolkit/DB/HTTP modules and assert the orchestration (what gets
   called with what, how errors propagate).
3. **Route handlers via supertest** — mount a single router from `src/routes/` on a
   bare Express app, mock the service layer, and assert status codes + JSON bodies,
   including the auth guards (`ensureAuthenticatedAPI`, `requireRole`) returning
   401/403 vs. passing through.

Not worth unit testing: glue code with no branches, Express boilerplate,
`src/server.js` (entry point — bootstraps real connections; exclude from coverage as
FINANCEBOT does), anything already fully covered by an E2E flow *and* free of logic.

## Where tests live & naming

```
tests/
  unit/
    auth.utils.test.js
    co-instructor-permissions.test.js
    rag.service.test.js
    quiz.route.test.js
jest.config.js               # repo root
jest.monocart.config.js      # repo root (optional, interactive coverage HTML)
```

- Directory: `tests/unit/` at the repo root (FINANCEBOT/BIOCBOT convention). Do not
  scatter `__tests__` folders through `src/`.
- Naming: `<subject>.<kind>.test.js` where kind ∈ `utils` | `service` | `route` |
  (omitted for plain domain logic). One subject per file.

## Required tooling & scripts

devDependencies (root `package.json`): `jest`, `supertest`, and optionally
`jest-monocart-coverage` (FINANCEBOT uses it for the interactive HTML coverage report).

Scripts (FINANCEBOT naming — also replace the current placeholder `test` script):

```json
"test": "jest",
"test:unit": "jest",
"test:unit:watch": "jest --watch",
"test:unit:coverage": "jest --coverage",
"test:unit:monocart": "jest -c jest.monocart.config.js"
```

`jest.config.js`, adapted from FINANCEBOT (drop the ts-jest transform):

```js
module.exports = {
  testEnvironment: 'node',
  maxWorkers: 1,                 // serial: deterministic supertest listeners/module state
  roots: ['<rootDir>/tests/unit'],
  testMatch: ['**/*.test.js'],
  clearMocks: true,
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js',            // entry point — bootstraps real connections
  ],
  coverageDirectory: 'coverage-reports/unit',
  coverageReporters: ['text-summary', 'lcovonly'],
};
```

`jest.monocart.config.js`: copy FINANCEBOT's verbatim (extends the base config, routes
coverage through `jest-monocart-coverage` into `coverage-reports/unit-monocart/`).
Git-ignore `coverage-reports/`.

## Mocking rules

**Always mock** (units must not touch these): MongoDB (`mongodb`, the `req.db` /
`dbMiddleware` layer), the ubc-genai-toolkit LLM/embeddings/RAG clients, the UBC
academic API / `node-fetch`-style HTTP, the SAML/passport stack (stand in a tiny
middleware that fakes `req.isAuthenticated()` / `req.user` — FINANCEBOT's
`notes.route.test.ts` / `roles.test.ts` pattern), the filesystem for upload/parse
paths, timers where scheduling logic depends on "now" (`jest.useFakeTimers` or inject
the clock).

Use `jest.mock('module', factory)` **with factories** for the toolkit packages so the
real clients never load (FINANCEBOT's `rag.service.test.ts` pattern — some toolkit
modules open connections at import time).

**Never mock** the unit under test, and don't mock pure helpers it calls — let real
logic run so the test catches real regressions. If you find yourself mocking so much
that the test only re-states the mocks, the test is asserting implementation details;
delete it or move the boundary.

Beware module-level state: tests run serially with `clearMocks: true`, but a cached
flag inside an imported module persists across tests in a file. Use
`jest.resetModules()` + `require` inside the test when you must vary import-time
behaviour; never write tests that depend on execution order.

## What good coverage means here

Not a percentage. Good coverage means: every **branch of business logic** that can
produce a different user-visible outcome has a test — role granted vs. denied, valid
vs. invalid payload (400), missing resource (404), unauthenticated (401), forbidden
(403), service error propagation (500), and the happy path. Chasing 100% line coverage
via tests that call functions without meaningful assertions is explicitly banned.
Collect coverage (`npm run test:unit:coverage`) to **find untested branches**, not to
hit a number.

## Running locally

```bash
npm test                    # everything, no services needed, fresh clone must pass
npm run test:unit:watch     # watch mode
npm run test:unit:coverage  # text summary + lcov
npm run test:unit:monocart  # interactive HTML: coverage-reports/unit-monocart/index.html
npx jest tests/unit/auth.utils.test.js   # one file
```

## GitHub Actions

Own workflow, `.github/workflows/unit-tests.yml`, separate from E2E and a11y (model:
BIOCBOT's `unit.yml`). Independently runnable (`workflow_dispatch`), triggers on
`push` (all branches) and `pull_request` → `main`.

- `ubuntu-latest`, Node 20, `timeout-minutes: 10`. **No services, no browsers.**
- Use `npm install`, not `npm ci` — `package-lock.json` is git-ignored in this repo
  (same as BIOCBOT). If a lockfile is committed later, switch to `npm ci` and enable
  `cache: npm` on setup-node.
- Run `npm run test:unit:coverage`.
- Upload artifact `unit-coverage` → `coverage-reports/unit/`,
  `if: ${{ !cancelled() }}`, `retention-days: 14`.

This workflow should be the fastest signal in CI (< 2 min); keep it that way — any
test that needs Docker or network belongs in another layer.

## Found a bug? Document it, don't fix it

Same policy as BIOCBOT's `FINDINGS.md`: unit testing will surface real defects
(wrong branch logic, inconsistent shapes between services, guards that don't guard).
When it does, do **not** fix the app code in the same change, and do **not** bend the
test to match the buggy behaviour. Instead:

1. Write the test asserting the **expected** (correct) behaviour and leave it failing.
2. Record the discrepancy in the shared **`FINDINGS.md`** at the repo root, under the
   **`## Unit`** section: what was expected, what the code actually does, the test
   file and the `src/` file(s) involved.
3. The fix lands as its own change, at which point the entry is removed and the test
   goes green. (If CI must stay green meanwhile, use `test.failing()` / `it.skip` with
   a comment pointing at the FINDINGS entry — never delete or weaken the assertion.)

Create `FINDINGS.md` (sections `## E2E`, `## Unit`, `## Accessibility`) if it doesn't
exist yet.

## How to validate that these tests are useful

Before merging any unit test, review it against all of these:

- **Would it fail if the logic broke?** Flip the branch under test (invert the role
  check, break the validation) and confirm the test fails. If mutating the code
  doesn't fail the test, the test is decorative.
- **Are the assertions specific?** Assert exact status codes, exact error messages or
  codes, exact returned/derived values — not `toBeDefined()`, not "the mock was
  called" as the *only* assertion.
- **Is it behaviour, not implementation?** Asserting `service.helper` was called 3
  times in a given order is implementation detail; asserting the returned payload /
  thrown error / persisted call arguments is behaviour. Mock-call assertions are fine
  only when the call *is* the contract (e.g. "deletes the right document ID").
- **Does it cover at least one realistic success path and one failure path** for the
  unit (valid + invalid input, authorized + unauthorized caller)?
- **Is it deterministic?** No real time (`Date.now()` uninjected), no randomness, no
  network, no test-order dependence, no reliance on module state left by another test.
- **Does it follow FINANCEBOT's patterns?** Pure-function test / mocked-service test /
  supertest route test / fake-passport guard test — pick the matching pattern from
  FINANCEBOT's `tests/unit/` and mirror its structure.
