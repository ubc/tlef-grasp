/**
 * The export tells the instructor which questions it left out (#63): the
 * X-Export-Left-Out header beside the file, or the error body when nothing at
 * all could be exported. Calculation questions now export to Canvas (QTI);
 * H5P still has no type for them.
 */
const express = require("express");
const request = require("supertest");

// Capture what gets appended to the export ZIP instead of building a real
// archive; finalize() ends the response so supertest resolves.
jest.mock("archiver", () => {
  const instances = [];
  const factory = jest.fn(() => {
    const archive = {
      appended: [],
      on: jest.fn().mockReturnThis(),
      pipe: jest.fn(function pipe(dest) {
        this.dest = dest;
        return dest;
      }),
      append: jest.fn(function append(content, opts) {
        this.appended.push({ content, name: opts.name });
      }),
      finalize: jest.fn(function finalize() {
        if (this.dest) this.dest.end();
      }),
    };
    instances.push(archive);
    return archive;
  });
  factory.instances = instances;
  return factory;
});

jest.mock("../../src/services/question", () => ({
  saveQuestion: jest.fn(),
  updateQuestion: jest.fn(),
  deleteQuestion: jest.fn(),
  getQuestions: jest.fn(),
  getQuestion: jest.fn(),
  getQuestionCourseId: jest.fn(),
}));
jest.mock("../../src/services/user-course", () => ({
  isUserInCourse: jest.fn(),
}));
jest.mock("../../src/services/quiz", () => ({}));
jest.mock("../../src/utils/auth", () => ({
  isFaculty: jest.fn(),
}));
jest.mock("../../src/utils/co-instructor-permissions", () => ({
  assertCoInstructorPermission: jest.fn(),
  PERMISSION_KEYS: { QUESTION_BANK: "questionBank" },
}));
jest.mock("../../src/services/image", () => ({
  downloadImageBuffer: jest.fn(),
}));

const archiver = require("archiver");
const questionRouter = require("../../src/routes/question");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { _id: "faculty-1" };
    next();
  });
  app.use("/question", questionRouter);
  return app;
}

const mc = {
  questionType: "multiple-choice",
  title: "Which synthetic option?",
  options: { A: "One", B: "Two" },
  correctAnswer: "A",
};
const calc = {
  questionType: "calculation",
  title: "Synthetic double",
  stem: "Double {{x}}?",
  calculationFormula: "2*x",
  calculationVariables: [{ name: "x", min: 1, max: 9, integerOnly: true }],
  calculationAnswerDecimals: 0,
};
const hyperbolic = { ...calc, title: "Synthetic sinh", stem: "sinh of {{x}}?", calculationFormula: "sinh(x)" };

function exportAs(format, questions) {
  return request(buildApp())
    .post(`/question/export?format=${format}`)
    .send({ course: "BIOL 200", questions, quizName: "Midterm" });
}

const leftOutHeader = (response) => {
  const raw = response.headers["x-export-left-out"];
  return raw === undefined ? undefined : JSON.parse(decodeURIComponent(raw));
};

const assessmentXml = () => {
  const archive = archiver.instances[archiver.instances.length - 1];
  return archive.appended.find(
    (e) => e.name.endsWith(".xml") && !e.name.includes("manifest") && !e.name.includes("meta")
  ).content;
};

describe("export left-out report", () => {
  let consoleErrorSpy;

  beforeAll(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  beforeEach(() => {
    archiver.instances.length = 0;
  });

  test("Canvas (QTI): calculation questions are exported; one Canvas can't represent is named in the header", async () => {
    const response = await exportAs("qti", [mc, hyperbolic, calc]);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    expect(leftOutHeader(response)).toEqual({
      count: 1,
      questions: [{ index: 1, reason: "The formula uses sinh(), which Canvas doesn't support." }],
    });
    const xml = assessmentXml();
    expect((xml.match(/<item /g) || []).length).toBe(2);
    expect(xml).toContain("calculated_question");
    // The assessment's point total counts the exported questions only.
    const meta = archiver.instances[0].appended.find((e) => e.name.endsWith("assessment_meta.xml")).content;
    expect(meta).toContain("<points_possible>2.0</points_possible>");
  });

  test("Canvas (QTI): nothing left out, no header", async () => {
    const response = await exportAs("qti", [mc, calc]);
    expect(response.status).toBe(200);
    expect(leftOutHeader(response)).toBeUndefined();
  });

  test("Canvas (QTI): when nothing can be exported, the error lists why", async () => {
    const response = await exportAs("qti", [hyperbolic]);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "None of these questions can be exported to Canvas (QTI). Use CSV or JSON instead.",
      leftOut: { count: 1, questions: [{ index: 0, reason: "The formula uses sinh(), which Canvas doesn't support." }] },
    });
    expect(archiver.instances).toHaveLength(0);
  });

  test("H5P: calculation questions are named in the header", async () => {
    const response = await exportAs("h5p", [calc, mc, hyperbolic]);
    expect(response.status).toBe(200);
    expect(leftOutHeader(response)).toEqual({
      count: 2,
      questions: [
        { index: 0, reason: "H5P has no question type for calculations with variables." },
        { index: 2, reason: "H5P has no question type for calculations with variables." },
      ],
    });
  });

  test("H5P: a quiz of only calculation questions is an error that lists them", async () => {
    const response = await exportAs("h5p", [calc]);
    expect(response.status).toBe(400);
    expect(response.body.leftOut).toEqual({
      count: 1,
      questions: [{ index: 0, reason: "H5P has no question type for calculations with variables." }],
    });
  });
});
