## E2E

### Coverage Added
- Extended `tests/e2e/global-setup.js` to save faculty, staff, and student SAML storage states from the local docker-simple-saml IdP, using per-role env overrides with local test-user fallbacks.
- Added logout coverage in `tests/e2e/auth.spec.js`: a faculty user logs in through the IdP, signs out through GRASP, then a protected route redirects back to the logged-out landing page.
- Added `tests/e2e/role-gating.spec.js` for student and staff authenticated boundaries: students deep-linking to instructor pages land on the student dashboard without instructor navigation, student onboarding hides instructor course-management actions, and staff onboarding can join but not create courses.
- Added `tests/e2e/student-dashboard.spec.js` for the authenticated `bio_student` dashboard: verifies the seeded course is selected, student quick links render, and the "View All Quizzes" path reaches the seeded quiz.
- Added `tests/e2e/instructor-seeded-course.spec.js` for authenticated `bio_prof2` seeded-course views: verifies the linked section in My Sections, the seeded quiz approval/schedule state in Quizzes, and an instructor Quiz Scores review after a real `bio_student` attempt.
- Added `tests/e2e/helpers.js` with shared seeded-course selection and seeded-quiz completion helpers for authenticated E2E specs.

### Issues Found
- Staff role onboarding mismatch: the expected staff behavior is to show `Login to Existing Dashboard` and `Join a course`, but not the faculty-only `New Course Setup`. In the local SAML run, logging in as the docker-simple-saml `staff` user rendered `New Course Setup` and the setup wizard. The expected-behavior check is captured as `test.fixme()` in `tests/e2e/role-gating.spec.js` until the staff role mapping/test-user data is corrected. Relevant app files: `client/src/pages/Onboarding.jsx`, `src/server.js`, `src/utils/auth.js`, and `src/middleware/passport.js`.
- CI instructor journey question-bank approval timeout: after deploy-key auth was corrected and the full E2E suite reached the generated-question flow, `tests/e2e/instructor-journey.spec.js` passed SAML login, onboarding, material upload, objective generation, and question generation, then timed out in `approves the generated questions in the question bank`. The test expected the Question Bank bulk action bar to expose an `Approve` button after `Select all questions` was checked, but Playwright waited 30s on every retry for `getByTestId('bulk-action-bar').getByRole('button', { name: /Approve$/ })` and never found it. Reproduction context: GitHub Actions `npm run test:e2e`, upstream branch run with `FAKE_API_DEPLOY_KEY` available, failure at `tests/e2e/instructor-journey.spec.js:185`; screenshots/traces were attached under `test-results/instructor-journey-Instruc-84a4e-stions-in-the-question-bank-chromium*`. Likely owner: `client/src/pages/question-bank/QuestionsTab.jsx` (`BulkActionBar`/bulk approval UI). Do not weaken the assertion; either expose a stable selector according to `agents.e2e.md` selector policy or adjust the test to an existing accessible bulk-approve control in a separate fix.

- Quiz Summary results endpoint unimplemented: the student Quiz Summary page (`/quiz-summary?quiz=<id>`, `client/src/pages/QuizSummary.jsx`) loads its data from `GET /api/student/quizzes/:quizId/results` via `useStudentQuizResults`, but the handler `getQuizResultsHandler` in `src/controllers/student.js` is a stub that unconditionally responds `501 { success: false, message: "Quiz history not implemented yet" }`. As a result the page always falls into its "Unable to Load Quiz Summary" error branch even for a quiz the student just completed — the score sidebar and per-question review can never render with real data. The expected behaviour (summary loads, shows correctAnswers/totalQuestions, per-question navigation, correct/incorrect marks) is captured as `test.fixme('reviews a completed attempt question by question')` in `tests/e2e/student-quiz-summary.spec.js`; the error-state test in the same file passes and stays active. Likely owner: `src/controllers/student.js` (`getQuizResultsHandler`), which should aggregate `grasp_student_attempt` (and quiz question text/feedback) into the `{ score, correctAnswers, totalQuestions, completedAt, questions:[{question,userAnswer,explanation,isCorrect}] }` shape the page consumes.

