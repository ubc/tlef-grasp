const express = require("express");
const request = require("supertest");

jest.mock("../../src/services/quiz", () => ({
  getQuizById: jest.fn(),
}));
jest.mock("../../src/services/quiz-question-flag", () => ({
  questionBelongsToQuiz: jest.fn(),
  saveStudentFlag: jest.fn(),
  getStudentFlags: jest.fn(),
  getCourseFlags: jest.fn(),
  getFlagById: jest.fn(),
  updateFlagStatus: jest.fn(),
}));
jest.mock("../../src/services/user-course", () => ({
  isUserInCourse: jest.fn(),
}));
jest.mock("../../src/utils/auth", () => ({
  ROLES: { FACULTY: "faculty", STAFF: "staff", STUDENT: "student" },
  isFaculty: jest.fn(),
  isStudent: jest.fn(),
}));
jest.mock("../../src/middleware/auth", () => ({
  requireRole: () => (_req, _res, next) => next(),
}));
jest.mock("../../src/services/answer-grading", () => ({}));

const quizService = require("../../src/services/quiz");
const flagService = require("../../src/services/quiz-question-flag");
const { isFaculty, isStudent } = require("../../src/utils/auth");
const { isUserInCourse } = require("../../src/services/user-course");
const quizRouter = require("../../src/routes/quiz");

const USER_ID = "student-1";
const COURSE_ID = "course-1";
const QUIZ_ID = "quiz-1";
const QUESTION_ID = "question-1";

function buildApp(user = { _id: USER_ID }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use("/api/quiz", quizRouter);
  return app;
}

describe("quiz question flag routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isStudent.mockResolvedValue(true);
    isFaculty.mockResolvedValue(false);
    isUserInCourse.mockResolvedValue(true);
    quizService.getQuizById.mockResolvedValue({ _id: QUIZ_ID, courseId: COURSE_ID });
  });

  it("lets a student submit an issue for a question in their quiz", async () => {
    flagService.questionBelongsToQuiz.mockResolvedValue(true);
    flagService.saveStudentFlag.mockResolvedValue({ _id: "flag-1", status: "pending" });

    const response = await request(buildApp())
      .post(`/api/quiz/${QUIZ_ID}/flags`)
      .send({
        questionId: QUESTION_ID,
        reason: "typo",
        comment: " The unit is missing. ",
        questionText: "What is the value?",
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ success: true, flag: { status: "pending" } });
    expect(flagService.saveStudentFlag).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      quizId: QUIZ_ID,
      questionId: QUESTION_ID,
      studentId: USER_ID,
      reason: "typo",
      comment: "The unit is missing.",
      questionText: "What is the value?",
    });
  });

  it("rejects a report for a question that is not assigned to the quiz", async () => {
    flagService.questionBelongsToQuiz.mockResolvedValue(false);

    const response = await request(buildApp())
      .post(`/api/quiz/${QUIZ_ID}/flags`)
      .send({ questionId: QUESTION_ID, reason: "incorrect" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/does not belong/i);
    expect(flagService.saveStudentFlag).not.toHaveBeenCalled();
  });

  it("lets an instructor retrieve and update course reports", async () => {
    isStudent.mockResolvedValue(false);
    isFaculty.mockResolvedValue(true);
    const flags = [{ _id: "flag-1", status: "pending", questionText: "Question text" }];
    flagService.getCourseFlags.mockResolvedValue(flags);
    flagService.getFlagById.mockResolvedValue({ _id: "flag-1", courseId: COURSE_ID });
    flagService.updateFlagStatus.mockResolvedValue({ _id: "flag-1", status: "reviewed" });

    const app = buildApp({ _id: "instructor-1" });
    const listResponse = await request(app).get(`/api/quiz/flags/course/${COURSE_ID}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.flags).toEqual(flags);

    const updateResponse = await request(app)
      .put("/api/quiz/flags/flag-1/status")
      .send({ status: "reviewed" });
    expect(updateResponse.status).toBe(200);
    expect(flagService.updateFlagStatus).toHaveBeenCalledWith(
      "flag-1",
      "reviewed",
      "instructor-1"
    );
  });

  it("lets an instructor using student preview submit and read their own test report", async () => {
    isStudent.mockResolvedValue(false);
    isFaculty.mockResolvedValue(true);
    flagService.questionBelongsToQuiz.mockResolvedValue(true);
    flagService.saveStudentFlag.mockResolvedValue({ _id: "preview-flag", status: "pending" });
    flagService.getStudentFlags.mockResolvedValue([{ _id: "preview-flag", status: "pending" }]);

    const app = buildApp({ _id: "instructor-1" });
    const submitResponse = await request(app)
      .post(`/api/quiz/${QUIZ_ID}/flags`)
      .send({ questionId: QUESTION_ID, reason: "other" });
    expect(submitResponse.status).toBe(201);

    const myFlagsResponse = await request(app).get(`/api/quiz/flags/mine?courseId=${COURSE_ID}`);
    expect(myFlagsResponse.status).toBe(200);
    expect(flagService.getStudentFlags).toHaveBeenCalledWith(COURSE_ID, "instructor-1");
  });
});
