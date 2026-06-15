// Exercises CourseMaterials.jsx: rendering material cards from the API and the
// empty-state behaviour that auto-opens the upload section.

describe("Course Materials", () => {
  it("renders the materials returned for the course", () => {
    cy.stubBackend("faculty");
    cy.intercept("GET", "/api/material/course/*", {
      statusCode: 200,
      body: {
        success: true,
        materials: [
          {
            sourceId: "m1",
            documentTitle: "Lecture 1 - Atomic Structure.pdf",
            fileType: "application/pdf",
            fileSize: 248000,
            createdAt: "2025-09-02T00:00:00.000Z",
          },
          {
            sourceId: "m2",
            documentTitle: "Reaction notes",
            fileType: "text/plain",
            fileSize: 1200,
            createdAt: "2025-09-05T00:00:00.000Z",
          },
        ],
      },
    }).as("materials");
    cy.visitApp("/course-materials");

    cy.contains("Lecture 1 - Atomic Structure.pdf").should("be.visible");
    cy.contains("Reaction notes").should("be.visible");
    cy.contains("PDF").should("be.visible");
  });

  it("opens the upload section automatically when the course has no materials", () => {
    cy.stubBackend("faculty");
    cy.intercept("GET", "/api/material/course/*", {
      statusCode: 200,
      body: { success: true, materials: [] },
    }).as("materials");
    cy.visitApp("/course-materials");

    cy.contains("Drag and drop or choose file").should("be.visible");
    cy.contains("button", "Choose file").should("be.visible");
  });
});
