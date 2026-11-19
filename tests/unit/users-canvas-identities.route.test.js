// The users API never sends a person's Canvas identities. Roster sync stores
// each student's Canvas account under grasp_user.lmsAccounts (SIS user id,
// login id, Canvas name); the Users page is open to TAs, so its rows, and the
// faculty-only "not in course" lists, must carry chosen fields only, never the
// user document.

const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

jest.mock('../../src/services/user-course', () => {
  const { MEMBERSHIP_SOURCES } = jest.requireActual('../../src/services/user-course');
  return {
    MEMBERSHIP_SOURCES,
    getCourseUsers: jest.fn(),
    createUserCourse: jest.fn(),
    deleteUserCourse: jest.fn(),
    isUserInCourse: jest.fn(),
    getUserCourseMembership: jest.fn(),
    setUserCourseRole: jest.fn(),
    setUserCourseTaPermissions: jest.fn(),
    countTaMemberships: jest.fn(),
  };
});

jest.mock('../../src/services/user', () => ({
  getStaffUsersNotInCourse: jest.fn(),
  getStudentsNotInCourse: jest.fn(),
  searchUsersNotInCourse: jest.fn(),
  getUserById: jest.fn(),
  grantPromotedStaffAffiliation: jest.fn(),
  revokePromotedStaffAffiliation: jest.fn(),
}));

jest.mock('../../src/services/course-access-log', () => {
  const { ACCESS_ACTIONS } = jest.requireActual('../../src/services/course-access-log');
  return {
    ACCESS_ACTIONS,
    recordCourseAccessEvent: jest.fn(),
    getCourseAccessLog: jest.fn(),
  };
});

jest.mock('../../src/services/course', () => ({
  getCourseById: jest.fn(),
}));

jest.mock('../../src/services/course-section', () => ({
  getSectionsOwnedByUser: jest.fn(),
}));

const userCourseService = require('../../src/services/user-course');
const userService = require('../../src/services/user');
const courseSectionService = require('../../src/services/course-section');
const usersRouter = require('../../src/routes/users');

const COURSE_ID = 'course-1';

const instructor = { _id: 'prof-1', id: 'prof-1', puid: 'prof-1', affiliation: ['faculty'] };
const taUser = {
  _id: 'ta-1',
  id: 'ta-1',
  puid: 'ta-1',
  affiliation: ['student', 'staff'],
  staffViaTaPromotion: true,
};

// What roster sync records for a student (services/user.js upsertUserLmsAccount).
const CANVAS_ACCOUNT = {
  provider: 'canvas',
  instance: 'https://canvas.example.test',
  externalUserId: '9001',
  sisUserId: 'S7654321',
  loginId: 'stu-cwl-login',
  name: 'Canvas Name',
};
const CANVAS_VALUES = /lmsAccounts|S7654321|stu-cwl-login|Canvas Name/;

function buildApp(user) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/users', usersRouter);
  return app;
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/users/course/:courseId', () => {
  it('sends a TA the roster without anyone\'s user document or Canvas identities', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue({ courseRole: 'ta' });
    // getCourseUsers keeps the full document under `user` for the role checks.
    userCourseService.getCourseUsers.mockResolvedValue([
      {
        userId: 'ta-1',
        courseRole: 'ta',
        displayName: 'TA One',
        user: { ...taUser, lmsAccounts: [CANVAS_ACCOUNT] },
        sections: [],
      },
      {
        userId: 'stu-1',
        source: 'manual',
        displayName: 'Student One',
        email: 'stu1@student.ubc.ca',
        user: { _id: 'stu-1', puid: 'stu-1', affiliation: ['student'], lmsAccounts: [CANVAS_ACCOUNT] },
        sections: [],
      },
    ]);
    courseSectionService.getSectionsOwnedByUser.mockResolvedValue([]);

    const res = await request(buildApp(taUser)).get(`/api/users/course/${COURSE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.users.map((row) => [row.userId, row.courseRole])).toEqual([
      ['ta-1', 'ta'],
      ['stu-1', 'student'],
    ]);
    expect(res.body.users[1]).toEqual(
      expect.objectContaining({ displayName: 'Student One', email: 'stu1@student.ubc.ca' })
    );
    for (const row of res.body.users) expect(row).not.toHaveProperty('user');
    expect(JSON.stringify(res.body)).not.toMatch(CANVAS_VALUES);
  });

  it('sends an instructor their section\'s students without Canvas identities', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue({});
    userCourseService.getCourseUsers.mockResolvedValue([
      {
        userId: 'stu-2',
        source: 'roster-sync',
        displayName: 'Student Two',
        user: { _id: 'stu-2', puid: 'stu-2', affiliation: ['student'], lmsAccounts: [CANVAS_ACCOUNT] },
        sections: ['101'],
      },
    ]);
    courseSectionService.getSectionsOwnedByUser.mockResolvedValue([{ sectionId: '101' }]);

    const res = await request(buildApp(instructor)).get(`/api/users/course/${COURSE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([
      expect.objectContaining({ userId: 'stu-2', sections: ['101'], courseRole: 'student' }),
    ]);
    expect(res.body.users[0]).not.toHaveProperty('user');
    expect(JSON.stringify(res.body)).not.toMatch(CANVAS_VALUES);
  });
});

describe('GET /api/users/*/not-in-course/:courseId', () => {
  const staffDoc = {
    _id: 'staff-1',
    puid: 'staff-1',
    email: 'staff1@ubc.ca',
    displayName: 'Staff One',
    legalName: 'Staff One',
    affiliation: ['staff'],
    lmsAccounts: [CANVAS_ACCOUNT],
  };
  const studentDoc = {
    _id: 'stu-3',
    puid: 'stu-3',
    email: 'stu3@student.ubc.ca',
    displayName: 'Student Three',
    legalName: 'Student Three',
    affiliation: ['student'],
    lmsAccounts: [CANVAS_ACCOUNT],
  };
  const summary = (doc) => ({
    _id: doc._id,
    email: doc.email,
    displayName: doc.displayName,
    legalName: doc.legalName,
    affiliation: doc.affiliation,
  });

  beforeEach(() => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userService.getStaffUsersNotInCourse.mockResolvedValue([staffDoc]);
    userService.getStudentsNotInCourse.mockResolvedValue([studentDoc]);
  });

  it.each([
    ['staff', () => [summary(staffDoc)]],
    ['students', () => [summary(studentDoc)]],
    ['all', () => [
      { ...summary(staffDoc), role: 'staff' },
      { ...summary(studentDoc), role: 'student' },
    ]],
  ])('/%s lists accounts by summary fields only', async (list, expected) => {
    const res = await request(buildApp(instructor))
      .get(`/api/users/${list}/not-in-course/${COURSE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.users).toEqual(expected());
    expect(JSON.stringify(res.body)).not.toMatch(CANVAS_VALUES);
  });
});
