const express = require('express');
const request = require('supertest');

jest.mock('../../src/middleware/auth', () => ({
  requireRole: () => (_req, _res, next) => next(),
}));
jest.mock('../../src/services/quiz', () => ({ getQuizzesByCourse: jest.fn() }));
jest.mock('../../src/services/quiz-schedule', () => ({
  isValidTimeZone: jest.requireActual('../../src/services/quiz-schedule').isValidTimeZone,
  shiftSchedules: jest.fn(),
}));
jest.mock('../../src/services/course-section', () => ({ getSectionsOwnedByUser: jest.fn() }));
jest.mock('../../src/services/user-course', () => ({ isUserInCourse: jest.fn() }));
jest.mock('../../src/services/answer-grading', () => ({}));
jest.mock('../../src/services/question', () => ({}));
jest.mock('../../src/services/quiz-question-flag', () => ({}));
jest.mock('../../src/services/quiz-session', () => ({}));
jest.mock('../../src/utils/auth', () => ({
  ROLES: { FACULTY: 'faculty', STAFF: 'staff', STUDENT: 'student' },
  isFaculty: jest.fn(),
}));
jest.mock('../../src/utils/course-access', () => ({ hasStaffAccessInCourse: jest.fn() }));

const quizService = require('../../src/services/quiz');
const scheduleService = require('../../src/services/quiz-schedule');
const sectionService = require('../../src/services/course-section');
const { isFaculty } = require('../../src/utils/auth');
const quizRouter = require('../../src/routes/quiz');

const URL = '/api/quiz/course/course-1/schedules/shift';

function buildApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { _id: 'user-1' };
    next();
  });
  app.use('/api/quiz', quizRouter);
  return app;
}

describe('POST /api/quiz/course/:courseId/schedules/shift', () => {
  const expected = [
    {
      quizId: 'q1',
      courseSectionId: 's1',
      oldReleaseDate: '2026-10-01T00:00:00.000Z',
      oldExpireDate: '2026-10-05T00:00:00.000Z',
    },
  ];
  const body = { quizIds: ['q1', 'q2'], amount: 7, unit: 'days', timeZone: 'America/Vancouver', expected };

  beforeEach(() => {
    jest.clearAllMocks();
    isFaculty.mockResolvedValue(true);
    quizService.getQuizzesByCourse.mockResolvedValue([{ _id: 'q1' }, { _id: 'q2' }]);
    sectionService.getSectionsOwnedByUser.mockResolvedValue([{ _id: 's1' }]);
    scheduleService.shiftSchedules.mockResolvedValue([
      { _id: 'row', quizId: 'q1', courseSectionId: 's1', flags: [] },
    ]);
  });

  it("shifts by wall-clock days, scoped to the caller's own sections", async () => {
    const res = await request(buildApp()).post(URL).send(body);

    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(true);
    expect(res.body.rows[0]).not.toHaveProperty('_id');
    expect(scheduleService.shiftSchedules).toHaveBeenCalledWith(['q1', 'q2'], { days: 7 }, {
      restrictToSectionIds: ['s1'],
      timeZone: 'America/Vancouver',
      dryRun: false,
      expected: [
        {
          quizId: 'q1',
          courseSectionId: 's1',
          oldReleaseDate: new Date(expected[0].oldReleaseDate),
          oldExpireDate: new Date(expected[0].oldExpireDate),
        },
      ],
    });
  });

  it('accepts the amount as a plain integer string', async () => {
    const res = await request(buildApp()).post(URL).send({ ...body, amount: '-3' });
    expect(res.status).toBe(200);
    expect(scheduleService.shiftSchedules.mock.calls[0][1]).toEqual({ days: -3 });
  });

  it('does not need the previewed rows for a dry run', async () => {
    const res = await request(buildApp()).post(URL).send({ ...body, expected: undefined, dryRun: true });
    expect(res.status).toBe(200);
    expect(scheduleService.shiftSchedules.mock.calls[0][2].expected).toBeUndefined();
  });

  it('converts hours to an absolute minute offset and passes dryRun through', async () => {
    const res = await request(buildApp()).post(URL).send({ ...body, amount: -2, unit: 'hours', dryRun: true });

    expect(res.body.applied).toBe(false);
    expect(scheduleService.shiftSchedules.mock.calls[0][1]).toEqual({ minutes: -120 });
    expect(scheduleService.shiftSchedules.mock.calls[0][2].dryRun).toBe(true);
  });

  it('rejects quizzes from another course', async () => {
    const res = await request(buildApp()).post(URL).send({ ...body, quizIds: ['q1', 'elsewhere'] });
    expect(res.status).toBe(404);
    expect(scheduleService.shiftSchedules).not.toHaveBeenCalled();
  });

  it.each([
    [{ amount: 0 }],
    [{ amount: 1.5 }],
    [{ unit: 'weeks' }],
    [{ quizIds: [] }],
    [{ timeZone: 'Not/AZone' }],
    [{ amount: 1000 }],
    [{ amount: true }],
    [{ amount: '0x10' }],
    [{ dryRun: 'true' }],
    [{ expected: undefined }],
    [{ expected: [{ ...expected[0], oldReleaseDate: 'soon' }] }],
  ])('rejects invalid input %j', async (override) => {
    const res = await request(buildApp()).post(URL).send({ ...body, ...override });
    expect(res.status).toBe(400);
    expect(scheduleService.shiftSchedules).not.toHaveBeenCalled();
  });

  it('surfaces a service conflict status', async () => {
    scheduleService.shiftSchedules.mockRejectedValue(Object.assign(new Error('changed'), { status: 409 }));
    const res = await request(buildApp()).post(URL).send(body);
    expect(res.status).toBe(409);
  });
});
