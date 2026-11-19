const express = require("express");
const request = require("supertest");

jest.mock("../../src/services/analytics", () => ({
  canViewSection: jest.fn(),
  getCohortStudents: jest.fn(),
  getCohortStudentIds: jest.fn(),
  getQuestionAnalytics: jest.fn(),
  getQuizAnalytics: jest.fn(),
  getObjectiveAnalytics: jest.fn(),
}));
jest.mock("../../src/services/quiz", () => ({ getQuizById: jest.fn() }));
jest.mock("../../src/utils/course-access", () => ({ hasStaffAccessInCourse: jest.fn() }));
jest.mock("../../src/utils/auth", () => ({ isFaculty: jest.fn() }));

const analyticsService = require("../../src/services/analytics");
const quizService = require("../../src/services/quiz");
const { hasStaffAccessInCourse } = require("../../src/utils/course-access");
const { isFaculty } = require("../../src/utils/auth");
const analyticsRouter = require("../../src/routes/analytics");

const COURSE_ID = "64b000000000000000000001";
const OTHER_COURSE_ID = "64b000000000000000000002";
const QUIZ_ID = "64b0000000000000000000aa";
const URL = `/api/analytics/course/${COURSE_ID}/questions`;

function buildApp(user = { _id: "instructor-1" }) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use("/api/analytics", analyticsRouter);
  return app;
}

