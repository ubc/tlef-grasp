jest.mock("../../src/services/database", () => ({ connect: jest.fn() }));
jest.mock("../../src/services/user-course", () => ({ getCourseUsers: jest.fn() }));
jest.mock("../../src/services/course-section", () => ({ getSectionsForViewer: jest.fn() }));
jest.mock("../../src/utils/auth", () => ({
  ...jest.requireActual("../../src/utils/auth"),
  isFaculty: jest.fn(),
}));

const {
  summarizeQuestionStats,
  summarizeQuizStats,
  summarizeObjectiveStats,
  difficultyBand,
  getCohortStudentIds,
} = require("../../src/services/analytics");
const { getCourseUsers } = require("../../src/services/user-course");
const { getSectionsForViewer } = require("../../src/services/course-section");
const { isFaculty } = require("../../src/utils/auth");

const mcQuestion = (id, extra = {}) => ({
  _id: id,
  title: `Question ${id}`,
  questionType: "multiple-choice",
  options: { A: { text: "Alpha" }, B: { text: "Beta" }, C: { text: "Gamma" } },
  correctAnswer: "A",
  ...extra,
});

// One answer per pick, each from a different student.
const answers = (questionId, picks) =>
  picks.map((pick, i) => ({
    userId: `student-${i}`,
    questionId,
    selectedAnswer: pick,
    isCorrect: pick === "A",
  }));

describe("summarizeQuestionStats", () => {
  it("computes the difficulty index from graded responses only", () => {
    const attempts = [
      ...answers("q1", ["A", "A", "A", "B", "C"]),
      { questionId: "q1", isCorrect: null },
    ];
    const { questions, summary } = summarizeQuestionStats(attempts, [mcQuestion("q1")]);

    expect(questions[0]).toMatchObject({
      responses: 5,
      pending: 1,
      correct: 3,
      incorrect: 2,
      pValue: 0.6,
      difficulty: "moderate",
      enoughData: true,
    });
    expect(summary).toMatchObject({ gradedResponses: 5, pendingResponses: 1, ratedQuestions: 1 });
  });

  it("withholds every figure for a question below the response minimum", () => {
    const { questions, summary, mostMissed } = summarizeQuestionStats(
      answers("q1", ["B", "C", "A", "B"]),
      [mcQuestion("q1")]
    );

    expect(questions[0]).toMatchObject({
      responses: 4,
      enoughData: false,
      correct: null,
      incorrect: null,
      pValue: null,
      difficulty: "insufficient",
      options: null,
    });
    expect(mostMissed).toEqual([]);
    expect(summary.averagePValue).toBeNull();
    expect(summary.bands.insufficient).toBe(1);
  });

  it("does not count pending answers toward the response minimum", () => {
    const attempts = [
      ...answers("q1", ["A", "B", "A", "A"]),
      { questionId: "q1", isCorrect: null },
      { questionId: "q1", isCorrect: null },
    ];
    const { questions } = summarizeQuestionStats(attempts, [mcQuestion("q1")]);
    expect(questions[0].enoughData).toBe(false);
  });

  it("breaks multiple-choice answers down by option and marks the correct one", () => {
    const { questions } = summarizeQuestionStats(
      answers("q1", ["A", "B", "B", "B", "C"]),
      [mcQuestion("q1")]
    );

    expect(questions[0].options).toEqual([
      { key: "A", text: "Alpha", count: 1, isCorrect: true },
      { key: "B", text: "Beta", count: 3, isCorrect: false },
      { key: "C", text: "Gamma", count: 1, isCorrect: false },
    ]);
  });

  it("gives no option breakdown for other question types", () => {
    const attempts = Array.from({ length: 5 }, () => ({
      questionId: "q1", isCorrect: true, selectedAnswer: "42",
    }));
    const { questions } = summarizeQuestionStats(attempts, [
      { _id: "q1", title: "Calc", questionType: "calculation" },
    ]);
    expect(questions[0].options).toBeNull();
  });

  it("ranks the most missed questions by wrong answers, then by difficulty", () => {
    const attempts = [
      ...answers("few", ["B", "B", "B", "B"]), // below the minimum: never ranked
      ...answers("q1", ["A", "A", "A", "B", "B"]),
      ...answers("q2", ["A", "B", "B", "B", "B", "B", "A", "A", "A", "A"]),
      ...answers("q3", ["B", "B", "B", "B", "B"]),
      ...answers("q4", ["A", "A", "A", "A", "A"]),
    ];
    const { mostMissed } = summarizeQuestionStats(
      attempts,
      ["few", "q1", "q2", "q3", "q4"].map((id) => mcQuestion(id))
    );

    // q2 and q3 both have 5 wrong; q3 is harder (0% vs 50%). q4 has none.
    expect(mostMissed).toEqual(["q3", "q2", "q1"]);
  });

  it("lists questions nobody has answered with no data", () => {
    const { questions, summary } = summarizeQuestionStats([], [mcQuestion("q1")]);
    expect(questions[0]).toMatchObject({ responses: 0, enoughData: false, difficulty: "insufficient" });
    expect(summary.totalQuestions).toBe(1);
  });

  it("never exposes who answered", () => {
    const attempts = answers("q1", ["A", "A", "A", "A", "B"]).map((attempt, i) => ({
      ...attempt,
      userId: `student-${i}`,
    }));
    const result = summarizeQuestionStats(attempts, [mcQuestion("q1")]);
    expect(JSON.stringify(result)).not.toContain("student-");
  });

  it("withholds a question answered many times by too few different students", () => {
    // Six responses (the same question served in several quizzes) but only
    // two students behind them.
    const attempts = answers("q1", ["A", "B", "A", "A", "B", "A"]).map((attempt, i) => ({
      ...attempt,
      userId: i % 2 ? "s1" : "s2",
    }));
    const { questions, mostMissed } = summarizeQuestionStats(attempts, [mcQuestion("q1")]);

    expect(questions[0]).toMatchObject({
      responses: 6, students: 2, enoughData: false, pValue: null, options: null,
    });
    expect(mostMissed).toEqual([]);
  });

  it("rates a question once the student minimum is met too", () => {
    const attempts = answers("q1", ["A", "B", "A", "A", "B"]).map((attempt, i) => ({
      ...attempt,
      userId: `s${i % 3}`,
    }));
    const { questions } = summarizeQuestionStats(attempts, [mcQuestion("q1")]);
    expect(questions[0]).toMatchObject({ responses: 5, students: 3, enoughData: true, pValue: 0.6 });
  });

  it("takes the thresholds as a parameter, so the student minimum can be raised", () => {
    const attempts = answers("q1", ["A", "A", "A", "A", "B"]).map((attempt, i) => ({
      ...attempt,
      userId: `s${i % 4}`,
    }));
    const raised = summarizeQuestionStats(attempts, [mcQuestion("q1")], { minResponses: 5, minStudents: 5 });
    expect(raised.questions[0].enoughData).toBe(false);
  });
});

