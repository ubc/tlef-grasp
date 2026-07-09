const { test, expect } = require("@playwright/test");
const { BIO_PROF2_AUTH_FILE, BIO_STUDENT_AUTH_FILE } = require("./auth");
const { SEED } = require("./seed");
const { selectSeededCourse, startQuizFromList } = require("./helpers");

const IDP_ENABLED = process.env.E2E_SAML === "1";

test.describe("Quiz question flags", () => {
  test.skip(!IDP_ENABLED, "Requires the SAML IdP - run with E2E_SAML=1");

  test("a student reports a quiz question and an instructor reviews it", async ({ browser }) => {
    const reportComment = `E2E flag report ${Date.now()}`;
    const studentContext = await browser.newContext({ storageState: BIO_STUDENT_AUTH_FILE });
    const studentPage = await studentContext.newPage();

    try {
      await selectSeededCourse(studentPage, { role: "student" });
      await studentPage.goto("/quiz");
      await startQuizFromList(studentPage, SEED.QUIZ_NAME);
      await expect(studentPage.getByRole("heading", { name: SEED.QUIZ_NAME })).toBeVisible();

      await studentPage.getByRole("button", { name: "Report an issue with this question" }).click();
      await studentPage.getByRole("radio", { name: "Typo or formatting issue" }).check();
      await studentPage.getByLabel(/Add details/).fill(reportComment);
      await studentPage.getByRole("button", { name: "Report question" }).click();
      await expect(studentPage.getByText("Question flagged for your instructor")).toBeVisible();

      await studentPage.goto("/my-question-flags");
      await expect(studentPage.getByRole("heading", { name: "My Flagged Questions" })).toBeVisible();
      await expect(studentPage.getByText(reportComment)).toBeVisible();
      await expect(studentPage.getByText("pending", { exact: true })).toBeVisible();
    } finally {
      await studentContext.close();
    }

    const instructorContext = await browser.newContext({ storageState: BIO_PROF2_AUTH_FILE });
    const instructorPage = await instructorContext.newPage();
    try {
      await selectSeededCourse(instructorPage, { role: "instructor" });
      await instructorPage.goto("/question-flags");
      await expect(instructorPage.getByRole("heading", { name: "Student Question Flags" })).toBeVisible();
      await expect(instructorPage.getByText(reportComment)).toBeVisible();

      const report = instructorPage.locator("article").filter({ hasText: reportComment });
      await report.getByRole("combobox").selectOption("reviewed");
      await expect(report.getByRole("combobox")).toHaveValue("reviewed");
    } finally {
      await instructorContext.close();
    }
  });

  test("an instructor's student preview exposes and can use question flags", async ({
    browser,
  }) => {
    const reportComment = `Preview flag report ${Date.now()}`;
    const context = await browser.newContext({ storageState: BIO_PROF2_AUTH_FILE });
    const page = await context.newPage();
    try {
      // The role switch is a client-side view preference. The authenticated
      // account remains an instructor, which is the regression this protects.
      await selectSeededCourse(page, { role: "student" });
      await page.goto("/quiz");
      await expect(page.getByRole("link", { name: "My Flagged Questions" })).toBeVisible();
      await startQuizFromList(page, SEED.QUIZ_NAME);

      await page.getByRole("button", { name: "Report an issue with this question" }).click();
      await page.getByRole("radio", { name: "Other issue" }).check();
      await page.getByLabel(/Add details/).fill(reportComment);
      await page.getByRole("button", { name: "Report question" }).click();
      await expect(page.getByText("Question flagged for your instructor")).toBeVisible();

      await page.goto("/my-question-flags");
      await expect(page.getByRole("heading", { name: "My Flagged Questions" })).toBeVisible();
      await expect(page.getByText(reportComment)).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
