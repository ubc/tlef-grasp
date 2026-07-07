// Exercises the responsive sidebar (AppLayout.jsx + Sidebar.jsx): the permanent
// sidebar on desktop vs. the off-canvas drawer + hamburger on mobile.

describe("Responsive sidebar", () => {
  beforeEach(() => {
    cy.stubBackend("faculty");
  });

  it("shows a permanent sidebar and no hamburger on desktop", () => {
    cy.viewport(1280, 800);
    cy.visitApp("/dashboard");

    cy.get('[data-testid="open-sidebar"]').should("not.be.visible");
    cy.get("aside").contains("Question Bank").should("be.visible");
  });

  it("collapses the sidebar into a drawer on mobile", () => {
    cy.viewport("iphone-x");
    cy.visitApp("/dashboard");

    // Drawer starts closed: hamburger present, no backdrop in the DOM.
    cy.get('[data-testid="open-sidebar"]').should("be.visible");
    cy.get('[data-testid="sidebar-backdrop"]').should("not.exist");

    // Opening the drawer reveals the nav and the dismiss backdrop.
    cy.get('[data-testid="open-sidebar"]').click();
    cy.get('[data-testid="sidebar-backdrop"]').should("exist");
    cy.get("aside").contains("Question Bank").should("be.visible");

    // Closing it via the drawer's X button removes the drawer and backdrop.
    cy.get('[aria-label="Close navigation menu"]').click();
    cy.get('[data-testid="sidebar-backdrop"]').should("not.exist");
  });
});
