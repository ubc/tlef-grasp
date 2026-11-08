const {
  MIN_STUDENTS_ITEM_ANALYSIS,
  discriminationIndex,
  pointBiserial,
  pointBiserialBand,
  discriminationBand,
  reliabilityBand,
  itemFlag,
  buildResponseMatrices,
  analyzeQuizItems,
  quizReliability,
  analyzeItems,
} = require("../../src/services/item-analysis");

// Answer rows for one quiz from a score matrix: one row per student, one
// column per question (q0, q1, ...).
const attemptsFrom = (matrix, quizId = "quiz-1", userPrefix = "s") =>
  matrix.flatMap((row, i) =>
    row.map((score, j) =>
      score === null
        ? null
        : { userId: `${userPrefix}${i}`, quizId, questionId: `q${j}`, isCorrect: score === 1 }
    ).filter(Boolean)
  );

// Reference values computed independently (Pearson correlation of the item
// with the rest score, KR-20 from population variances).
const MATRIX = [
  [1, 1, 1, 1],
  [1, 1, 1, 0],
  [1, 1, 0, 0],
  [1, 0, 1, 0],
  [0, 1, 0, 0],
  [1, 0, 0, 1],
  [0, 0, 0, 0],
];

const quizOf = (matrix) => buildResponseMatrices(attemptsFrom(matrix)).get("quiz-1");

describe("pointBiserial", () => {
  it("equals the correlation of the item with the rest score", () => {
    const items = analyzeQuizItems(quizOf(MATRIX));
    expect(items.get("q0").pointBiserial).toBeCloseTo(0.564, 3);
    expect(items.get("q1").pointBiserial).toBeCloseTo(0.079, 3);
    expect(items.get("q2").pointBiserial).toBeCloseTo(0.411, 3);
    expect(items.get("q3").pointBiserial).toBeCloseTo(0.175, 3);
  });

  it("is null when everyone got the item right, or everyone has the same rest score", () => {
    expect(pointBiserial([{ item: 1, rest: 0.2 }, { item: 1, rest: 0.8 }])).toBeNull();
    expect(pointBiserial([{ item: 1, rest: 0.5 }, { item: 0, rest: 0.5 }])).toBeNull();
  });

  it("is negative when weaker students got the item right more often", () => {
    const rows = [{ item: 0, rest: 1 }, { item: 0, rest: 0.8 }, { item: 1, rest: 0.2 }, { item: 1, rest: 0 }];
    expect(pointBiserial(rows)).toBeLessThan(0);
  });
});

describe("discriminationIndex", () => {
  it("compares the upper and lower 27% by rest score", () => {
    const items = analyzeQuizItems(quizOf(MATRIX));
    // 7 students: groups of round(0.27 × 7) = 2.
    expect(items.get("q0").discrimination).toBeCloseTo(0.625, 3);
    expect(items.get("q1").discrimination).toBeCloseTo(0.167, 3);
    expect(items.get("q2").discrimination).toBeCloseTo(0.417, 3);
    expect(items.get("q3").discrimination).toBeCloseTo(0.25, 3);
  });

  it("matches the textbook example: (Up − Lp) / group size", () => {
    // 100 students; the top 27 all right, the bottom 27 all wrong.
    const rows = Array.from({ length: 100 }, (_, i) => ({ rest: i / 100, item: i >= 73 ? 1 : 0 }));
    expect(discriminationIndex(rows)).toBe(1);
  });

  it("shares places among students tied at the cut-off, whatever order they are listed in", () => {
    const rows = [
      { rest: 1, item: 1 },
      { rest: 0.5, item: 1 },
      { rest: 0.5, item: 0 },
      { rest: 0, item: 0 },
    ];
    // Group size 1: the top is one student, the bottom one student.
    expect(discriminationIndex(rows)).toBe(1);
    expect(discriminationIndex([...rows].reverse())).toBe(1);

    const tiedTop = [{ rest: 1, item: 1 }, { rest: 1, item: 0 }, { rest: 0, item: 0 }];
    expect(discriminationIndex(tiedTop)).toBe(0.5);
    expect(discriminationIndex([...tiedTop].reverse())).toBe(0.5);
  });

  it("uses groups of at least one student with a small class", () => {
    const rows = [{ rest: 1, item: 1 }, { rest: 0.5, item: 1 }, { rest: 0, item: 0 }];
    expect(discriminationIndex(rows)).toBe(1);
  });
});

describe("analyzeQuizItems", () => {
  it(`rates an item from ${MIN_STUDENTS_ITEM_ANALYSIS} students and marks small groups`, () => {
    const items = analyzeQuizItems(quizOf([[1, 1], [1, 0], [0, 0]]));
    expect(items.get("q0")).toMatchObject({ students: 3, enoughData: true, lowN: true });

    const tooFew = analyzeQuizItems(quizOf([[1, 1], [0, 0]]));
    expect(tooFew.get("q0")).toMatchObject({
      students: 2, enoughData: false, discrimination: null, pointBiserial: null, flag: null,
    });
  });

  it("leaves out a student with only one graded answer, who has no rest score", () => {
    const items = analyzeQuizItems(quizOf([[1, 1], [1, 0], [0, 0], [1, null]]));
    expect(items.get("q0").students).toBe(3);
  });

  it("ignores answers awaiting grading", () => {
    const attempts = [
      ...attemptsFrom([[1, 1], [1, 0], [0, 0]]),
      { userId: "s9", quizId: "quiz-1", questionId: "q0", isCorrect: null },
      { userId: "s9", quizId: "quiz-1", questionId: "q1", isCorrect: null },
    ];
    expect(analyzeQuizItems(buildResponseMatrices(attempts).get("quiz-1")).get("q0").students).toBe(3);
  });

  it("flags an item that weaker students got right more often as possibly miskeyed", () => {
    const items = analyzeQuizItems(quizOf([
      [1, 1, 1, 0],
      [1, 1, 0, 0],
      [1, 0, 1, 0],
      [0, 0, 0, 1],
      [0, 0, 0, 1],
    ]));
    expect(items.get("q3").pointBiserialBand).toBe("negative");
    expect(items.get("q3").flag).toBe("miskeyed");
  });
});

