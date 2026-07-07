# GRASP Accessibility Tests

Automated accessibility coverage lives in `tests/a11y/` and runs with:

```bash
npm run test:a11y
```

Public-page tests run without SAML. Authenticated page, modal, and student-view
coverage requires the local docker-simple-saml IdP and `E2E_SAML=1`; CI wires this
the same way the E2E workflow does.

## Automated Coverage

- Public landing/login entry page and logged-out protected-route redirect.
- Authenticated instructor pages: onboarding, Dashboard, Course Materials,
  Question Generation, Question Bank tabs, Question Review, Quizzes, Quiz Scores,
  My Sections, Users, and Settings.
- Authenticated student-view pages: Student Dashboard, Available Quizzes,
  Achievements, and Quiz Summary error state.
- Course Materials text-content modal open and Escape-close states.
- Mobile navigation drawer open state.

## Known Tracked Issues

See the root `FINDINGS.md` `## Accessibility` section for current issue details.
Current tracked items include:

- Course Materials text-content modal labels are visible but not programmatically
  associated with their fields.
- The shared modal lacks dialog semantics and open/close focus management.
- The mobile navigation drawer lacks focus transfer, Escape close behavior, and
  focus restoration.

## Manual Checklist

Automated axe scans are a baseline only. Manual passes are still needed for:

- Logical focus and reading order across the sidebar, dashboard cards, and tables.
- Screen-reader announcements for quiz timers, async generation, toasts, and
  feedback panels.
- Meaningfulness of labels and alt text for generated math, chemistry, and rich
  question content.
- Keyboard shortcut discoverability on quiz-taking and quiz-summary screens.
