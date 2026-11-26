import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { promptOf, isGenericStem, titleAndStem } from "../../client/src/lib/questionPrompt.js";

// The same cases the server's promptOf runs against
// (tests/unit/question-prompt.utils.test.js), so the two copies can't drift.
const cases = JSON.parse(
  readFileSync(new URL("../fixtures/question-prompt-cases.json", import.meta.url), "utf8")
);

describe("promptOf", () => {
  it.each(cases.promptOf.map((c) => [c.name, c]))("%s", (_name, { question, expected }) => {
    expect(promptOf(question)).toBe(expected);
  });
});

describe("isGenericStem", () => {
  it.each(cases.isGenericStem.map((c) => [JSON.stringify(c.stem), c]))("%s", (_stem, { stem, expected }) => {
    expect(isGenericStem(stem)).toBe(expected);
  });
});

// Instructor lists show the title, with the stem beneath it for reference.
describe("titleAndStem", () => {
  it("shows a wizard question's label and its question", () => {
    expect(titleAndStem({ title: "Kinetic energy formula", stem: "What is the kinetic energy?" }))
      .toEqual({ title: "Kinetic energy formula", stem: "What is the kinetic energy?" });
  });

  it("leaves out a generic stem", () => {
    expect(titleAndStem({ title: "What is 2 + 2?", stem: "Select the best answer:" }))
      .toEqual({ title: "What is 2 + 2?", stem: "" });
  });

  it("leaves out a stem that repeats the title", () => {
    expect(titleAndStem({ title: "Which are noble gases?", stem: " Which are noble gases? " }))
      .toEqual({ title: "Which are noble gases?", stem: "" });
  });

  it("names a question without a title by its question text", () => {
    expect(titleAndStem({ stem: "The ___ is..." })).toEqual({ title: "The ___ is...", stem: "" });
    expect(titleAndStem({ question: "Legacy?" })).toEqual({ title: "Legacy?", stem: "" });
    expect(titleAndStem(null)).toEqual({ title: "", stem: "" });
  });
});
