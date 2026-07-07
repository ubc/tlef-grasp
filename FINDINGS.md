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

### Issues Found
- None in the initial unauthenticated pass.

### Limitations
- Authenticated pages are not covered yet because safe SAML storage-state setup is still opt-in and not enabled for the a11y workflow.
- The suite does not automate real institutional SSO, hardcode real credentials, or commit cookies/tokens.
- Axe is only an automated baseline; manual review is still needed for focus order, screen-reader announcement quality, and the clarity of the CWL login journey.

### TODOs
- Add authenticated faculty/staff/student accessibility coverage once the local docker-simple-saml IdP setup is stable in CI.
- Add modal, form validation, menu/dropdown, and populated-state scans as those surfaces get safe test data and auth helpers.
