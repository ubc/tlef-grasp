// Exercises the Question Bank table: data rendering, client-side filtering and
// search (QuestionsTab.jsx), tab switching, and faculty-only controls.

const QUESTIONS = [
  {
    _id: "q1",
    title: "Balancing redox equations",
    questionType: "multiple-choice",
    bloom: "Apply",
    status: "Approved",
    learningObjectiveId: "obj1",
    flagStatus: false,
  },
  {
    _id: "q2",
    title: "Define electronegativity",
    questionType: "fill-in-the-blank",
    bloom: "Remember",
    status: "Draft",
    learningObjectiveId: "obj1",
    flagStatus: false,
  },
  {
    _id: "q3",
    title: "Compute molar mass of glucose",
    questionType: "calculation",
    bloom: "Apply",
    status: "Draft",
    learningObjectiveId: "obj2",
    flagStatus: true,
  },
];

const OBJECTIVES = [
  { _id: "obj1", name: "Stoichiometry" },
  { _id: "obj2", name: "Thermochemistry" },
];

function stubQuestionBank() {
  cy.intercept("GET", "/api/question*", {
    statusCode: 200,
    body: { success: true, questions: QUESTIONS },
  }).as("questions");
  cy.intercept("GET", "/api/objective*", {
    statusCode: 200,
    body: { success: true, objectives: OBJECTIVES },
  }).as("objectives");
  cy.intercept("GET", "/api/quiz/course/*/with-questions", {
    statusCode: 200,
    body: { success: true, quizzes: [] },
  }).as("quizzes");
}

describe("Question Bank", () => {
  it("renders every question returned by the API", () => {
    cy.stubBackend("faculty");
    stubQuestionBank();
    cy.visitApp("/question-bank");

    cy.contains("td", "Balancing redox equations").should("be.visible");
    cy.contains("td", "Define electronegativity").should("be.visible");
    cy.contains("td", "Compute molar mass of glucose").should("be.visible");
    // The objective name, not the raw id, should be shown.
    cy.contains("td", "Stoichiometry").should("be.visible");
  });

  it("filters the table by search term", () => {
    cy.stubBackend("faculty");
    stubQuestionBank();
    cy.visitApp("/question-bank");

    cy.get('input[placeholder="Search questions..."]').type("redox");

    cy.contains("td", "Balancing redox equations").should("be.visible");
    cy.contains("td", "Define electronegativity").should("not.exist");
    cy.contains("td", "Compute molar mass of glucose").should("not.exist");
  });

  it("filters the table by status", () => {
    cy.stubBackend("faculty");
    stubQuestionBank();
    cy.visitApp("/question-bank");

    // The Status select is the fourth filter dropdown.
    cy.contains("label", "Status").parent().find("select").select("Approved");

    cy.contains("td", "Balancing redox equations").should("be.visible");
    cy.contains("td", "Define electronegativity").should("not.exist");
  });

  it("switches to the Learning Objectives tab", () => {
    cy.stubBackend("faculty");
    stubQuestionBank();
    cy.visitApp("/question-bank");

    cy.contains("button", "Learning Objectives").click();
    cy.location("search").should("contain", "tab=objectives");
    cy.contains("Manage Learning Objectives").should("be.visible");
  });

  it("shows the Add New Question control to faculty but not staff", () => {
    cy.stubBackend("faculty");
    stubQuestionBank();
    cy.visitApp("/question-bank");
    cy.contains("Add New Question").should("be.visible");

    cy.stubBackend("staff");
    stubQuestionBank();
    cy.visitApp("/question-bank");
    cy.contains("Balancing redox equations").should("be.visible");
    cy.contains("Add New Question").should("not.exist");
  });
});
