## E2E

## Unit

### Coverage Added
- Added root Jest configuration and scripts for CommonJS server-side unit tests.
- Covered `src/utils/auth.js` role parsing, role precedence, administrator whitelist handling, and minimum-role checks.
- Covered `src/utils/co-instructor-permissions.js` administrator, owner, default co-instructor, explicit-deny, manager, and Express guard behavior with mocked auth/course/settings dependencies.
- Covered `src/utils/slug.js` title sanitization and UBC campus course-code helpers.
- Covered `src/services/calculation-question.js` formula canonicalization/evaluation, variable validation, template rendering, stem reference validation, and numeric answer comparison.
- Covered `src/models/questions/` factory mapping plus multiple-choice, fill-in-the-blank, open-ended, and calculation normalization/error branches.
- Covered `src/utils/llm-provider.js` provider/model/vector-size environment selection.
- Covered `src/utils/structured-llm.js` Ollama and OpenAI orchestration with mocked LLM clients and schema-constrained payload assertions.
- Covered `src/middleware/auth.js` API/page auth guard 401, 403, redirect, and pass-through behavior.
- Covered `src/routes/achievement.js` through supertest with mocked achievement/user-course services for validation, forbidden, duplicate, success, and current-user read paths.
- Covered `src/services/settings.js` database row hydration, malformed JSON fallbacks, hierarchical update flattening, and no-op update behavior with a mocked database collection.
- Expanded `src/models/questions/CalculationQuestion.js` static helper coverage for schema/prompt/retry contracts, formula/stem validation, deterministic variable sampling/rendering, numeric parsing/comparison, token signing/verification, and student-instance construction.
- Expanded model contract coverage for `src/models/questions/Question.js` abstract methods and prompt/schema/retry methods across question types.
- Expanded `src/controllers/achievement.js` route-driven error-path coverage for save/read/count failures and unauthenticated count reads.

### Issues Found
- `src/services/calculation-question.js` normalizes `πr²` to `PIr^2` instead of `PI*r^2`, so formulas using a math constant directly adjacent to a declared variable do not parse as expected. Covered by `tests/unit/calculation-question.service.test.js` with an `it.failing` test until the app fix lands.

### Limitations
- Additional route-handler unit tests are still TODO; this pass added achievement route coverage only.
- Coverage is intentionally collected to identify branch gaps, not to enforce a percentage threshold.

## Accessibility

### Coverage Added
- Added a Playwright accessibility config (`playwright.a11y.config.js`) that reuses the base E2E web server/browser settings but isolates a11y tests and reports in `playwright-report-a11y/`.
- Added `@axe-core/playwright` and a shared axe helper with the BIOCBOT-style critical/serious blocking ratchet plus non-blocking violation logging.
- Added unauthenticated accessibility coverage for the public landing/login entry page and a protected-route redirect back to the login state.
- Added keyboard focus coverage for the CWL sign-in link using an accessible role/name locator.
- Added a separate GitHub Actions workflow for accessibility tests and a Playwright HTML report artifact.
- Added authenticated instructor route scans for onboarding, Dashboard, Course Materials, Question Generation, Question Bank tabs, Question Review, Quizzes, Quiz Scores, My Sections, Users, and Settings.
- Added authenticated student-view route scans for Student Dashboard, Available Quizzes, Achievements, and the Quiz Summary error state.
- Added a11y test data seeding for a minimal owned course when the SAML test user has no course, so course-gated page scans exercise the real app with real MongoDB state.
- Added modal coverage for the Course Materials text-content dialog, including an Escape-close check and a scoped axe scan.
- Updated the accessibility GitHub Actions workflow to run against the same local docker-simple-saml IdP as E2E so authenticated scans run in CI.

### Issues Found
- `label` (critical), Course Materials text-content modal: the "Document Title:" input and "Paste your text content:" textarea have visible labels that are not programmatically associated with their controls. The tracked scan in `tests/a11y/modals.a11y.spec.js` temporarily disables only the `label` rule for this scoped dialog scan. Owner: `client/src/pages/course-materials/MaterialModals.jsx`.
- Modal semantics/focus management, Course Materials text-content modal: the shared modal does not expose `role="dialog"` / `aria-modal`, does not move focus into the dialog on open, and does not return focus to the trigger on close. Covered by `tests/a11y/modals.a11y.spec.js` as `test.fixme()` until the component fix lands. Owner: `client/src/components/ui/Modal.jsx`.
- Mobile navigation keyboard focus, Dashboard mobile drawer: opening the drawer does not move focus to the drawer/close control, Escape does not close it, and focus is not restored to the trigger. Covered by `tests/a11y/instructor.a11y.spec.js` as `test.fixme()` until the component fix lands. Owners: `client/src/components/layout/AppLayout.jsx`, `client/src/components/layout/Sidebar.jsx`.

### Limitations
- The suite does not automate real institutional SSO, hardcode real credentials, or commit cookies/tokens.
- The authenticated suite uses the local docker-simple-saml IdP (`E2E_SAML=1`) and seeds only the minimal course/section data needed to reach empty/default page states. Populated question, quiz attempt, score review, and generated-content states still need richer seeded data.
- Axe is only an automated baseline; manual review is still needed for focus order, screen-reader announcement quality, quiz timer announcements, generated math/chemistry content, and the clarity of the CWL login journey.

### TODOs
- Add staff and real student storage states once `tests/e2e/global-setup.js` saves those roles.
- Add populated-state scans for materials, objectives, quizzes, quiz scores, student quiz attempts, and generated question review once deterministic seed builders exist for those data shapes.
- Remove the modal `label` rule exemption after `MaterialFormModal` associates labels with fields.
