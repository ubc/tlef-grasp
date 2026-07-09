const { test, expect } = require("@playwright/test");
const { expectNoA11yViolations } = require("./axe-helper");
const { BIO_PROF2_AUTH_FILE, BIO_STUDENT_AUTH_FILE } = require("../e2e/auth");
const { SEED } = require("../e2e/seed");
const {
  IDP_ENABLED,
  prepareSeededInstructorCourse,
  prepareSeededStudentCourse,
} = require("./authenticated-helper");

test.describe("Accessibility: quiz question flags", () => {
  test.skip(!IDP_ENABLED, "Requires the SAML IdP - run with E2E_SAML=1");

  test("student flag picker and My Flagged Questions have no blocking axe violations", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: BIO_STUDENT_AUTH_FILE });
    const page = await context.newPage();
    try {
      await prepareSeededStudentCourse(page);
      await page.goto("/quiz");
      await page.getByRole("button", { name: /Start Quiz|Retake Quiz/ }).click();
      await expect(page.getByRole("heading", { name: SEED.QUIZ_NAME })).toBeVisible();

      await page.getByRole("button", { name: "Report an issue with this question" }).click();
      await expect(page.getByRole("group", { name: "What is the issue?" })).toBeVisible();
      await expect(page.getByLabel(/Add details/)).toBeVisible();
      await expectNoA11yViolations(page);

      await page.goto("/my-question-flags");
      await expect(page.getByRole("heading", { name: "My Flagged Questions" })).toBeVisible();
      await expectNoA11yViolations(page);
    } finally {
      await context.close();
    }
  });

  test("instructor question-flag page has no blocking axe violations", async ({ browser }) => {
    const context = await browser.newContext({ storageState: BIO_PROF2_AUTH_FILE });
    const page = await context.newPage();
    try {
      await prepareSeededInstructorCourse(page);
      await page.goto("/question-flags");
      await expect(page.getByRole("heading", { name: "Student Question Flags" })).toBeVisible();
      await expect(page.getByLabel("Status")).toBeVisible();
      await expectNoA11yViolations(page);
    } finally {
      await context.close();
    }
  });
});
