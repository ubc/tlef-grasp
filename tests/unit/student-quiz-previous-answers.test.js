// Resuming a partly-answered quiz restores the recorded answers, but a wrong
// multiple-choice or calculation answer must come back without the correct
// answer (issue #128): the student keeps retrying until they find it.
// Fill-in-the-blank and open-ended are answered once and already showed their
// answer, so they come back as recorded.

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
  recordQuestionCount: jest.fn(),
}));

const quizService = require("../../src/services/quiz");
const quizScheduleService = require("../../src/services/quiz-schedule");
const { hasStaffAccessInCourse } = require("../../src/utils/course-access");
const { getCourseById } = require("../../src/services/course");
const databaseService = require("../../src/services/database");
const quizSessionService = require("../../src/services/quiz-session");
const studentRouter = require("../../src/routes/student");

const USER_ID = new ObjectId().toString();
const QUIZ_ID = new ObjectId().toString();

const ids = {
  mcqWrong: new ObjectId(),
  mcqRight: new ObjectId(),
  fibWrong: new ObjectId(),
  calcWrong: new ObjectId(),
  openEnded: new ObjectId(),
};

const recordedAttempts = [
  {
    questionId: ids.mcqWrong,
    questionType: "multiple-choice",
    selectedAnswer: "C",
    isCorrect: false,
    correctAnswer: "A",
    correctOptionText: "Half of Vmax",
    feedbackText: "That is kcat, not Km.",
  },
  {
    questionId: ids.mcqRight,
    questionType: "multiple-choice",
    selectedAnswer: "A",
    isCorrect: true,
    correctAnswer: "A",
    correctOptionText: "Half of Vmax",
    feedbackText: "",
  },
  {
    questionId: ids.fibWrong,
    questionType: "fill-in-the-blank",
    selectedAnswer: "nucleus",
    isCorrect: false,
    correctAnswer: null,
    correctOptionText: "mitochondrion",
  },
  {
    questionId: ids.calcWrong,
    questionType: "calculation",
    selectedAnswer: "5",
    isCorrect: false,
    correctAnswer: null,
    correctOptionText: "4.00",
  },
  {
    questionId: ids.openEnded,
    questionType: "open-ended",
    selectedAnswer: "Something about light.",
    isCorrect: false,
    sampleAnswer: "Light reactions make ATP; the Calvin cycle fixes CO2.",
    gradingCriteria: "Mentions both stages.",
    aiGraded: true,
  },
];

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

async function getPreviousAnswers() {
  const res = await request(buildApp()).get(`/student/quizzes/${QUIZ_ID}/questions`);
  expect(res.status).toBe(200);
  return res.body.data.previousAnswers;
}

describe("resuming a quiz restores recorded answers without revealing wrong ones", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hasStaffAccessInCourse.mockResolvedValue(false);
    quizSessionService.getOrCreateSession.mockResolvedValue({
      startedAt: new Date("2026-09-25T12:00:00.000Z"),
      expiresAt: new Date("2026-09-25T13:00:00.000Z"),
      timeLimitMinutes: 60,
    });
    quizService.getQuizById.mockResolvedValue({
      _id: new ObjectId(QUIZ_ID),
      name: "Enzyme kinetics",
      published: true,
      courseId: new ObjectId(),
    });
    quizService.getQuizQuestionsForStudent.mockResolvedValue([
      {
        _id: ids.mcqWrong,
        questionType: "multiple-choice",
        title: "What does Km represent?",
        options: { A: { text: "Half of Vmax" }, B: { text: "Vmax" } },
      },
    ]);
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
    getCourseById.mockResolvedValue({ courseName: "BIOC 302" });
    // No score yet (the attempt is in progress), and these recorded answers.
    databaseService.connect.mockResolvedValue({
      collection: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue(recordedAttempts) })),
      })),
    });
  });

  it("drops the correct answer from a wrong multiple-choice answer", async () => {
    const previous = await getPreviousAnswers();

    expect(previous[ids.mcqWrong.toString()]).toMatchObject({
      isCorrect: false,
      selectedAnswer: "C",
      selectedIndex: 2,
      // The chosen option's own feedback is still restored.
      feedbackText: "That is kcat, not Km.",
      correctAnswer: null,
      correctOptionText: null,
    });
  });

  it("keeps the answer on a question the student answered correctly", async () => {
    const previous = await getPreviousAnswers();

    expect(previous[ids.mcqRight.toString()]).toMatchObject({
      isCorrect: true,
      correctAnswer: "A",
      correctOptionText: "Half of Vmax",
    });
  });

  it("drops the expected value from a wrong calculation answer", async () => {
    const previous = await getPreviousAnswers();

    expect(previous[ids.calcWrong.toString()]).toMatchObject({
      isCorrect: false,
      selectedAnswer: "5",
      correctAnswer: null,
      correctOptionText: null,
    });
  });

  it("keeps the accepted answer on a wrong fill-in-the-blank answer", async () => {
    const previous = await getPreviousAnswers();

    expect(previous[ids.fibWrong.toString()]).toMatchObject({
      isCorrect: false,
      selectedAnswer: "nucleus",
      correctOptionText: "mitochondrion",
    });
  });

  it("keeps the sample answer on an open-ended attempt", async () => {
    const previous = await getPreviousAnswers();

    expect(previous[ids.openEnded.toString()]).toMatchObject({
      isCorrect: false,
      sampleAnswer: "Light reactions make ATP; the Calvin cycle fixes CO2.",
      gradingCriteria: "Mentions both stages.",
    });
  });
});