describe("difficultyBand", () => {
  it.each([
    [0.9, "easy"],
    [0.85, "moderate"],
    [0.3, "moderate"],
    [0.29, "hard"],
    [null, "insufficient"],
  ])("rates %p as %s", (pValue, band) => {
    expect(difficultyBand(pValue)).toBe(band);
  });
});

describe("getCohortStudentIds", () => {
  const member = (userId, sections, affiliation = ["student"], extra = {}) => ({
    userId,
    sections,
    user: { affiliation, ...extra.user },
    ...extra.membership,
  });

  beforeEach(() => {
    isFaculty.mockImplementation(async (user) => user.affiliation.includes("faculty"));
    getCourseUsers.mockResolvedValue([
      member("s1", ["101"]),
      member("s2", ["102"]),
      member("ta", ["101"], ["student", "staff"], {
        user: { staffViaTaPromotion: true },
        membership: { courseRole: "ta" },
      }),
      member("prof", [], ["faculty"]),
    ]);
  });

  it("includes only students, never instructors or TAs", async () => {
    getSectionsForViewer.mockResolvedValue({ seeAll: true, sections: [] });
    await expect(getCohortStudentIds("course", {})).resolves.toEqual(["s1", "s2"]);
  });

  it("limits a non-owner to their own sections", async () => {
    getSectionsForViewer.mockResolvedValue({ seeAll: false, sections: [{ sectionId: "102" }] });
    await expect(getCohortStudentIds("course", {})).resolves.toEqual(["s2"]);
  });

  it("narrows to one section when asked", async () => {
    getSectionsForViewer.mockResolvedValue({ seeAll: true, sections: [] });
    await expect(getCohortStudentIds("course", {}, { sectionId: "101" })).resolves.toEqual(["s1"]);
  });
});

