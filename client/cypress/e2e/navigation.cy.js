// Exercises the sidebar's role-based navigation (Sidebar.jsx) and routing.
// Nav assertions are scoped to <aside> so they don't collide with the same
// words appearing in page body copy (e.g. the dashboard's getting-started guide).

describe("Sidebar navigation", () => {
  it("shows faculty the Users and Settings management links", () => {
    cy.stubBackend("faculty");
    cy.visitApp("/dashboard");

    cy.get("aside").within(() => {
      cy.contains("Question Bank").should("be.visible");
      cy.contains("Users").should("be.visible");
      cy.contains("Settings").should("be.visible");
    });
  });

  it("hides the faculty-only Users link from staff", () => {
    cy.stubBackend("staff");
    cy.visitApp("/dashboard");

    cy.get("aside").within(() => {
      cy.contains("Question Bank").should("be.visible");
      cy.contains("Settings").should("be.visible");
      cy.contains("Users").should("not.exist");
    });
  });

  it("shows students only the student navigation", () => {
    cy.stubBackend("student");
    cy.visitApp("/student-dashboard");

    cy.get("aside").within(() => {
      cy.contains("My Quizzes").should("be.visible");
      cy.contains("Achievements").should("be.visible");
      cy.contains("Question Bank").should("not.exist");
      cy.contains("Users").should("not.exist");
    });
  });

  it("navigates when a sidebar item is clicked", () => {
    cy.stubBackend("faculty");
    cy.visitApp("/dashboard");

    cy.get("aside").contains("Course Materials").click();
    cy.location("pathname").should("eq", "/course-materials");
  });

  it("lets faculty switch into the student view", () => {
    cy.stubBackend("faculty");
    cy.visitApp("/dashboard");

    cy.get("aside").contains("Switch View").click();

    cy.location("pathname").should("eq", "/student-dashboard");
    cy.get("aside").within(() => {
      cy.contains("My Quizzes").should("be.visible");
      cy.contains("Quiz Scores").should("not.exist");
    });
  });
});
