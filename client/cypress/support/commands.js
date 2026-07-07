import { USERS, COURSE, SELECTED_COURSE } from "../fixtures/users";

const okJson = (body) => ({ statusCode: 200, body });

// Stub the authentication probe. "anonymous" returns 401 — exactly what an
// unauthenticated session produces, which the guards and api.js react to.
Cypress.Commands.add("stubCurrentUser", (role) => {
  if (role === "anonymous") {
    cy.intercept("GET", "/api/current-user", {
      statusCode: 401,
      body: { error: "Not authenticated" },
    }).as("currentUser");
    return;
  }
  cy.intercept("GET", "/api/current-user", okJson({ success: true, user: USERS[role] })).as(
    "currentUser"
  );
});

// The sidebar's course selector always loads the user's courses; stub both the
// staff/faculty and student endpoints so any role renders.
Cypress.Commands.add("stubCourses", (courses = [COURSE]) => {
  cy.intercept("GET", "/api/courses/my", okJson({ success: true, courses })).as("coursesMy");
  cy.intercept("GET", "/api/student/courses", okJson({ success: true, courses })).as(
    "studentCourses"
  );
});

// Baseline backend for an authenticated session. The catch-all is registered
// FIRST so that any spec-specific cy.intercept defined afterward takes
// precedence (Cypress uses the most recently defined matching interceptor).
// Its purpose is to stop unstubbed GETs from returning 401 and tripping the
// app's global "session expired" redirect, not to assert anything.
Cypress.Commands.add("stubBackend", (role, { courses = [COURSE] } = {}) => {
  cy.intercept("GET", "/api/**", okJson({ success: true })).as("apiCatchAll");
  cy.stubCurrentUser(role);
  cy.stubCourses(courses);
});

// Visit a route as an unauthenticated user.
Cypress.Commands.add("visitAnonymous", (path = "/") => {
  cy.stubCurrentUser("anonymous");
  cy.visit(path, { failOnStatusCode: false });
});

// Visit a route with a seeded session: selected course (so the onboarding guard
// passes) and an optional instructor/student view.
Cypress.Commands.add("visitApp", (path, opts = {}) => {
  const { course = SELECTED_COURSE, roleView } = opts;
  cy.visit(path, {
    failOnStatusCode: false,
    onBeforeLoad(win) {
      if (course) {
        win.sessionStorage.setItem("grasp-selected-course", JSON.stringify(course));
      }
      if (roleView) {
        win.localStorage.setItem("grasp-current-role", roleView);
      }
    },
  });
});