describe("summarizeQuizStats", () => {
  const students = [
    ...["a", "b", "c", "d", "e", "f"].map((id) => ({ userId: id, sections: ["101"] })),
    { userId: "x", sections: ["102"] },
  ];
  const score = (userId, value, timeSpent = 600000) => ({ quizId: "q1", userId, score: value, timeSpent });
  const run = (scores, scheduled = ["101"], pending = []) =>
    summarizeQuizStats({
      quizzes: [{ _id: "q1", name: "Quiz 1" }],
      students,
      scheduledSections: new Map([["q1", new Set(scheduled)]]),
      scores,
      pendingUsers: new Map([["q1", new Set(pending)]]),
    });

  it("computes completion over students the quiz is scheduled for", () => {
    const { quizzes } = run([score("a", 80), score("b", 60)]);
    expect(quizzes[0]).toMatchObject({ assigned: 6, submitted: 2, completionRate: 2 / 6 });
  });

  it("counts a submitter outside the scheduled sections as assigned", () => {
    const { quizzes } = run([score("x", 50)]);
    expect(quizzes[0]).toMatchObject({ assigned: 7, submitted: 1 });
  });

  it("gives mean, median, time and a 10-point distribution once there are enough submissions", () => {
    const { quizzes, summary } = run(
      [score("a", 100, 300000), score("b", 90, 600000), score("c", 55), score("d", 50), score("e", 5)],
      ["101"],
      ["c"]
    );

    expect(quizzes[0]).toMatchObject({
      enoughData: true,
      meanScore: 60,
      medianScore: 55,
      pendingSubmissions: 1,
    });
    expect(quizzes[0].averageTimeSpent).toBe(540000);
    const counts = Object.fromEntries(quizzes[0].distribution.map((bin) => [bin.label, bin.count]));
    expect(counts).toMatchObject({ "0–9": 1, "50–59": 2, "90–100": 2, "60–69": 0 });
    expect(summary).toMatchObject({ submitted: 5, meanScore: 60 });
  });

  it("withholds scores below the submission minimum but keeps participation", () => {
    const { quizzes, summary } = run([score("a", 100), score("b", 0)]);
    expect(quizzes[0]).toMatchObject({
      submitted: 2,
      enoughData: false,
      meanScore: null,
      medianScore: null,
      averageTimeSpent: null,
      distribution: null,
    });
    expect(summary.meanScore).toBeNull();
  });

  it("never exposes who submitted", () => {
    const result = run(["a", "b", "c", "d", "e"].map((id) => score(id, 70)), ["101"], ["a"]);
    expect(JSON.stringify(result)).not.toMatch(/"(a|b|c|d|e)"/);
  });
});

