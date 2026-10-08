import { createRequire } from "node:module";
import { describe, expect, it } from "@jest/globals";
import {
  COURSE_EXPORT_MESSAGE,
  allImportsSelected,
  canvasCommitForm,
  canvasPreviewForm,
  commitQueue,
  commitQuizzesInOrder,
  describeImportProgress,
  describePreviewSummary,
  describeQuizCounts,
  describeRemoteImages,
  describeSkipReasonCounts,
  describeUnlinked,
  draftsToCheckLabel,
  groupSkippedByReason,
  importButtonLabel,
  initialSelections,
  isCanvasCourseExportFile,
  isCanvasExportFile,
  linkableCount,
  mergeCommitReports,
  predictedDraftsLabel,
  quizCanBeImported,
  quizHasWork,
  resultTotalsRows,
  slotLabel,
  summarizeSelection,
  withAllImports,
} from "../../client/src/lib/canvasImport.js";

// The server's zip reader and the synthetic zip builder its tests use, to
// check the client words the course-export guidance as the server does.
const require = createRequire(import.meta.url);
const { readCanvasPackage } = require("../../src/utils/canvas-qti-package.js");
const { buildExportZip, buildManifest } = require("../fixtures/canvas-qti/zip.js");

// One quiz of the server's PreviewReport. `items` is new + already imported +
// skipped, as the server counts it.
const quiz = (overrides = {}) => ({
  ident: "g1",
  title: "Thermo 1",
  flavour: "classic",
  dueAt: null,
  position: 0,
  items: 6,
  importable: 4,
  alreadyImported: 0,
  skippedCount: 2,
  slots: [{ name: "Thermo 1 – Q01" }, { name: "Thermo 1 – Q02" }],
  existingQuiz: null,
  unlinked: 0,
  skipped: [],
  predictedDrafts: [],
  notes: [],
  ...overrides,
});

const FACULTY = { canApprove: true, canCreateQuizzes: true };
const TA = { canApprove: false, canCreateQuizzes: false };

const previewOf = (quizzes, permissions = FACULTY) => ({ manifestTitle: "", quizzes, permissions });

// A mixed export: new questions, one quiz brought in earlier without a GRASP
// quiz, one already fully in the course, and a New Quizzes one with nothing usable.
const mixedQuizzes = () => [
  quiz({ ident: "new", title: "Thermo 1", importable: 4 }),
  quiz({ ident: "earlier", title: "Thermo 2", importable: 0, alreadyImported: 3 }),
  quiz({
    ident: "done",
    title: "Thermo 3",
    importable: 0,
    alreadyImported: 5,
    existingQuiz: { id: "q9", name: "Thermo 3" },
  }),
  quiz({ ident: "nq", title: "Kinetics NQ", flavour: "new-quizzes", importable: 0, skippedCount: 10 }),
];

describe("isCanvasExportFile", () => {
  it("sends a .zip down the Canvas path, whatever the case", () => {
    expect(isCanvasExportFile({ name: "quiz-export.zip" })).toBe(true);
    expect(isCanvasExportFile({ name: "QUIZ EXPORT.ZIP" })).toBe(true);
  });

  it("leaves JSON and anything else to the JSON import", () => {
    expect(isCanvasExportFile({ name: "questions.json" })).toBe(false);
    expect(isCanvasExportFile({ name: "export.zip.json" })).toBe(false);
    expect(isCanvasExportFile({ name: "course.imscc.json" })).toBe(false);
    expect(isCanvasExportFile(undefined)).toBe(false);
  });
});

