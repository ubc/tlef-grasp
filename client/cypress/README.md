# End-to-end tests (Cypress)

These specs drive the **real** React app and assert on real rendered output,
navigation, route guards and user interactions. Only the HTTP layer is stubbed
(via `cy.intercept`) — the SAML/CWL backend can't run in a test, so each spec
provides the API responses the page needs and then verifies the app's behaviour
against them. A test fails if the feature regresses, not merely if a stub is
called.

## Running

The app must be served while Cypress runs. All backend calls are intercepted, so
only the Vite dev server (frontend) is required — the Express API does not need
to be up.

```bash
# One command: starts the Vite dev server, runs all specs headless, stops it
npm run test:e2e

# Or, with the dev server already running (npm run dev):
npm run cypress:run            # headless, all specs
npm run cypress:open           # interactive runner

# A single spec:
npx cypress run --spec "cypress/e2e/auth.cy.js"
```

By default Cypress targets `http://localhost:5173`. Override with
`CYPRESS_BASE_URL` to run against a different origin (e.g. the built app served
by Express on `:8070` after `npm run build`).

## Layout

- `support/commands.js` — auth/session helpers:
  - `cy.visitAnonymous(path)` — visit as a logged-out user (401 on
    `/api/current-user`).
  - `cy.stubBackend(role, { courses })` — baseline stubs for an authenticated
    `faculty` | `staff` | `student` session, including a catch-all so unstubbed
    GETs don't trip the app's session-expiry redirect. Call it first; any
    spec-specific `cy.intercept` defined afterwards takes precedence.
  - `cy.visitApp(path, { course, roleView })` — seed the selected course
    (sessionStorage) and instructor/student view (localStorage), then visit.
- `fixtures/users.js` — canonical fake users and course.
- `e2e/*.cy.js` — one spec per area: auth/guards, sidebar navigation, question
  bank, course materials, quizzes, student quiz list, responsive sidebar.
