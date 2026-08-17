/**
 * M6, server half: a submission whose score was never written must not answer
 * success.
 *
 * saveQuizScore, markSubmitted and the achievement award used to share one
 * try/catch that logged and fell through to `res.json({ success: true, ... })`.
 * A failed score write therefore looked identical to a good one: the student
 * saw a score, the instructor's roster showed them as not having taken the
 * quiz, and nothing prompted a retry. The two are now separated — achievements
 * stay best-effort, the score write is reported.
 */

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');

jest.mock('../../src/services/user-course', () => ({ getStudentCourses: jest.fn() }));
jest.mock('../../src/services/quiz', () => ({
  getQuizById: jest.fn(),
  getQuizQuestions: jest.fn(),
  getQuizQuestionsForStudent: jest.fn(),
  saveQuizScore: jest.fn(),
  saveStudentPerformance: jest.fn(),
}));
jest.mock('../../src/services/quiz-schedule', () => ({
  getStudentSectionObjectIds: jest.fn(),
  getSchedulesForQuiz: jest.fn(),
  resolveWindow: jest.fn(),
}));
jest.mock('../../src/utils/course-access', () => ({ hasStaffAccessInCourse: jest.fn() }));
jest.mock('../../src/services/achievement', () => ({ awardQuizAchievements: jest.fn() }));
jest.mock('../../src/services/course', () => ({ getCourseById: jest.fn() }));
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/services/quiz-session', () => ({
  getOrCreateSession: jest.fn(),
  getSession: jest.fn(),
  recordQuestionCount: jest.fn(),
  markSubmitted: jest.fn(),
}));

const quizService = require('../../src/services/quiz');
const quizScheduleService = require('../../src/services/quiz-schedule');
const achievementService = require('../../src/services/achievement');
const databaseService = require('../../src/services/database');
const quizSessionService = require('../../src/services/quiz-session');
const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const studentRouter = require('../../src/routes/student');

const USER_ID = new ObjectId().toString();
const QUIZ_ID = new ObjectId().toString();
const COURSE_ID = new ObjectId();
const SECTION_ID = new ObjectId().toString();

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { _id: USER_ID };
    next();
  });
  app.use('/student', studentRouter);
  return app;
};

const submit = () =>
  request(buildApp())
    .post(`/student/quizzes/${QUIZ_ID}/submit`)
    .send({ timeSpent: 1000, sessionId: 's1' });

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

beforeEach(() => {
  hasStaffAccessInCourse.mockResolvedValue(false);
  quizService.getQuizById.mockResolvedValue({
    _id: new ObjectId(QUIZ_ID),
    name: 'Midterm Review',
    published: true,
    courseId: COURSE_ID,
  });
  quizScheduleService.getStudentSectionObjectIds.mockResolvedValue([SECTION_ID]);
  quizScheduleService.getSchedulesForQuiz.mockResolvedValue([]);
  quizScheduleService.resolveWindow.mockReturnValue({
    accessibleNow: true,
    releaseDate: new Date(),
    expireDate: new Date(),
    reason: 'open',
  });
  quizSessionService.getSession.mockResolvedValue({
    startedAt: new Date(Date.now() - 60000),
    questionCount: 2,
  });
  quizSessionService.markSubmitted.mockResolvedValue(undefined);
  achievementService.awardQuizAchievements.mockResolvedValue([]);
  quizService.saveQuizScore.mockResolvedValue({ insertedId: 'score-1' });
  databaseService.connect.mockResolvedValue({
    collection: jest.fn(() => ({
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn(() => ({
        toArray: jest.fn().mockResolvedValue([
          {
            userId: new ObjectId(USER_ID),
            quizId: new ObjectId(QUIZ_ID),
            questionId: new ObjectId(),
            questionType: 'multiple-choice',
            isCorrect: true,
          },
        ]),
      })),
    })),
  });
});

describe('POST /student/quizzes/:quizId/submit when the score cannot be stored', () => {
  it('reports failure instead of answering success', async () => {
    quizService.saveQuizScore.mockRejectedValue(new Error('write concern timeout'));

    const res = await submit();

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('SCORE_NOT_RECORDED');
  });

  it('reports failure when the session cannot be marked submitted', async () => {
    quizSessionService.markSubmitted.mockRejectedValue(new Error('mongo down'));

    const res = await submit();

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('SCORE_NOT_RECORDED');
  });

  it('still succeeds when only the achievement award fails', async () => {
    // Achievements are decoration; losing a badge must not cost a student
    // their recorded score.
    achievementService.awardQuizAchievements.mockRejectedValue(new Error('nope'));

    const res = await submit();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.newAchievements).toEqual([]);
    expect(quizService.saveQuizScore).toHaveBeenCalled();
  });

  it('answers success on the ordinary path', async () => {
    const res = await submit();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ correctAnswers: 1, totalQuestions: 2 });
  });
});