describe("analytics routes", () => {
  beforeEach(() => {
    hasStaffAccessInCourse.mockResolvedValue(true);
    isFaculty.mockResolvedValue(true);
    analyticsService.canViewSection.mockResolvedValue(true);
    analyticsService.getCohortStudentIds.mockResolvedValue(["s1", "s2"]);
    analyticsService.getQuestionAnalytics.mockResolvedValue({
      questions: [],
      mostMissed: [],
      summary: { totalQuestions: 0 },
      minResponses: 5,
    });
    analyticsService.getCohortStudents.mockResolvedValue([
      { userId: "s1", sections: ["101"] },
      { userId: "s2", sections: ["102"] },
    ]);
    analyticsService.getQuizAnalytics.mockResolvedValue({ quizzes: [], summary: {}, minResponses: 5 });
    analyticsService.getObjectiveAnalytics.mockResolvedValue({ objectives: [], summary: {}, minResponses: 5 });
    quizService.getQuizById.mockResolvedValue({ _id: QUIZ_ID, courseId: COURSE_ID });
  });

  it("returns class-level question analytics to faculty", async () => {
    const response = await request(buildApp()).get(URL);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { cohortSize: 2, minResponses: 5 } });
    expect(analyticsService.getQuestionAnalytics).toHaveBeenCalledWith(COURSE_ID, {
      quizId: null,
      studentIds: ["s1", "s2"],
    });
  });

  it("refuses staff and TAs even with staff access in the course", async () => {
    isFaculty.mockResolvedValue(false);

    const response = await request(buildApp()).get(URL);

    expect(response.status).toBe(403);
    expect(analyticsService.getQuestionAnalytics).not.toHaveBeenCalled();
  });

  it("refuses faculty without access to the course", async () => {
    hasStaffAccessInCourse.mockResolvedValue(false);
    const response = await request(buildApp()).get(URL);
    expect(response.status).toBe(403);
  });

  it("rejects an invalid course id", async () => {
    const response = await request(buildApp()).get("/api/analytics/course/not-an-id/questions");
    expect(response.status).toBe(400);
  });

  it("narrows to a quiz of the course", async () => {
    const response = await request(buildApp()).get(`${URL}?quizId=${QUIZ_ID}`);

    expect(response.status).toBe(200);
    expect(analyticsService.getQuestionAnalytics).toHaveBeenCalledWith(COURSE_ID, {
      quizId: QUIZ_ID,
      studentIds: ["s1", "s2"],
    });
  });

  it("rejects a quiz from another course", async () => {
    quizService.getQuizById.mockResolvedValue({ _id: QUIZ_ID, courseId: OTHER_COURSE_ID });
    const response = await request(buildApp()).get(`${URL}?quizId=${QUIZ_ID}`);
    expect(response.status).toBe(404);
  });

  it("refuses a section the viewer cannot see", async () => {
    analyticsService.canViewSection.mockResolvedValue(false);

    const response = await request(buildApp()).get(`${URL}?sectionId=101`);

    expect(response.status).toBe(403);
    expect(analyticsService.getCohortStudentIds).not.toHaveBeenCalled();
  });

  it("scopes the cohort to the requested section", async () => {
    await request(buildApp()).get(`${URL}?sectionId=101`);
    expect(analyticsService.getCohortStudentIds).toHaveBeenCalledWith(
      COURSE_ID,
      expect.anything(),
      { sectionId: "101" }
    );
  });

  it("returns quiz analytics over the cohort with their sections", async () => {
    const response = await request(buildApp()).get(
      `/api/analytics/course/${COURSE_ID}/quizzes?quizId=${QUIZ_ID}&sectionId=101`
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ cohortSize: 2, minResponses: 5 });
    expect(analyticsService.getCohortStudents).toHaveBeenCalledWith(COURSE_ID, expect.anything(), {
      sectionId: "101",
    });
    expect(analyticsService.getQuizAnalytics).toHaveBeenCalledWith(COURSE_ID, {
      quizId: QUIZ_ID,
      students: [
        { userId: "s1", sections: ["101"] },
        { userId: "s2", sections: ["102"] },
      ],
    });
  });

  it("returns objective analytics", async () => {
    const response = await request(buildApp()).get(`/api/analytics/course/${COURSE_ID}/objectives`);

    expect(response.status).toBe(200);
    expect(analyticsService.getObjectiveAnalytics).toHaveBeenCalledWith(COURSE_ID, {
      quizId: null,
      studentIds: ["s1", "s2"],
    });
  });

  it.each(["quizzes", "objectives"])("refuses non-faculty on the %s view", async (view) => {
    isFaculty.mockResolvedValue(false);
    const response = await request(buildApp()).get(`/api/analytics/course/${COURSE_ID}/${view}`);
    expect(response.status).toBe(403);
  });

  describe("CSV export", () => {
    const EXPORT_URL = `/api/analytics/course/${COURSE_ID}/export`;

    it("sends the question view as a CSV attachment named for its filters", async () => {
      quizService.getQuizById.mockResolvedValue({ _id: QUIZ_ID, courseId: COURSE_ID, name: "Quiz 1: Limits" });
      analyticsService.getQuestionAnalytics.mockResolvedValue({
        questions: [{
          questionId: "q1", text: "<p>What is 2 + 2?</p>", questionType: "calculation", bloom: "Apply",
          responses: 6, students: 6, pending: 0, enoughData: true, correct: 3, incorrect: 3,
          pValue: 0.5, difficulty: "moderate", options: null,
        }],
        mostMissed: [],
        summary: {},
        minResponses: 5,
        minStudents: 3,
      });

      const response = await request(buildApp()).get(
        `${EXPORT_URL}/questions?quizId=${QUIZ_ID}&sectionId=SEC-101`
      );

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toMatch(/^text\/csv/);
      expect(response.headers["content-disposition"]).toMatch(
        /^attachment; filename="analytics-questions-quiz-quiz-1-limits-section-sec-101-\d{4}-\d{2}-\d{2}\.csv"$/
      );
      expect(response.text).toContain("What is 2 + 2?,calculation,Apply,6,6,0,50,Moderate,3,3");
    });

    it.each(["quizzes", "objectives"])("exports the %s view", async (view) => {
      const response = await request(buildApp()).get(`${EXPORT_URL}/${view}`);
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toMatch(/^text\/csv/);
    });

    it("refuses an unknown view", async () => {
      const response = await request(buildApp()).get(`${EXPORT_URL}/students`);
      expect(response.status).toBe(404);
      expect(analyticsService.getCohortStudentIds).not.toHaveBeenCalled();
    });

    it("refuses non-faculty", async () => {
      isFaculty.mockResolvedValue(false);
      const response = await request(buildApp()).get(`${EXPORT_URL}/questions`);
      expect(response.status).toBe(403);
    });
  });
});
