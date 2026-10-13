const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');

jest.mock('../../src/middleware/auth', () => ({
  requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));

jest.mock('../../src/services/quiz', () => ({
  getQuizzesByCourse: jest.fn(),
  getApprovedQuestionCountsForQuizzes: jest.fn(),
}));

jest.mock('../../src/services/quiz-schedule', () => ({
  getStudentSectionObjectIds: jest.fn(),
  getSchedulesForQuizzes: jest.fn(),
  resolveWindow: jest.requireActual('../../src/services/quiz-schedule').resolveWindow,
}));

jest.mock('../../src/services/quiz-session', () => ({
  getUnsubmittedQuizIds: jest.fn(),
}));

jest.mock('../../src/services/course-section', () => ({}));
jest.mock('../../src/services/user-course', () => ({ isUserInCourse: jest.fn() }));
jest.mock('../../src/services/answer-grading', () => ({}));
jest.mock('../../src/services/question', () => ({}));
jest.mock('../../src/services/quiz-question-flag', () => ({}));

jest.mock('../../src/utils/auth', () => ({
  ROLES: { FACULTY: 'faculty', STAFF: 'staff', STUDENT: 'student' },
  isFaculty: jest.fn(),
}));

jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn(),
}));

const quizService = require('../../src/services/quiz');
const scheduleService = require('../../src/services/quiz-schedule');
const quizSessionService = require('../../src/services/quiz-session');
const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const quizRouter = require('../../src/routes/quiz');

const SECTION_ID = new ObjectId();
const HOUR = 60 * 60 * 1000;

function buildApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { _id: 'student-1' };
    next();
  });
  app.use('/api/quiz', quizRouter);
  return app;
}

// One published quiz per [releaseOffset, expireOffset] in hours from now.
function scheduleQuizzes(windows) {
  const quizzes = Object.keys(windows).map((name) => ({ _id: new ObjectId(), name, published: true }));
  const schedules = new Map(
    quizzes.map((quiz) => {
      const [releaseOffset, expireOffset] = windows[quiz.name];
      return [
        quiz._id.toString(),
        [{
          courseSectionId: SECTION_ID,
          releaseDate: new Date(Date.now() + releaseOffset * HOUR),
          expireDate: new Date(Date.now() + expireOffset * HOUR),
        }],
      ];
    })
  );
  quizService.getQuizzesByCourse.mockResolvedValue(quizzes);
  scheduleService.getSchedulesForQuizzes.mockResolvedValue(schedules);
  return Object.fromEntries(quizzes.map((quiz) => [quiz.name, quiz._id.toString()]));
}

describe('GET /api/quiz/course/:courseId/student-overview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hasStaffAccessInCourse.mockResolvedValue(false);
    scheduleService.getStudentSectionObjectIds.mockResolvedValue([SECTION_ID]);
    quizService.getApprovedQuestionCountsForQuizzes.mockResolvedValue(new Map());
  });

  it('lists open quizzes plus closed ones the student can still finish', async () => {
    const ids = scheduleQuizzes({
      Open: [-1, 24],
      Shifted: [24, 48],
      Expired: [-48, -1],
      Upcoming: [24, 48],
    });
    quizSessionService.getUnsubmittedQuizIds.mockResolvedValue(new Set([ids.Shifted, ids.Expired]));

    const res = await request(buildApp()).get('/api/quiz/course/course-1/student-overview');

    expect(res.status).toBe(200);
    expect(res.body.quizzes.map((q) => [q.name, q.resumeOnly])).toEqual([
      ['Open', undefined],
      ['Shifted', true],
      ['Expired', true],
    ]);
  });
});
