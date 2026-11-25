import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { promptOf, isGenericStem } from "../../client/src/lib/questionPrompt.js";

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
