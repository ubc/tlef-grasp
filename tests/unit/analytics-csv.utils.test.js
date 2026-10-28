const {
  NOT_ENOUGH_DATA,
  cell,
  toCsv,
  htmlToText,
  questionsCsv,
  quizzesCsv,
  objectivesCsv,
} = require("../../src/utils/analytics-csv");

// Parsed rows, without the byte-order mark. Good enough for these fixtures,
// whose quoted cells hold no line breaks.
const rowsOf = (csv) => csv.replace(/^﻿/, "").trim().split("\r\n");

describe("cell", () => {
  it("quotes text holding commas, quotes or line breaks", () => {
    expect(cell('Say "hi", then go')).toBe('"Say ""hi"", then go"');
    expect(cell("two\nlines")).toBe('"two\nlines"');
    expect(cell("plain")).toBe("plain");
  });

  it("neutralizes text a spreadsheet would run as a formula", () => {
    expect(cell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(cell("+1")).toBe("'+1");
    expect(cell("-2")).toBe("'-2");
    expect(cell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("writes numbers as numbers and empties as blank", () => {
    expect(cell(-2)).toBe("-2");
    expect(cell(0)).toBe("0");
    expect(cell(null)).toBe("");
    expect(cell(undefined)).toBe("");
    expect(cell(NaN)).toBe("");
  });
});

describe("toCsv", () => {
  it("starts with a byte-order mark and uses CRLF line endings", () => {
    expect(toCsv(["a", "b"], [[1, 2]])).toBe("﻿a,b\r\n1,2\r\n");
  });
});

describe("htmlToText", () => {
  it("drops tags and decodes common entities", () => {
    expect(htmlToText("<p>x &lt; 2 &amp;&nbsp;y</p><p>next</p>")).toBe("x < 2 & y next");
    expect(htmlToText(null)).toBe("");
  });
});

describe("questionsCsv", () => {
  const base = {
    questionType: "multiple-choice", bloom: "Apply", pending: 0, students: 6,
  };

  it("writes one row per question with option counts and the correct option", () => {
    const csv = questionsCsv({
      questions: [
        {
          ...base, text: "<b>Pick</b> one", responses: 6, enoughData: true, correct: 4, incorrect: 2,
          pValue: 2 / 3, difficulty: "moderate",
          options: [
            { key: "A", count: 4, isCorrect: true },
            { key: "B", count: 2, isCorrect: false },
          ],
        },
      ],
    });
    const [header, row] = rowsOf(csv);
    expect(header).toBe(
      "Question,Type,Bloom level,Graded responses,Students,Awaiting grading,Correct (%),Difficulty," +
      "Correct responses,Missed,Correct option,Chose A,Chose B"
    );
    expect(row).toBe("Pick one,multiple-choice,Apply,6,6,0,66.7,Moderate,4,2,A,4,2");
  });

  it("marks withheld figures instead of leaving out the row", () => {
    const csv = questionsCsv({
      questions: [
        {
          ...base, text: "Rated", responses: 6, enoughData: true, correct: 6, incorrect: 0,
          pValue: 1, difficulty: "easy", options: [{ key: "A", count: 6, isCorrect: true }],
        },
        {
          ...base, text: "Too few", responses: 2, students: 2, enoughData: false, correct: null,
          incorrect: null, pValue: null, difficulty: "insufficient", options: null,
        },
      ],
    });
    expect(rowsOf(csv)[2]).toBe(
      `Too few,multiple-choice,Apply,2,2,0,${NOT_ENOUGH_DATA},${NOT_ENOUGH_DATA},` +
      `${NOT_ENOUGH_DATA},${NOT_ENOUGH_DATA},,${NOT_ENOUGH_DATA}`
    );
  });
});

describe("quizzesCsv", () => {
  it("writes scores and the distribution, withheld below the minimums", () => {
    const distribution = ["0-9", "10-19", "20-29", "30-39", "40-49", "50-59", "60-69", "70-79", "80-89", "90-100"]
      .map((label, i) => ({ label, count: i === 9 ? 5 : 0 }));
    const csv = quizzesCsv({
      quizzes: [
        {
          name: "=Quiz 1", assigned: 6, submitted: 5, completionRate: 5 / 6, enoughData: true,
          meanScore: 95, medianScore: 94.5, averageTimeSpent: 630000, distribution, pendingSubmissions: 1,
        },
        {
          name: "Quiz 2", assigned: 6, submitted: 2, completionRate: 2 / 6, enoughData: false,
          meanScore: null, medianScore: null, averageTimeSpent: null, distribution: null, pendingSubmissions: 0,
        },
      ],
    });
    const [header, first, second] = rowsOf(csv);
    expect(header).toContain("Scored 90-100%");
    expect(first).toBe("'=Quiz 1,6,5,83.3,95,94.5,10.5,0,0,0,0,0,0,0,0,0,5,1");
    expect(second.split(",").slice(0, 7)).toEqual([
      "Quiz 2", "6", "2", "33.3", NOT_ENOUGH_DATA, NOT_ENOUGH_DATA, NOT_ENOUGH_DATA,
    ]);
  });
});

describe("objectivesCsv", () => {
  it("lists objectives then their sub-objectives, with mastery and remediation", () => {
    const row = (name, extra) => ({
      name, responses: 10, studentsAssessed: 5, pending: 0, enoughData: true, pValue: 0.5,
      masteryJudged: 5, enoughMasteryData: true, mastered: 2, masteryRate: 0.4,
      remediationTracked: 5, enoughRemediationData: true, needsRemediation: 1, remediationRate: 0.2,
      ...extra,
    });
    const csv = objectivesCsv({
      objectives: [
        {
          ...row("Limits"),
          granular: [row("Evaluate limits", {
            enoughRemediationData: false, needsRemediation: null, remediationRate: null, remediationTracked: 0,
          })],
        },
      ],
    });
    const [, parent, child] = rowsOf(csv);
    expect(parent).toBe("Limits,Objective,,50,10,5,0,5,2,40,5,1,20");
    expect(child).toBe(`Evaluate limits,Sub-objective,Limits,50,10,5,0,5,2,40,0,${NOT_ENOUGH_DATA},${NOT_ENOUGH_DATA}`);
  });
});
