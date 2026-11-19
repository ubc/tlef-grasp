import { describe, expect, it } from "@jest/globals";
import { describeLeftOut, parseLeftOutHeader } from "../../client/src/lib/exports.js";

// The export's report of left-out questions (#63): positions into the quiz's
// question list, turned into titles for the export dialog.
const questions = [
  { title: "Synthetic choice", stem: "Select the best answer:" },
  { title: "", stem: "Double   {{x}}\nplease?" },
  { title: "A".repeat(100) },
];

describe("describeLeftOut", () => {
  it("is null when nothing was left out", () => {
    expect(describeLeftOut(null, questions)).toBeNull();
    expect(describeLeftOut({ count: 0, questions: [] }, questions)).toBeNull();
  });

  it("names each question by its title, falling back to its text, shortened", () => {
    const summary = {
      count: 4,
      questions: [
        { index: 0, reason: "First reason." },
        { index: 1, reason: "Second reason." },
        { index: 2, reason: "Third reason." },
      ],
    };
    expect(describeLeftOut(summary, questions)).toEqual({
      count: 4,
      questions: [
        { title: "Synthetic choice", reason: "First reason." },
        { title: "Double {{x}} please?", reason: "Second reason." },
        { title: `${"A".repeat(79)}…`, reason: "Third reason." },
      ],
    });
  });

  it("numbers a question it can't find", () => {
    expect(describeLeftOut({ count: 1, questions: [{ index: 7, reason: "Why." }] }, questions).questions)
      .toEqual([{ title: "Question 8", reason: "Why." }]);
  });
});

describe("parseLeftOutHeader", () => {
  it("reads the URI-encoded JSON the server sends", () => {
    const summary = { count: 1, questions: [{ index: 0, reason: "The formula uses sinh(), which Canvas doesn't support." }] };
    expect(parseLeftOutHeader(encodeURIComponent(JSON.stringify(summary)))).toEqual(summary);
  });

  it("is null for a missing or unreadable header", () => {
    expect(parseLeftOutHeader(null)).toBeNull();
    expect(parseLeftOutHeader("%E0%A4%A")).toBeNull();
    expect(parseLeftOutHeader("not json")).toBeNull();
  });
});