### Coverage Added (later pass)
- Added `tests/e2e/student-quiz-summary.spec.js`: the Quiz Summary error state (no `quiz` param → "Unable to Load Quiz Summary" → Return to Dashboard) plus a `test.fixme()` for the intended completed-attempt review (blocked by the 501 stub above).
- Added `tests/e2e/instructor-question-bank.spec.js` (seeded BIOC 302 as `bio_prof2`): questions table lists the seeded approved questions with their parent objective, search filter, status filter, single-question flag/unflag with the flagged-only filter, and the Learning Objectives tab hierarchy.
- Added `tests/e2e/instructor-settings.spec.js`: Bloom-level question-type table + invite code render, saving settings, resetting a prompt to default on the Course Prompts tab, and toggling an owner-only co-instructor permission switch (toggled back, never saved).
- Added `tests/e2e/instructor-users.spec.js`: the course-users member table (owner + two seeded students with roles/sections and the "You" marker), the section filter scoping, and a cancelled remove-user confirmation.
- Added `tests/e2e/instructor-course-materials.spec.js` (serial lifecycle): empty-content validation, create a text material, type filter, edit, and delete — self-created and cleaned up so it leaves no DB residue.
- Extended `tests/e2e/seed.js` `SEED` with `QUESTION_TITLES` for question-bank assertions.

### Limitations
- Authenticated E2E specs still require `E2E_SAML=1` plus the local SAML IdP and MongoDB services; the default non-SAML run skips them.
- The new role-gating specs intentionally avoid seeded course data and LLM/RAG flows, so populated instructor/student course workflows remain TODO.

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
- Expanded `src/services/calculation-question.js` helper coverage for deterministic variable sampling, rendered stem composition, student-instance construction, numeric parsing/matching, and token verification failure paths.
- Expanded auth/co-instructor/structured-LLM branch coverage for database-backed admin lookup, DB lookup failure fallback, unauthenticated role middleware, allowed page middleware, allowed co-instructor guard, and Ollama conversation-message handling.
- Added additional branch coverage for calculation-service impossible integer ranges, unsupported formula syntax, retry exhaustion on non-finite sampled formulas, malformed/expired signed tokens, auth role-precedence helper negatives, and settings read/write error propagation.

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
- ~~`label` (critical), Course Materials text-content modal: the "Document Title:" input and "Paste your text content:" textarea have visible labels that are not programmatically associated with their controls.~~ RESOLVED: `MaterialFormModal` now associates every label via `htmlFor`/`id` (`useId`), and the scoped scan in `tests/a11y/modals.a11y.spec.js` no longer disables the `label` rule. Owner: `client/src/pages/course-materials/MaterialModals.jsx`.
- ~~Modal semantics/focus management, Course Materials text-content modal: the shared modal does not expose `role="dialog"` / `aria-modal`, does not move focus into the dialog on open, and does not return focus to the trigger on close.~~ RESOLVED: the shared `Modal` now sets `role="dialog"`, `aria-modal`, `aria-labelledby` (title), focuses the Close button on open, and restores focus to the trigger on close — fixing every dialog app-wide. Now covered by a real (non-`fixme`) test in `tests/a11y/modals.a11y.spec.js`. Owner: `client/src/components/ui/Modal.jsx`.
- ~~Mobile navigation keyboard focus, Dashboard mobile drawer: opening the drawer does not move focus to the drawer/close control, Escape does not close it, and focus is not restored to the trigger.~~ RESOLVED: the drawer now focuses its close control on open, closes on Escape, and restores focus to the trigger on close; the closed drawer is also `invisible` on mobile so its links leave the tab order and accessibility tree (previously they stayed focusable off-screen via `-translate-x-full`). Now covered by a real (non-`fixme`) test in `tests/a11y/instructor.a11y.spec.js`. Owners: `client/src/components/layout/AppLayout.jsx`, `client/src/components/layout/Sidebar.jsx`.

### Limitations
- The suite does not automate real institutional SSO, hardcode real credentials, or commit cookies/tokens.
- The authenticated suite uses the local docker-simple-saml IdP (`E2E_SAML=1`) and seeds only the minimal course/section data needed to reach empty/default page states. Populated question, quiz attempt, score review, and generated-content states still need richer seeded data.
- Axe is only an automated baseline; manual review is still needed for focus order, screen-reader announcement quality, quiz timer announcements, generated math/chemistry content, and the clarity of the CWL login journey.

### TODOs
- Add staff and real student storage states once `tests/e2e/global-setup.js` saves those roles.
- Add populated-state scans for materials, objectives, quizzes, quiz scores, student quiz attempts, and generated question review once deterministic seed builders exist for those data shapes.
