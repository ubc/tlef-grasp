// Exercises the route guards (guards.jsx) and the landing-page redirects
// (Landing.jsx) against the real router and the real api.js 401 handling.

describe("Authentication and route guards", () => {
  it("sends an unauthenticated visitor from a protected route back to the landing page", () => {
    cy.visitAnonymous("/dashboard");

    cy.location("pathname").should("eq", "/");
    cy.contains("Welcome to GRASP").should("be.visible");
  });

  it("offers the CWL login entry point on the landing page", () => {
    cy.visitAnonymous("/");

    cy.contains("Welcome to GRASP").should("be.visible");
    cy.get('a[href="/auth/ubcshib"]').should("contain.text", "Log in with CWL");
  });

  it("routes an authenticated user who has a course straight to their dashboard", () => {
    cy.stubBackend("faculty");
    cy.visitApp("/");

    cy.location("pathname").should("eq", "/dashboard");
    cy.contains("Hello, Dr. Ada Faculty").should("be.visible");
  });

  it("routes an authenticated user with no course to onboarding", () => {
    cy.stubBackend("faculty", { courses: [] });
    cy.visitApp("/", { course: null });

    cy.location("pathname").should("eq", "/onboarding");
    cy.contains("New Course Setup").should("be.visible");
  });

  it("keeps a student off an instructor-only page (role guard)", () => {
    cy.stubBackend("student");
    // A student is below the staff rank required by /quiz-scores.
    cy.visitApp("/quiz-scores");

    cy.location("pathname").should("eq", "/student-dashboard");
  });
});