describe("quizReliability", () => {
  it("computes KR-20 and the standard error of measurement", () => {
    const reliability = quizReliability(quizOf(MATRIX));
    expect(reliability.kr20).toBeCloseTo(0.495, 3);
    expect(reliability.sem).toBeCloseTo(21.2, 1);
    expect(reliability).toMatchObject({ items: 4, students: 7, band: "low", lowN: true, reason: null });
  });

  it("uses only the questions every student answered", () => {
    // A spaced quiz: q2 was served to only some students.
    const reliability = quizReliability(quizOf([
      [1, 1, 1],
      [1, 0, null],
      [0, 0, 0],
      [1, 1, null],
    ]));
    expect(reliability.items).toBe(2);
    expect(reliability.kr20).not.toBeNull();
  });

  it("is withheld, with the reason, when students share fewer than two questions", () => {
    const reliability = quizReliability(quizOf([
      [1, 1, null, null],
      [null, null, 1, 0],
      [1, null, 0, null],
    ]));
    expect(reliability).toMatchObject({ kr20: null, reason: "different-questions" });
  });

  it("is withheld when everyone scored the same, or there are too few students", () => {
    expect(quizReliability(quizOf([[1, 0], [1, 0], [0, 1]])).reason).toBe("no-variance");
    expect(quizReliability(quizOf([[1, 0], [1, 1]])).reason).toBe("too-few-students");
  });
});

describe("analyzeItems", () => {
  it("analyzes each quiz separately and pools a question's figures, weighted by students", () => {
    const attempts = [
      ...attemptsFrom(MATRIX, "quiz-1", "a"),
      ...attemptsFrom([[1, 1], [1, 0], [0, 0]], "quiz-2", "b"),
    ];
    const { byQuiz, byQuestion } = analyzeItems(attempts, new Map([["quiz-1", "Week 1"], ["quiz-2", "Week 2"]]));

    expect([...byQuiz.keys()]).toEqual(["quiz-1", "quiz-2"]);
    const q0 = byQuestion.get("q0");
    const inQuiz1 = byQuiz.get("quiz-1").items.get("q0");
    const inQuiz2 = byQuiz.get("quiz-2").items.get("q0");
    expect(q0.students).toBe(10);
    expect(q0.quizzesRated).toBe(2);
    expect(q0.pointBiserial).toBeCloseTo((inQuiz1.pointBiserial * 7 + inQuiz2.pointBiserial * 3) / 10, 3);
    expect(q0.perQuiz.map((entry) => entry.quizName)).toEqual(["Week 1", "Week 2"]);
  });

  it("never exposes who answered", () => {
    const { byQuiz, byQuestion } = analyzeItems(attemptsFrom(MATRIX));
    const text = JSON.stringify({
      quizzes: [...byQuiz.values()].map(({ items, reliability }) => ({ items: [...items], reliability })),
      questions: [...byQuestion],
    });
    expect(text).not.toMatch(/"s\d"/);
  });
});

describe("bands and verdicts", () => {
  it("bands point-biserial at .1 and .3", () => {
    expect([-0.1, 0.05, 0.2, 0.3].map(pointBiserialBand)).toEqual(["negative", "poor", "moderate", "good"]);
  });

  it("bands the discrimination index by Ebel's guidelines", () => {
    expect([-0.1, 0.1, 0.25, 0.4].map(discriminationBand)).toEqual(["negative", "poor", "moderate", "good"]);
  });

  it("bands KR-20 at .7 and .8", () => {
    expect([0.5, 0.75, 0.85].map(reliabilityBand)).toEqual(["low", "acceptable", "good"]);
  });

  it("explains a poorly discriminating item by its difficulty", () => {
    expect(itemFlag({ pValue: 0.95, discrimination: 0.05, pointBiserial: 0.05 })).toBe("too-easy");
    expect(itemFlag({ pValue: 0.1, discrimination: 0.05, pointBiserial: 0.05 })).toBe("too-hard");
    expect(itemFlag({ pValue: 0.5, discrimination: 0.05, pointBiserial: 0.05 })).toBe("review");
    expect(itemFlag({ pValue: 0.5, discrimination: 0.4, pointBiserial: 0.35 })).toBe("good");
    expect(itemFlag({ pValue: 0.5, discrimination: 0.25, pointBiserial: 0.2 })).toBe("fair");
    expect(itemFlag({ pValue: 0.5, discrimination: -0.2, pointBiserial: -0.3 })).toBe("miskeyed");
    expect(itemFlag({ pValue: 0.5, discrimination: -0.2, pointBiserial: null })).toBe("miskeyed");
  });

  it("does not call a slightly negative item miskeyed, since chance alone produces those", () => {
    expect(itemFlag({ pValue: 0.5, discrimination: -0.05, pointBiserial: -0.08 })).toBe("review");
    expect(itemFlag({ pValue: 0.95, discrimination: 0, pointBiserial: -0.05 })).toBe("too-easy");
    expect(itemFlag({ pValue: 0.5, discrimination: null, pointBiserial: null })).toBeNull();
  });
});
