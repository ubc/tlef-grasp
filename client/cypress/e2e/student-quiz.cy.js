// Exercises the student quiz list (StudentQuiz.jsx + QuizList.jsx): published
// quizzes from the personalized overview endpoint, plus the empty state.

function stubStudentExtras() {
  cy.intercept("GET", "/api/achievement/my*", {
    statusCode: 200,
    body: { success: true, data: [] },
  }).as("achievements");
  cy.intercept("GET", "/api/quiz/my-scores*", {
    statusCode: 200,
    body: { success: true, completedQuizIds: [] },
  }).as("myScores");
}

describe("Student quiz list", () => {
  it("lists published quizzes the student can start", () => {
    cy.stubBackend("student");
    stubStudentExtras();
    cy.intercept("GET", "/api/quiz/course/*/student-overview", {
      statusCode: 200,
      body: {
        success: true,
        quizzes: [
          {
            _id: "quiz1",
            name: "Practice Set A",
            description: "Warm-up on stoichiometry",
            questionCount: 5,
            phase1Count: 0,
            phase2Count: 0,
            phase3Count: 0,
            deliveryFormat: "all-approved",
            releaseDate: "2025-09-01T00:00:00.000Z",
            published: true,
          },
        ],
      },
    }).as("overview");
    cy.visitApp("/quiz");

    cy.contains("Practice Set A").should("be.visible");
    cy.contains("Warm-up on stoichiometry").should("be.visible");
    cy.contains("button", "Start Quiz").should("be.visible").and("not.be.disabled");
  });

  it("shows an empty state when no quizzes are published", () => {
    cy.stubBackend("student");
    stubStudentExtras();
    cy.intercept("GET", "/api/quiz/course/*/student-overview", {
      statusCode: 200,
      body: { success: true, quizzes: [] },
    }).as("overview");
    cy.visitApp("/quiz");

    cy.contains("No Quizzes Available").should("be.visible");
  });
});
