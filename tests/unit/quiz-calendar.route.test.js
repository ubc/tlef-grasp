const express = require('express');
const request = require('supertest');

jest.mock('../../src/middleware/auth', () => ({
  requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../../src/services/quiz', () => ({
  getQuizzesByCourse: jest.fn(),
  getUserScoresForCourse: jest.fn(),
}));

jest.mock('../../src/services/quiz-schedule', () => ({
  getStudentSectionObjectIds: jest.fn(),
  getSchedulesForQuizzes: jest.fn(),
}));

jest.mock('../../src/services/course-section', () => ({
  getCourseSections: jest.fn(),
  getSectionsOwnedByUser: jest.fn(),
}));

jest.mock('../../src/services/user-course', () => ({
  isUserInCourse: jest.fn(),
}));

jest.mock('../../src/services/answer-grading', () => ({}));
jest.mock('../../src/services/question', () => ({}));
jest.mock('../../src/services/quiz-question-flag', () => ({}));
jest.mock('../../src/services/quiz-session', () => ({}));

jest.mock('../../src/utils/auth', () => ({
  ROLES: { FACULTY: 'faculty', STAFF: 'staff', STUDENT: 'student' },
  isFaculty: jest.fn(),
}));

jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn(),
}));

const quizService = require('../../src/services/quiz');
const scheduleService = require('../../src/services/quiz-schedule');
const sectionService = require('../../src/services/course-section');
const { isUserInCourse } = require('../../src/services/user-course');
const { isFaculty } = require('../../src/utils/auth');
const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const quizRouter = require('../../src/routes/quiz');

const FROM = '2026-07-01T00:00:00.000Z';
const TO = '2026-08-01T00:00:00.000Z';
const URL = `/api/quiz/course/course-1/calendar?from=${FROM}&to=${TO}`;

function buildApp(user = { _id: 'user-1' }) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/quiz', quizRouter);
  return app;
}

describe('GET /api/quiz/course/:courseId/calendar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isFaculty.mockResolvedValue(false);
    hasStaffAccessInCourse.mockResolvedValue(false);
    isUserInCourse.mockResolvedValue(true);
    quizService.getUserScoresForCourse.mockResolvedValue([]);
  });

  it('returns only published, section-scoped windows to a student', async () => {
    quizService.getQuizzesByCourse.mockResolvedValue([
      { _id: 'published', name: 'Published Quiz', published: true },
      { _id: 'draft', name: 'Draft Quiz', published: false },
    ]);
    sectionService.getCourseSections.mockResolvedValue([
      { _id: { toString: () => 'section-1' }, sectionNumber: '001' },
    ]);
    scheduleService.getStudentSectionObjectIds.mockResolvedValue(['section-1']);
    scheduleService.getSchedulesForQuizzes.mockResolvedValue(new Map([
      ['published', [{
        courseSectionId: 'section-1',
        releaseDate: new Date('2026-07-10T16:00:00.000Z'),
        expireDate: new Date('2026-07-20T23:00:00.000Z'),
      }]],
    ]));

    const response = await request(buildApp()).get(URL);

    expect(response.status).toBe(200);
    expect(response.body.audience).toBe('student');
    expect(response.body.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ quizId: 'published', type: 'release' }),
      expect.objectContaining({ quizId: 'published', type: 'deadline' }),
    ]));
    expect(response.body.events.every((event) => event.quizId === 'published')).toBe(true);
    expect(response.body.events.every((event) => !('sectionId' in event))).toBe(true);
    expect(scheduleService.getSchedulesForQuizzes).toHaveBeenCalledWith(
      ['published'],
      ['section-1']
    );
  });

  it('returns owned-section events and published unscheduled quizzes to an instructor', async () => {
    isFaculty.mockResolvedValue(true);
    hasStaffAccessInCourse.mockResolvedValue(true);
    quizService.getQuizzesByCourse.mockResolvedValue([
      { _id: 'scheduled', name: 'Scheduled Quiz', published: true },
      { _id: 'unscheduled', name: 'Needs Schedule', published: true },
      { _id: 'draft', name: 'Draft Quiz', published: false },
    ]);
    sectionService.getSectionsOwnedByUser.mockResolvedValue([
      { _id: { toString: () => 'owned-section' }, sectionNumber: '002' },
    ]);
    scheduleService.getSchedulesForQuizzes.mockResolvedValue(new Map([
      ['scheduled', [{
        courseSectionId: 'owned-section',
        releaseDate: new Date('2026-07-10T16:00:00.000Z'),
        expireDate: new Date('2026-07-20T23:00:00.000Z'),
      }]],
    ]));

    const response = await request(buildApp()).get(URL);

    expect(response.status).toBe(200);
    expect(response.body.audience).toBe('instructor');
    expect(response.body.events[0].sectionLabel).toBe('002');
    expect(response.body.unscheduledQuizzes).toEqual([
      { id: 'unscheduled', name: 'Needs Schedule' },
    ]);
    expect(scheduleService.getSchedulesForQuizzes).toHaveBeenCalledWith(
      ['scheduled', 'unscheduled', 'draft'],
      ['owned-section']
    );
  });

  it('rejects invalid ranges before querying course data', async () => {
    const response = await request(buildApp()).get(
      '/api/quiz/course/course-1/calendar?from=bad&to=2026-08-01T00:00:00.000Z'
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/valid ascending date range/);
    expect(quizService.getQuizzesByCourse).not.toHaveBeenCalled();
  });

  it('forbids a non-member student', async () => {
    isUserInCourse.mockResolvedValue(false);

    const response = await request(buildApp()).get(URL);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('You are not a member of this course');
  });
});