describe("summarizeObjectiveStats", () => {
  const objectives = [
    { _id: "p1", name: "Limits", parent: 0 },
    { _id: "g1", name: "Evaluate limits", parent: "p1" },
    { _id: "g2", name: "Discontinuities", parent: "p1" },
    { _id: "p2", name: "Derivatives", parent: 0 },
  ];
  const answer = (userId, granularObjectiveId, isCorrect, questionId = "q1", learningObjectiveId = "p1") => ({
    userId, questionId, isCorrect, granularObjectiveId, learningObjectiveId,
  });

  it("rates granular objectives and rolls them up into their parent", () => {
    const attempts = [
      ...["a", "b", "c", "d", "e"].map((u, i) => answer(u, "g1", i < 4, "q1")),
      ...["a", "b", "c"].map((u) => answer(u, "g2", false, "q2")),
      answer("a", "g2", null, "q3"),
    ];
    const { objectives: rows, summary } = summarizeObjectiveStats(attempts, objectives);

    const [limits, derivatives] = rows;
    expect(limits).toMatchObject({
      name: "Limits",
      responses: 8,
      pending: 1,
      pValue: 4 / 8,
      questionsAssessed: 2,
      studentsAssessed: 5,
    });
    expect(limits.granular[0]).toMatchObject({ name: "Evaluate limits", responses: 5, pValue: 0.8 });
    expect(limits.granular[1]).toMatchObject({
      name: "Discontinuities", responses: 3, enoughData: false, pValue: null,
    });
    expect(derivatives).toMatchObject({ responses: 0, enoughData: false, granular: [] });
    expect(summary).toMatchObject({ totalObjectives: 2, ratedObjectives: 1, weakestObjectiveId: "p1" });
  });

  it("counts an answer filed only under a parent objective toward that parent", () => {
    const attempts = ["a", "b", "c", "d", "e"].map((u) => answer(u, null, true, "q9", "p2"));
    const { objectives: rows } = summarizeObjectiveStats(attempts, objectives);
    expect(rows[1]).toMatchObject({ responses: 5, pValue: 1 });
  });

  it("rates mastery among students with enough answers to judge", () => {
    // a, b: 2/2 (mastered); c: 1/2 (not); d: 4/5 (80%, mastered);
    // e: one answer only, so not judged.
    const attempts = [
      answer("a", "g1", true, "q1"), answer("a", "g1", true, "q2"),
      answer("b", "g1", true, "q1"), answer("b", "g1", true, "q2"),
      answer("c", "g1", true, "q1"), answer("c", "g1", false, "q2"),
      ...[true, true, false, true, true].map((ok, i) => answer("d", "g1", ok, `q${i}`)),
      answer("e", "g1", false, "q1"),
    ];
    const { objectives: rows, summary } = summarizeObjectiveStats(attempts, objectives);

    expect(rows[0].granular[0]).toMatchObject({
      masteryJudged: 4,
      enoughMasteryData: true,
      mastered: 3,
      masteryRate: 0.75,
    });
    expect(summary.averageMasteryRate).toBe(0.75);
  });

  it("withholds mastery when too few students have enough answers", () => {
    const attempts = [
      ...["a", "b"].flatMap((u) => [answer(u, "g1", true, "q1"), answer(u, "g1", true, "q2")]),
      ...["c", "d", "e"].map((u) => answer(u, "g1", true, "q1")),
    ];
    const { objectives: rows } = summarizeObjectiveStats(attempts, objectives);
    expect(rows[0].granular[0]).toMatchObject({
      enoughData: true,
      masteryJudged: 2,
      enoughMasteryData: false,
      mastered: null,
      masteryRate: null,
    });
  });

  it("takes the mastery threshold as a parameter", () => {
    const attempts = ["a", "b", "c"].flatMap((u) => [
      answer(u, "g1", true, "q1"), answer(u, "g1", true, "q2"), answer(u, "g1", false, "q3"),
    ]);
    const strict = summarizeObjectiveStats(attempts, objectives);
    const lenient = summarizeObjectiveStats(attempts, objectives, { mastery: { threshold: 0.6, minAnswers: 2 } });
    expect(strict.objectives[0].granular[0].masteryRate).toBe(0);
    expect(lenient.objectives[0].granular[0].masteryRate).toBe(1);
  });

  it("counts students the adaptive engine flags for remediation and ranks objectives by it", () => {
    const flag = (userId, learningObjectiveId, needsRemediation, granularObjectiveId = null) => ({
      userId, learningObjectiveId, granularObjectiveId, needsRemediation,
    });
    const performance = [
      ...["a", "b", "c", "d"].map((u, i) => flag(u, "p1", i < 1)),
      ...["a", "b", "c", "d"].map((u, i) => flag(u, "p2", i < 3)),
      // A granular-only engine row (question without a parent objective).
      ...["a", "b", "c"].map((u) => flag(u, null, true, "g2")),
    ];
    const { objectives: rows, summary } = summarizeObjectiveStats([], objectives, { performance });

    expect(rows[0]).toMatchObject({ remediationTracked: 4, needsRemediation: 1, remediationRate: 0.25 });
    expect(rows[1]).toMatchObject({ needsRemediation: 3, remediationRate: 0.75 });
    expect(rows[0].granular[1]).toMatchObject({ needsRemediation: 3, remediationRate: 1 });
    // g2 and p2 both have 3 flagged; g2's larger share ranks it first.
    expect(summary.remediationRanking).toEqual(["g2", "p2", "p1"]);
  });

  it("withholds remediation counts over too few students", () => {
    const performance = ["a", "b"].map((userId) => ({ userId, learningObjectiveId: "p1", needsRemediation: true }));
    const { objectives: rows, summary } = summarizeObjectiveStats([], objectives, { performance });
    expect(rows[0]).toMatchObject({ remediationTracked: 2, enoughRemediationData: false, needsRemediation: null });
    expect(summary.remediationRanking).toEqual([]);
  });

  it("withholds an objective whose responses come from too few students", () => {
    const attempts = ["a", "b", "a", "b", "a", "b"].map((u, i) => answer(u, "g1", true, `q${i}`));
    const { objectives: rows } = summarizeObjectiveStats(attempts, objectives);
    expect(rows[0].granular[0]).toMatchObject({
      responses: 6, studentsAssessed: 2, enoughData: false, pValue: null,
    });
  });

  it("does not count pending answers toward the response minimum", () => {
    const attempts = [
      ...["a", "b", "c", "d"].map((u) => answer(u, "g1", true)),
      answer("e", "g1", null),
    ];
    const { objectives: rows } = summarizeObjectiveStats(attempts, objectives);
    expect(rows[0].granular[0]).toMatchObject({ responses: 4, pending: 1, enoughData: false });
  });
});
