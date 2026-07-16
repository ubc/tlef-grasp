const express = require("express");
const request = require("supertest");
const { ObjectId } = require("mongodb");

jest.mock("../../src/services/user-course", () => ({
  getStudentCourses: jest.fn(),
}));
jest.mock("../../src/services/quiz", () => ({
  getQuizById: jest.fn(),
  getQuizQuestionsForStudent: jest.fn(),
}));
jest.mock("../../src/services/quiz-schedule", () => ({
  getStudentSectionObjectIds: jest.fn(),
  getSchedulesForQuiz: jest.fn(),
  resolveWindow: jest.fn(),
}));
jest.mock("../../src/utils/course-access", () => ({
  hasStaffAccessInCourse: jest.fn(),
}));
jest.mock("../../src/models/questions/CalculationQuestion", () => ({
  resolveCalculationDisplayTemplate: jest.fn(),
  buildStudentCalculationInstance: jest.fn(),
}));
jest.mock("../../src/services/achievement", () => ({
  awardQuizAchievements: jest.fn(),
}));
jest.mock("../../src/services/course", () => ({
  getCourseById: jest.fn(),
}));
jest.mock("../../src/services/database", () => ({
  connect: jest.fn(),
}));
jest.mock("../../src/services/quiz-session", () => ({
  getOrCreateSession: jest.fn(),
}));

const quizService = require("../../src/services/quiz");
const quizScheduleService = require("../../src/services/quiz-schedule");
const CalculationQuestion = require("../../src/models/questions/CalculationQuestion");
const { hasStaffAccessInCourse } = require("../../src/utils/course-access");
const { getCourseById } = require("../../src/services/course");
const databaseService = require("../../src/services/database");
const quizSessionService = require("../../src/services/quiz-session");
const studentRouter = require("../../src/routes/student");

const USER_ID = new ObjectId().toString();
const QUIZ_ID = new ObjectId().toString();

const stemImage = (overrides = {}) => ({
  fileId: new ObjectId().toString(),
  filename: "diagram.png",
  mimeType: "image/png",
  size: 1234,
  caption: "A diagram",
  ...overrides,
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { _id: USER_ID };
    next();
  });
  app.use("/student", studentRouter);
  return app;
}

async function getQuestions(storedQuestions) {
  quizService.getQuizQuestionsForStudent.mockResolvedValue(storedQuestions);
  const res = await request(buildApp()).get(`/student/quizzes/${QUIZ_ID}/questions`);
  expect(res.status).toBe(200);
  return res.body.data.questions;
}

describe("student quiz questions include stem images", () => {
  let consoleErrorSpy;

  beforeAll(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  beforeEach(() => {
    hasStaffAccessInCourse.mockResolvedValue(false);
    quizSessionService.getOrCreateSession.mockResolvedValue({
      startedAt: new Date("2026-07-10T12:00:00.000Z"),
      expiresAt: new Date("2026-07-10T13:00:00.000Z"),
      timeLimitMinutes: 60,
    });
    quizService.getQuizById.mockResolvedValue({
      _id: new ObjectId(QUIZ_ID),
      name: "Midterm Review",
      published: true,
      courseId: new ObjectId(),
    });
    quizScheduleService.getStudentSectionObjectIds.mockResolvedValue([
      new ObjectId().toString(),
    ]);
    quizScheduleService.getSchedulesForQuiz.mockResolvedValue([]);
    quizScheduleService.resolveWindow.mockReturnValue({
      accessibleNow: true,
      releaseDate: new Date(),
      expireDate: new Date(),
      reason: "open",
    });
    getCourseById.mockResolvedValue({ courseName: "BIOL 200" });
    // No prior attempts/scores for the previous-answers lookup.
    databaseService.connect.mockResolvedValue({
      collection: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })),
      })),
    });
  });

  it("passes stemImages through for every question type", async () => {
    const mcqImage = stemImage();
    const fibImage = stemImage();
    const openImage = stemImage();

    const questions = await getQuestions([
      {
        _id: new ObjectId(),
        title: "Which organelle is shown?",
        questionType: "multiple-choice",
        options: { A: "Nucleus", B: "Ribosome", C: "Golgi", D: "Vacuole" },
        stemImages: [mcqImage],
      },
      {
        _id: new ObjectId(),
        stem: "The powerhouse of the cell is the ___",
        questionType: "fill-in-the-blank",
        stemImages: [fibImage],
      },
      {
        _id: new ObjectId(),
        stem: "Explain the labeled structure.",
        questionType: "open-ended",
        stemImages: [openImage],
      },
    ]);

    expect(questions).toHaveLength(3);
    expect(questions[0].stemImages).toEqual([mcqImage]);
    expect(questions[1].stemImages).toEqual([fibImage]);
    expect(questions[2].stemImages).toEqual([openImage]);
  });

  it("passes stemImages through on calculation questions (built and broken)", async () => {
    const builtImage = stemImage();
    const brokenImage = stemImage();
    CalculationQuestion.resolveCalculationDisplayTemplate.mockReturnValue(
      "Compute {{x}} + {{y}}"
    );
    CalculationQuestion.buildStudentCalculationInstance
      .mockReturnValueOnce({
        ok: true,
        rendered: "Compute 2 + 3",
        token: "calc-token",
        answerDecimalPlaces: 2,
      })
      .mockReturnValueOnce({ ok: false, error: new Error("bad formula") });

    const questions = await getQuestions([
      {
        _id: new ObjectId(),
        stem: "Compute {{x}} + {{y}}",
        questionType: "calculation",
        calculationFormula: "x + y",
        stemImages: [builtImage],
      },
      {
        _id: new ObjectId(),
        stem: "Compute {{x}} + {{y}}",
        questionType: "calculation",
        calculationFormula: "x +",
        stemImages: [brokenImage],
      },
    ]);

    expect(questions[0]).toMatchObject({
      question: "Compute 2 + 3",
      calculationToken: "calc-token",
      stemImages: [builtImage],
    });
    expect(questions[1]).toMatchObject({
      calculationLoadError: true,
      stemImages: [brokenImage],
    });
  });

  it("wraps a legacy single stemImage into the array shape the client expects", async () => {
    const legacy = stemImage();

    const questions = await getQuestions([
      {
        _id: new ObjectId(),
        title: "Legacy question",
        questionType: "multiple-choice",
        options: { A: "1", B: "2", C: "3", D: "4" },
        stemImage: legacy,
      },
    ]);

    expect(questions[0].stemImages).toEqual([legacy]);
  });

  it("defaults to an empty array when a question has no images", async () => {
    const questions = await getQuestions([
      {
        _id: new ObjectId(),
        title: "Plain question",
        questionType: "multiple-choice",
        options: { A: "1", B: "2", C: "3", D: "4" },
      },
    ]);

    expect(questions[0].stemImages).toEqual([]);
  });

  it("renders option objects with empty text as blank, not [object Object]", async () => {
    const questions = await getQuestions([
      {
        _id: new ObjectId(),
        title: "MCQ with structured options",
        questionType: "multiple-choice",
        options: {
          A: { text: "Nucleus", feedback: "Correct" },
          B: { text: "" },
          C: "Golgi",
          D: null,
        },
      },
    ]);

    expect(questions[0].options).toEqual({
      A: "Nucleus",
      B: "",
      C: "Golgi",
      D: "",
    });
  });
});
