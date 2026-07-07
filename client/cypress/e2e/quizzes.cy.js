// Exercises Quizzes.jsx: rendering quiz cards (with approval progress derived
// from their questions) and entering the create-quiz wizard.

describe("Quizzes", () => {
  beforeEach(() => {
    cy.stubBackend("faculty");
    cy.intercept("GET", "/api/quiz/course/*/with-questions", {
      statusCode: 200,
      body: {
        success: true,
        quizzes: [
          {
            _id: "quiz1",
            name: "Midterm 1 Review",
            createdAt: "2025-10-01T00:00:00.000Z",
            published: false,
            deliveryFormat: "all-approved",
            questions: [
              { _id: "q1", status: "Approved" },
              { _id: "q2", status: "Draft" },
            ],
          },
        ],
      },
    }).as("quizzesWithQuestions");
  });

  it("renders quiz cards with their approval progress", () => {
    cy.visitApp("/quizzes");

    cy.contains("Midterm 1 Review").should("be.visible");
    // 1 of 2 questions approved.
    cy.contains("50% Approved").should("be.visible");
    cy.contains("button", "Publish").should("be.visible");
  });

  it("enters the create-quiz wizard from the second tab", () => {
    cy.visitApp("/quizzes");

    cy.contains("button", "Create New Quiz").click();
    cy.contains("Select Course Materials").should("be.visible");
    cy.contains("Next: Select Objectives").should("be.visible");
  });
});
