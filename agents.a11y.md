# agents.a11y.md — Accessibility testing (Playwright + axe)

Instructions for coding agents adding or maintaining **automated accessibility tests**
in this repository. The pattern comes from [`tlef-biocbot`](https://github.com/ubc/tlef-biocbot)
(`tests/a11y/`, `axe-helper.js`, `playwright.a11y.config.js`, `a11y.yml` workflow) and
[`tlef-financebot`](https://github.com/ubc/tlef-financebot) (config-inheritance and
animation-freezing details). This layer **depends on the E2E layer existing first** —
it reuses the same Playwright config, webServer, and SAML login setup described in
`agents.e2e.md`. Read that file before this one.

## Purpose of this layer

Catch WCAG 2 A/AA violations (missing labels, broken roles, contrast failures,
unnamed buttons, missing landmarks) on every important page and interactive state of
the React client, automatically, on every PR — and keep them from regressing. It is a
**floor, not a ceiling**: axe finds roughly 30–50% of accessibility problems. Passing
scans must never be reported as "the app is accessible."

## Where tests live & naming

```
tests/
  a11y/
    axe-helper.js                 # shared scan helper (port from BIOCBOT)
    shared.a11y.spec.js           # landing, login, error pages
    instructor.a11y.spec.js       # faculty/staff pages
    student.a11y.spec.js          # student pages
    modals.a11y.spec.js           # open dialogs, scans scoped to the dialog
playwright.a11y.config.js         # repo root, extends playwright.config.js
```

- Directory: `tests/a11y/` at the repo root.
- Naming: `<area>.a11y.spec.js`, kebab-case, grouped by role/area exactly as BIOCBOT
  does (`instructor.…`, `student.…`, `modals.…`, `shared.…`).

## Required tooling

- `@axe-core/playwright` (devDependency, root `package.json`) — plus everything from
  the E2E layer (`@playwright/test`, the webServer, `tests/e2e/global-setup.js`).
- Script: `"test:a11y": "playwright test -c playwright.a11y.config.js"`.
- `playwright.a11y.config.js` follows FINANCEBOT/BIOCBOT exactly: spread the base
  config, override only `testDir: './tests/a11y'` and the reporter
  (`outputFolder: 'playwright-report-a11y'`) so nothing collides with the E2E run.
  Git-ignore `playwright-report-a11y/`.

## The scan helper

Port BIOCBOT's `tests/a11y/axe-helper.js` (`expectNoA11yViolations(page, options)`).
Its load-bearing details, all of which apply here:

- Runs `AxeBuilder` with `withTags(['wcag2a', 'wcag2aa'])`.
- **Blocking impacts ratchet**: only `critical` and `serious` violations fail the
  build; `moderate`/`minor` are logged as warnings. This lets you land the suite
  against a codebase with pre-existing noise, then widen the blocking set as pages are
  cleaned up. Never silently drop the non-blocking log.
- **Freeze animations before scanning** (inject a style tag zeroing
  animation/transition durations, swallowing CSP rejections). GRASP's CSP
  (`styleSrcElem: 'self'`) will likely block the injected `<style>` — prefer the
  FINANCEBOT alternative that works regardless: the base Playwright config already
  sets `reducedMotion: 'reduce'`, and the client should honour
  `prefers-reduced-motion`. Without one of these, axe samples mid-fade colors and
  reports false contrast failures.
- `include` option to scope a scan to a subtree — used for modal scans so a dialog's
  audit doesn't re-fail on the host page's separately-tracked violations.
- `disableRules` option for documented, per-page exemptions — every use must carry a
  comment saying *why* and ideally an issue link. An undocumented `disableRules` is a
  hidden failure.

## What to scan (priority order)

1. **Every routed page** in `client/src/pages/` (Landing, Dashboard, Onboarding,
   CourseMaterials, QuestionBank, QuestionGeneration, QuestionReview, Quizzes,
   QuizScores, QuizSummary, MySections, Users, Settings, Achievements,
   StudentDashboard, StudentQuiz) — in its default authenticated state for the
   appropriate role (`test.use({ storageState: … })` per file, same as E2E).
2. **Interactive states, not just initial render** (this is where scans earn their
   keep — BIOCBOT's `populated-states` and `modals` specs are the model):
   - open modals/dialogs (scoped scans), expanded menus and dropdowns
   - forms **with validation errors showing** (an error state with unlabeled red text
     is a classic miss)
   - populated data states (a question bank with questions, a quiz mid-attempt with
     KaTeX/chemistry rendering) vs. empty states
3. **Logged-out surfaces**: landing page, login redirect page.

Beyond axe, add targeted Playwright assertions for what axe cannot see:

- **Keyboard**: `page.keyboard.press('Tab')` sequences through a form/dialog; Escape
  closes modals; Enter activates the focused control.
- **Focus management**: opening a modal moves focus into it; closing returns focus to
  the trigger; route changes land focus somewhere sensible.
- **Names/roles as a side effect of selectors**: writing all locators as
  `getByRole`/`getByLabel` (per `agents.e2e.md`) means unnamed controls fail loudly.

## Avoiding false confidence — manual validation notes

Automated scans do not cover: logical focus/reading order, screen-reader announcement
quality (live regions for async results like question generation), meaningfulness of
alt text and labels, cognitive load, or drag-and-drop equivalents. Whenever a spec
covers a page with such risks, add a short `// MANUAL:` comment block at the top of
the spec listing what still needs a human pass (e.g. "MANUAL: verify quiz timer is
announced; verify SMILES structure images have meaningful alt"). Keep BIOCBOT's
`tests/a11y/README.md` idea: a README in `tests/a11y/` tracking known non-blocking
violations and the manual checklist.

## Running locally

Same prerequisites as E2E (MongoDB + SAML IdP up, `.env` configured, chromium
installed):

```bash
npm run test:a11y                          # all scans, own report
npx playwright test -c playwright.a11y.config.js tests/a11y/student.a11y.spec.js
npx playwright show-report playwright-report-a11y
```

Reuses a running `npm run dev` on :8070 like the E2E suite.

## GitHub Actions

Own workflow, `.github/workflows/a11y-tests.yml`, separate from E2E and unit (model:
BIOCBOT's `a11y.yml`). Independently runnable via `workflow_dispatch`; triggers on
`push` and `pull_request` → `main`.

- Environment is **identical to the E2E workflow** (same services — `mongo:7` plus the
  SimpleSAMLphp IdP container, same env vars including the LLM stub flag, `npm install`
  for root and `client/` — the lockfile is git-ignored, so no `npm ci` —
  `npx playwright install --with-deps chromium`) — the only differences are the run
  step (`npm run test:a11y`) and the artifact.
- Upload artifact `a11y-report` → `playwright-report-a11y/`,
  `if: ${{ !cancelled() }}`, `retention-days: 14`.
- Keep it non-blocking for local development: developers never need to run it before
  pushing; CI is the enforcement point.

## Found a violation? Document it, don't fix it

Same policy as BIOCBOT: scans **will** find real accessibility defects in the app.
When they do, do **not** fix the component markup in the same change, and do **not**
hide the violation with `disableRules` or by narrowing the scan. Instead:

1. Keep the scan asserting the correct (violation-free) behaviour.
2. Record each genuine violation in the shared **`FINDINGS.md`** at the repo root,
   under the **`## Accessibility`** section: the axe rule ID and impact, the page and
   state it occurs in, the offending element/selector, and the component file in
   `client/src/` that owns it.
3. The markup fix lands as its own change, then the entry is removed. For violations
   that must temporarily not block CI, the blocking-impacts ratchet in `axe-helper.js`
   is the sanctioned mechanism (moderate/minor already warn instead of fail) — a
   `disableRules` entry is acceptable only with a comment pointing at the FINDINGS
   entry.

Create `FINDINGS.md` (sections `## E2E`, `## Unit`, `## Accessibility`) if it doesn't
exist yet.

## How to validate that these tests are useful

Before merging any a11y test, review it against all of these:

- **Would it fail if the page's accessibility broke?** Try it: remove a form label or
  an `aria-label` in the component and confirm the scan fails with a critical/serious
  violation. If your spec only scans an empty shell (e.g. before data loads), it will
  pass no matter what — wait for real content (`await expect(heading).toBeVisible()`)
  before scanning.
- **Are the assertions specific?** Zero blocking violations, with the failure output
  listing rule IDs and offending nodes — plus targeted keyboard/focus assertions where
  they matter. "Page responded with 200" is not an accessibility test.
- **Is it more than a duplicate of the E2E spec?** An a11y spec's value is the scan
  and the keyboard/focus checks; it should not re-assert business behaviour already
  covered in `tests/e2e/`.
- **Does it cover a realistic state?** At least one populated/interactive or
  error-showing state per major page, not only pristine initial renders.
- **Is it deterministic?** Animations frozen/reduced before scanning; scans run after
  content is stable; no timing-dependent contrast flakes; modal scans scoped with
  `include` so unrelated pre-existing violations don't create noise.
- **Does it follow BIOCBOT's conventions?** Shared `axe-helper`, blocking-impacts
  ratchet, documented `disableRules`, role-grouped spec files, separate report folder.