describe("isCanvasCourseExportFile and COURSE_EXPORT_MESSAGE", () => {
  // A course export is often over the 50 MB upload limit, and uploading it
  // would only get "too large" back, so the modal answers it without uploading.
  it("answers a course export (.imscc) without uploading it, whatever the case", () => {
    expect(isCanvasCourseExportFile({ name: "course.imscc" })).toBe(true);
    expect(isCanvasCourseExportFile({ name: "Course.IMSCC " })).toBe(true);
  });

  it("sends quiz exports, and a course export renamed to .zip, to the server", () => {
    for (const name of ["quiz.zip", "course.zip"]) {
      expect(isCanvasCourseExportFile({ name })).toBe(false);
      expect(isCanvasExportFile({ name })).toBe(true);
    }
  });

  it("leaves JSON and a missing file alone", () => {
    expect(isCanvasCourseExportFile({ name: "course.imscc.json" })).toBe(false);
    expect(isCanvasCourseExportFile(undefined)).toBe(false);
  });

  it("says what the server says about a course export renamed to .zip", async () => {
    // Synthetic course export: a manifest, one quiz and the course_settings
    // folder that only course exports have.
    const zip = await buildExportZip({
      entries: {
        "imsmanifest.xml": buildManifest({ quizzes: [{ ident: "gquiz1", title: "Week 1" }] }),
        "gquiz1/gquiz1.xml": "<questestinterop/>",
        "course_settings/course_settings.xml": "<course/>",
      },
    });
    let error;
    try {
      readCanvasPackage(zip);
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe("COURSE_EXPORT");
    expect(error?.message).toBe(COURSE_EXPORT_MESSAGE);
  });
});

// A quiz whose earlier import was cut off: its GRASP quiz exists but lacks
// some of the questions that import saved.
const interrupted = (overrides = {}) =>
  quiz({
    ident: "cut",
    title: "Thermo 4",
    importable: 0,
    alreadyImported: 5,
    unlinked: 3,
    existingQuiz: { id: "q4", name: "Thermo 4" },
    ...overrides,
  });

describe("linkableCount and quizHasWork", () => {
  it("counts the earlier questions missing from the existing GRASP quiz", () => {
    expect(linkableCount(interrupted(), FACULTY)).toBe(3);
    expect(quizHasWork(interrupted(), FACULTY)).toBe(true);
  });

  it("counts none for someone who cannot add questions to quizzes", () => {
    expect(linkableCount(interrupted(), TA)).toBe(0);
    expect(quizHasWork(interrupted(), TA)).toBe(false);
  });

  it("counts none without an existing GRASP quiz or a count from the server", () => {
    expect(linkableCount(interrupted({ existingQuiz: null }), FACULTY)).toBe(0);
    expect(linkableCount(interrupted({ unlinked: undefined }), FACULTY)).toBe(0);
    expect(quizHasWork(interrupted({ unlinked: undefined }), FACULTY)).toBe(false);
  });

  it("treats new questions as work for anyone", () => {
    expect(quizHasWork(quiz({ importable: 2 }), TA)).toBe(true);
  });
});

describe("quizCanBeImported", () => {
  it("allows a quiz with new questions, for anyone", () => {
    expect(quizCanBeImported(quiz({ importable: 1 }), TA)).toBe(true);
  });

  it("allows making a GRASP quiz from questions imported earlier without one", () => {
    const earlier = quiz({ importable: 0, alreadyImported: 3 });
    expect(quizCanBeImported(earlier, FACULTY)).toBe(true);
    // Nothing else to do for someone who cannot create quizzes.
    expect(quizCanBeImported(earlier, TA)).toBe(false);
  });

  it("refuses a quiz with nothing new whose GRASP quiz already exists", () => {
    const done = quiz({ importable: 0, alreadyImported: 3, existingQuiz: { id: "q9", name: "X" } });
    expect(quizCanBeImported(done, FACULTY)).toBe(false);
  });

  it("refuses a quiz whose every item was skipped", () => {
    expect(quizCanBeImported(quiz({ importable: 0, alreadyImported: 0 }), FACULTY)).toBe(false);
  });

  it("allows finishing an import that stopped before its questions reached the GRASP quiz", () => {
    expect(quizCanBeImported(interrupted(), FACULTY)).toBe(true);
    // An empty GRASP quiz left by a first import cut off after creating it.
    expect(quizCanBeImported(interrupted({ unlinked: 5 }), FACULTY)).toBe(true);
    expect(quizCanBeImported(interrupted(), TA)).toBe(false);
  });
});

describe("initialSelections", () => {
  it("ticks Import for new questions and Create quiz for anything that will be in GRASP", () => {
    expect(initialSelections(previewOf(mixedQuizzes()))).toEqual({
      new: { import: true, createQuiz: true },
      earlier: { import: false, createQuiz: true },
      done: { import: false, createQuiz: true },
      nq: { import: false, createQuiz: false },
    });
  });

  it("never ticks Create quiz without permission to create quizzes", () => {
    expect(initialSelections(previewOf(mixedQuizzes(), TA))).toEqual({
      new: { import: true, createQuiz: false },
      earlier: { import: false, createQuiz: false },
      done: { import: false, createQuiz: false },
      nq: { import: false, createQuiz: false },
    });
  });

  it("returns nothing for a preview without quizzes", () => {
    expect(initialSelections({ permissions: FACULTY })).toEqual({});
  });

  it("ticks a quiz whose GRASP quiz still lacks earlier questions, so they get added", () => {
    const preview = previewOf([...mixedQuizzes(), interrupted()]);
    expect(initialSelections(preview).cut).toEqual({ import: true, createQuiz: true });
    expect(initialSelections(previewOf([interrupted()], TA)).cut).toEqual({
      import: false,
      createQuiz: false,
    });
  });
});

describe("commitQueue", () => {
  it("keeps preview order and only the ticked quizzes", () => {
    const preview = previewOf([
      quiz({ ident: "a", title: "A" }),
      quiz({ ident: "b", title: "B" }),
      quiz({ ident: "c", title: "C" }),
    ]);
    const selections = {
      a: { import: true, createQuiz: true },
      b: { import: false, createQuiz: true },
      c: { import: true, createQuiz: false },
    };
    expect(commitQueue(preview, selections)).toEqual([
      { quizIdent: "a", title: "A", createQuiz: true },
      { quizIdent: "c", title: "C", createQuiz: false },
    ]);
  });

  it("does not ask the server for quizzes the user may not create", () => {
    const preview = previewOf([quiz({ ident: "a", title: "A" })], TA);
    expect(commitQueue(preview, { a: { import: true, createQuiz: true } })).toEqual([
      { quizIdent: "a", title: "A", createQuiz: false },
    ]);
  });

  it("sends a quiz with nothing new only to create its GRASP quiz", () => {
    const preview = previewOf(mixedQuizzes());
    const ticked = {
      earlier: { import: true, createQuiz: true },
      done: { import: true, createQuiz: true },
      nq: { import: true, createQuiz: true },
    };
    expect(commitQueue(preview, ticked)).toEqual([
      { quizIdent: "earlier", title: "Thermo 2", createQuiz: true },
    ]);
    // Without the GRASP quiz it would change nothing.
    expect(commitQueue(preview, { earlier: { import: true, createQuiz: false } })).toEqual([]);
  });

  it("treats a quiz missing from the selections as unticked", () => {
    expect(commitQueue(previewOf([quiz()]), {})).toEqual([]);
  });

  it("sends a quiz with only earlier questions to add, with its GRASP quiz ticked", () => {
    const preview = previewOf([interrupted()]);
    expect(commitQueue(preview, initialSelections(preview))).toEqual([
      { quizIdent: "cut", title: "Thermo 4", createQuiz: true },
    ]);
    // Adding them is what the GRASP quiz checkbox does; without it, nothing changes.
    expect(commitQueue(preview, { cut: { import: true, createQuiz: false } })).toEqual([]);
    expect(commitQueue(previewOf([interrupted()], TA), { cut: { import: true, createQuiz: true } })).toEqual([]);
  });
});

describe("summarizeSelection and importButtonLabel", () => {
  it("counts the new questions and quizzes of what will be sent", () => {
    const preview = previewOf([
      quiz({ ident: "a", importable: 26 }),
      quiz({ ident: "b", importable: 12, existingQuiz: { id: "q1", name: "B" } }),
      quiz({ ident: "c", importable: 7 }),
      quiz({ ident: "d", importable: 0, alreadyImported: 4 }),
    ]);
    const selections = {
      a: { import: true, createQuiz: true },
      b: { import: true, createQuiz: true },
      c: { import: false, createQuiz: true },
      d: { import: true, createQuiz: true },
    };
    const summary = summarizeSelection(preview, selections);
    expect(summary).toEqual({
      quizzes: 3,
      questions: 38,
      unlinked: 0,
      newQuizzes: 2,
      updatedQuizzes: 1,
    });
    expect(importButtonLabel(summary)).toBe("Import 38 questions");
  });

  it("counts earlier questions to add to existing GRASP quizzes and names them on the button", () => {
    const preview = previewOf([
      interrupted(),
      interrupted({ ident: "cut2", title: "Thermo 5", unlinked: 1, existingQuiz: { id: "q5", name: "Thermo 5" } }),
    ]);
    const summary = summarizeSelection(preview, initialSelections(preview));
    expect(summary).toEqual({ quizzes: 2, questions: 0, unlinked: 4, newQuizzes: 0, updatedQuizzes: 2 });
    expect(importButtonLabel(summary)).toBe("Add 4 questions to 2 GRASP quizzes");

    const one = summarizeSelection(preview, { cut2: { import: true, createQuiz: true } });
    expect(importButtonLabel(one)).toBe("Add 1 question to 1 GRASP quiz");
  });

  it("still leads with new questions when some quizzes also get earlier ones added", () => {
    const preview = previewOf([quiz({ ident: "a", importable: 2 }), interrupted()]);
    const summary = summarizeSelection(preview, initialSelections(preview));
    expect(summary).toEqual({ quizzes: 2, questions: 2, unlinked: 3, newQuizzes: 1, updatedQuizzes: 1 });
    expect(importButtonLabel(summary)).toBe("Import 2 questions");
  });

  it("names the GRASP quizzes when no new question is ticked", () => {
    const preview = previewOf([quiz({ ident: "d", importable: 0, alreadyImported: 4 })]);
    const summary = summarizeSelection(preview, { d: { import: true, createQuiz: true } });
    expect(importButtonLabel(summary)).toBe("Create 1 GRASP quiz");
  });

  it("falls back to a plain label when nothing is ticked", () => {
    const summary = summarizeSelection(previewOf([quiz({ ident: "a" })]), {});
    expect(summary).toEqual({ quizzes: 0, questions: 0, unlinked: 0, newQuizzes: 0, updatedQuizzes: 0 });
    expect(importButtonLabel(summary)).toBe("Import");
    expect(importButtonLabel({ ...summary, quizzes: 1, questions: 1 })).toBe("Import 1 question");
  });
});

describe("withAllImports and allImportsSelected", () => {
  it("ticks and clears every quiz with new questions, leaving the rest alone", () => {
    const preview = previewOf(mixedQuizzes());
    const start = {
      new: { import: false, createQuiz: true },
      earlier: { import: true, createQuiz: true },
    };
    expect(allImportsSelected(preview, start)).toBe(false);

    const all = withAllImports(preview, start, true);
    expect(all).toEqual({
      new: { import: true, createQuiz: true },
      earlier: { import: true, createQuiz: true },
    });
    expect(allImportsSelected(preview, all)).toBe(true);

    expect(withAllImports(preview, all, false)).toEqual({
      new: { import: false, createQuiz: true },
      earlier: { import: true, createQuiz: true },
    });
  });

  it("is never 'all selected' when no quiz has new questions", () => {
    const preview = previewOf([quiz({ importable: 0 })]);
    expect(allImportsSelected(preview, { g1: { import: true } })).toBe(false);
  });

  it("includes quizzes whose GRASP quiz still lacks earlier questions", () => {
    const preview = previewOf([interrupted()]);
    expect(allImportsSelected(preview, { cut: { import: true, createQuiz: true } })).toBe(true);
    expect(withAllImports(preview, { cut: { import: true, createQuiz: true } }, false)).toEqual({
      cut: { import: false, createQuiz: true },
    });
    // Someone who cannot add them has nothing to select.
    expect(withAllImports(previewOf([interrupted()], TA), {}, true)).toEqual({});
  });
});

describe("describeUnlinked", () => {
  it("says how many imported questions the GRASP quiz lacks and that importing adds them", () => {
    expect(describeUnlinked(interrupted(), FACULTY)).toBe(
      "3 imported questions are not in the GRASP quiz “Thermo 4” yet; importing adds them."
    );
    expect(describeUnlinked(interrupted({ unlinked: 1 }), FACULTY)).toBe(
      "1 imported question is not in the GRASP quiz “Thermo 4” yet; importing adds it."
    );
  });

  it("only says they are missing to someone who cannot add them", () => {
    expect(describeUnlinked(interrupted(), TA)).toBe(
      "3 imported questions are not in the GRASP quiz “Thermo 4” yet."
    );
  });

  it("says nothing when the GRASP quiz has them all, or there is none", () => {
    expect(describeUnlinked(interrupted({ unlinked: 0 }), FACULTY)).toBe("");
    expect(describeUnlinked(interrupted({ existingQuiz: null }), FACULTY)).toBe("");
    expect(describeUnlinked(quiz(), FACULTY)).toBe("");
  });
});

describe("describePreviewSummary", () => {
  it("states quizzes, importable out of all items, and what is left", () => {
    const preview = {
      totals: { quizzes: 11, items: 419, importable: 358, alreadyImported: 0, skipped: 61 },
    };
    expect(describePreviewSummary(preview)).toBe(
      "11 quizzes · 358 of 419 questions can be imported · 61 skipped"
    );
  });

  it("adds what is already in the course and drops empty parts", () => {
    expect(
      describePreviewSummary({
        totals: { quizzes: 1, items: 1, importable: 0, alreadyImported: 1, skipped: 0 },
      })
    ).toBe("1 quiz · 0 of 1 question can be imported · 1 already imported");
  });
});

describe("describeRemoteImages", () => {
  it("says how many images will be fetched from Canvas", () => {
    expect(describeRemoteImages({ totals: { remoteImages: 47 } })).toBe(
      "47 images will be downloaded from Canvas."
    );
    expect(describeRemoteImages({ totals: { remoteImages: 1 } })).toBe(
      "1 image will be downloaded from Canvas."
    );
  });

  it("says nothing when no image is remote", () => {
    expect(describeRemoteImages({ totals: { remoteImages: 0 } })).toBe("");
    expect(describeRemoteImages({})).toBe("");
  });
});

describe("describeQuizCounts", () => {
  it("counts questions, groups, new ones and those already imported", () => {
    const slots = Array.from({ length: 6 }, (_, i) => ({ name: `Q0${i + 1}` }));
    expect(describeQuizCounts(quiz({ items: 26, slots, importable: 20, alreadyImported: 0 }))).toBe(
      "26 questions in 6 groups · 20 to import"
    );
    expect(describeQuizCounts(quiz({ items: 26, slots, importable: 14, alreadyImported: 12 }))).toBe(
      "26 questions in 6 groups · 14 to import · 12 already imported"
    );
    expect(describeQuizCounts(quiz({ items: 1, slots: slots.slice(0, 1), importable: 1 }))).toBe(
      "1 question in 1 group · 1 to import"
    );
  });
});

describe("slotLabel", () => {
  it("drops the quiz title the slot name starts with", () => {
    expect(slotLabel("Thermo 1 – Q03", "Thermo 1")).toBe("Q03");
    expect(slotLabel("Thermo 1 – Question 4", "Thermo 1")).toBe("Question 4");
  });

  it("keeps names that do not start with that quiz's title", () => {
    expect(slotLabel("Thermo 10 – Q03", "Thermo 1")).toBe("Thermo 10 – Q03");
    expect(slotLabel("Thermo 1 – ", "Thermo 1")).toBe("Thermo 1 – ");
    expect(slotLabel("Q03", "")).toBe("Q03");
    expect(slotLabel(undefined, "Thermo 1")).toBe("");
  });
});

const FORMULA = "Formula question with variables. These come in a later update (#130).";
const MULTI = "Multiple-answer questions aren't supported in GRASP yet.";
const MATCHING = "Matching questions aren't supported in GRASP.";
const skip = (slotName, reason) => ({ slotName, itemTitle: "Question", canvasType: "x", reason });

describe("describeSkipReasonCounts", () => {
  it("counts each reason, most common first and ties alphabetically", () => {
    const skipped = [
      skip("A – Q01", MULTI),
      skip("A – Q02", FORMULA),
      skip("A – Q03", MATCHING),
      skip("A – Q04", FORMULA),
      skip("A – Q05", MULTI),
      skip("A – Q06", FORMULA),
    ];
    expect(describeSkipReasonCounts(skipped)).toEqual([
      { reason: FORMULA, count: 3 },
      { reason: MULTI, count: 2 },
      { reason: MATCHING, count: 1 },
    ]);
  });

  it("returns an empty list for no skips", () => {
    expect(describeSkipReasonCounts([])).toEqual([]);
    expect(describeSkipReasonCounts(undefined)).toEqual([]);
  });
});

describe("groupSkippedByReason", () => {
  it("names each group once per reason, with how many of its variants were skipped", () => {
    const skipped = [
      skip("Thermo 1 – Q03", FORMULA),
      skip("Thermo 1 – Q03", FORMULA),
      skip("Thermo 1 – Q05", MULTI),
      skip("Thermo 1 – Q03", FORMULA),
      skip("Thermo 1 – Question 7", FORMULA),
    ];
    expect(groupSkippedByReason(skipped, "Thermo 1")).toEqual([
      { reason: FORMULA, count: 4, slots: ["Q03 (3)", "Question 7"] },
      { reason: MULTI, count: 1, slots: ["Q05"] },
    ]);
  });
});

describe("describeImportProgress", () => {
  it("names the quiz being imported and where the run is", () => {
    expect(describeImportProgress({ index: 3, total: 11, title: "A03 Kinetics" })).toBe(
      "Importing quiz 3 of 11: A03 Kinetics"
    );
  });
});

// One CommitReport as the server returns it.
const report = (overrides = {}) => ({
  quizIdent: "g1",
  title: "Thermo 1",
  created: { questions: 4, approved: 3, drafts: 1, objectives: 2 },
  alreadyImported: 0,
  skipped: [skip("Thermo 1 – Q03", FORMULA)],
  drafts: [{ slotName: "Thermo 1 – Q02", title: "Pick one", questionId: "d1", reasons: ["Lossy"] }],
  failures: [],
  imageFailures: 0,
  quiz: { id: "q1", name: "Thermo 1", created: true },
  ...overrides,
});

describe("mergeCommitReports", () => {
  it("adds up every quiz's report and keeps each one's lists", () => {
    const first = report();
    const second = report({
      quizIdent: "g2",
      title: "Thermo 2",
      created: { questions: 2, approved: 0, drafts: 2, objectives: 1 },
      alreadyImported: 5,
      skipped: [skip("Thermo 2 – Q01", MULTI), skip("Thermo 2 – Q02", FORMULA)],
      drafts: [],
      failures: [{ slotName: "Thermo 2 – Q04", title: "Rate", reason: "Save failed" }],
      imageFailures: 2,
      quiz: { id: "q2", name: "Thermo 2", created: false },
    });
    const third = report({ quizIdent: "g3", title: "Thermo 3", skipped: [], drafts: [], quiz: null });
    const errors = [{ quizIdent: "g4", title: "Thermo 4", message: "The Canvas import failed." }];

    const merged = mergeCommitReports([first, second, third], errors);

    expect(merged.totals).toEqual({
      questions: 10,
      approved: 6,
      drafts: 4,
      objectives: 5,
      quizzesCreated: 1,
      quizzesUpdated: 1,
      alreadyImported: 5,
      skipped: 3,
      imageFailures: 2,
      failures: 1,
      failedQuizzes: 1,
    });
    expect(merged.quizzes.map((q) => [q.quizIdent, q.title, q.created.questions])).toEqual([
      ["g1", "Thermo 1", 4],
      ["g2", "Thermo 2", 2],
      ["g3", "Thermo 3", 4],
    ]);
    expect(merged.quizzes[0].drafts).toEqual(first.drafts);
    expect(merged.quizzes[1].failures).toEqual(second.failures);
    expect(merged.quizzes[2].quiz).toBeNull();
    expect(merged.errors).toEqual(errors);
    expect(merged.skipReasons).toEqual([
      { reason: FORMULA, count: 2 },
      { reason: MULTI, count: 1 },
    ]);
  });

  it("counts image failures given as a list, and tolerates missing fields", () => {
    const merged = mergeCommitReports([
      { quizIdent: "g1", title: "Thermo 1", imageFailures: [{ reason: "timeout" }, { reason: "http-404" }] },
    ]);
    expect(merged.totals).toEqual({
      questions: 0,
      approved: 0,
      drafts: 0,
      objectives: 0,
      quizzesCreated: 0,
      quizzesUpdated: 0,
      alreadyImported: 0,
      skipped: 0,
      imageFailures: 2,
      failures: 0,
      failedQuizzes: 0,
    });
    expect(merged.quizzes[0]).toEqual({
      quizIdent: "g1",
      title: "Thermo 1",
      created: { questions: 0, approved: 0, drafts: 0, objectives: 0 },
      alreadyImported: 0,
      skipped: [],
      drafts: [],
      failures: [],
      imageFailures: 2,
      quiz: null,
    });
    expect(merged.errors).toEqual([]);
  });
});

// A TA's run: nothing can be Approved, so every question imported is a Draft,
// and the server lists only the ones it flagged.
const taReport = () =>
  report({
    created: { questions: 12, approved: 0, drafts: 12, objectives: 3 },
    skipped: [],
    drafts: [
      { slotName: "Thermo 1 – Q02", title: "Pick one", questionId: "d1", reasons: ["Lossy"] },
      { slotName: "Thermo 1 – Q05", title: "Heat", questionId: "d2", reasons: ["Media"] },
    ],
    quiz: null,
  });

describe("Draft list labels", () => {
  it("heads the result's list as the Drafts to check, apart from the Saved as Draft total", () => {
    const merged = mergeCommitReports([taReport()]);
    expect(resultTotalsRows(merged.totals)).toContainEqual(["Saved as Draft", 12]);
    expect(draftsToCheckLabel(merged)).toBe("Drafts to check (2)");
  });

  it("counts the flagged Drafts of every quiz in the run", () => {
    const merged = mergeCommitReports([report(), taReport(), report({ quizIdent: "g3", drafts: [] })]);
    expect(draftsToCheckLabel(merged)).toBe("Drafts to check (3)");
  });

  it("has no list when nothing was flagged", () => {
    expect(draftsToCheckLabel(mergeCommitReports([report({ drafts: [] })]))).toBe("");
    expect(draftsToCheckLabel(mergeCommitReports([]))).toBe("");
  });

  it("heads the review's list as the questions that will be Drafts to check", () => {
    const flagged = [
      { slotName: "Thermo 1 – Q02", title: "Pick one", reasons: ["Lossy"] },
      { slotName: "Thermo 1 – Q05", title: "Heat", reasons: ["Media"] },
    ];
    expect(predictedDraftsLabel(quiz({ importable: 12, predictedDrafts: flagged }))).toBe(
      "Will be saved as Draft to check (2)"
    );
    expect(predictedDraftsLabel(quiz({ predictedDrafts: [] }))).toBe("");
    expect(predictedDraftsLabel(quiz({ predictedDrafts: undefined }))).toBe("");
  });

  it("lists every total, in order", () => {
    const merged = mergeCommitReports(
      [report({ alreadyImported: 2, imageFailures: 1, quiz: { id: "q1", name: "Thermo 1", created: false } })],
      [{ quizIdent: "g2", title: "Thermo 2", message: "Failed" }]
    );
    expect(resultTotalsRows(merged.totals)).toEqual([
      ["Questions imported", 4],
      ["Approved", 3],
      ["Saved as Draft", 1],
      ["Learning objectives created", 2],
      ["GRASP quizzes created", 0],
      ["GRASP quizzes updated", 1],
      ["Already imported", 2],
      ["Skipped", 1],
      ["Images that could not be imported", 1],
    ]);
  });
});

// Stands in for the HTTP POST: `outcomes[quizIdent]` is the report to resolve
// with, or an error to reject with.
const fakeCommit = (outcomes) => {
  const sent = [];
  const commitOne = async (entry) => {
    sent.push(entry.quizIdent);
    const outcome = outcomes[entry.quizIdent];
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  return { sent, commitOne };
};
const httpError = (message, status) => Object.assign(new Error(message), { status });

describe("commitQuizzesInOrder", () => {
  const queue = [
    { quizIdent: "a", title: "A", createQuiz: true },
    { quizIdent: "b", title: "B", createQuiz: true },
    { quizIdent: "c", title: "C", createQuiz: false },
  ];

  it("commits each quiz in order and reports progress", async () => {
    const { sent, commitOne } = fakeCommit({
      a: report({ quizIdent: "a" }),
      b: report({ quizIdent: "b" }),
      c: report({ quizIdent: "c" }),
    });
    const steps = [];
    const result = await commitQuizzesInOrder(queue, commitOne, (step) =>
      steps.push(`${step.index}/${step.total} ${step.title} ${step.status}`)
    );

    expect(sent).toEqual(["a", "b", "c"]);
    expect(result.reports.map((r) => r.quizIdent)).toEqual(["a", "b", "c"]);
    expect(result.errors).toEqual([]);
    expect(steps).toEqual([
      "1/3 A importing",
      "1/3 A imported",
      "2/3 B importing",
      "2/3 B imported",
      "3/3 C importing",
      "3/3 C imported",
    ]);
  });

  it("records a failed quiz and carries on with the rest", async () => {
    const { sent, commitOne } = fakeCommit({
      a: report({ quizIdent: "a" }),
      b: httpError("The Canvas import failed.", 500),
      c: report({ quizIdent: "c" }),
    });
    const failed = [];
    const result = await commitQuizzesInOrder(queue, commitOne, (step) => {
      if (step.status === "failed") failed.push([step.quizIdent, step.message]);
    });

    expect(sent).toEqual(["a", "b", "c"]);
    expect(result.reports.map((r) => r.quizIdent)).toEqual(["a", "c"]);
    expect(result.errors).toEqual([{ quizIdent: "b", title: "B", message: "The Canvas import failed." }]);
    expect(failed).toEqual([["b", "The Canvas import failed."]]);
  });

  it("stops sending once the server refuses the user, failing the rest with that message", async () => {
    const refused = "You do not have permission to import questions in this course.";
    const { sent, commitOne } = fakeCommit({
      a: httpError(refused, 403),
      b: report({ quizIdent: "b" }),
      c: report({ quizIdent: "c" }),
    });
    const result = await commitQuizzesInOrder(queue, commitOne);

    expect(sent).toEqual(["a"]);
    expect(result.reports).toEqual([]);
    expect(result.errors).toEqual([
      { quizIdent: "a", title: "A", message: refused },
      { quizIdent: "b", title: "B", message: refused },
      { quizIdent: "c", title: "C", message: refused },
    ]);
  });

  it("gives a failure without a message a readable one", async () => {
    const { commitOne } = fakeCommit({ a: new Error("") });
    const result = await commitQuizzesInOrder([queue[0]], commitOne);
    expect(result.errors).toEqual([{ quizIdent: "a", title: "A", message: "The Canvas import failed." }]);
  });
});

describe("canvasPreviewForm and canvasCommitForm", () => {
  const file = new File(["PK"], "export.zip", { type: "application/zip" });

  it("sends the course and the zip for a preview", () => {
    const form = canvasPreviewForm(file, "course-1");
    expect([...form.keys()]).toEqual(["courseId", "file"]);
    expect(form.get("courseId")).toBe("course-1");
    expect(form.get("file").name).toBe("export.zip");
  });

  it("sends one quiz and the quiz choice as strings for a commit", () => {
    const form = canvasCommitForm(file, "course-1", { quizIdent: "g1", createQuiz: true });
    expect([...form.keys()]).toEqual(["courseId", "quizIdent", "createQuiz", "file"]);
    expect(form.get("quizIdent")).toBe("g1");
    expect(form.get("createQuiz")).toBe("true");
    expect(form.get("file").name).toBe("export.zip");
    expect(canvasCommitForm(file, "course-1", { quizIdent: "g1", createQuiz: false }).get("createQuiz")).toBe(
      "false"
    );
  });
});
