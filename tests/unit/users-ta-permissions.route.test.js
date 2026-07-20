// TA permission management endpoint:
// PUT /api/users/course/:courseId/ta-permissions — instructor-only (same
// guard as promotion/demotion), target must be a TA in the course, payload
// must be a boolean map of known keys. Also covers the TA-restricted paths of
// the roster (GET /course/:courseId) and access resolver.

const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

jest.mock('../../src/services/user-course', () => ({
  getCourseUsers: jest.fn(),
  createUserCourse: jest.fn(),
  deleteUserCourse: jest.fn(),
  isUserInCourse: jest.fn(),
  getUserCourseMembership: jest.fn(),
  setUserCourseRole: jest.fn(),
  setUserCourseTaPermissions: jest.fn(),
  countTaMemberships: jest.fn(),
}));

jest.mock('../../src/services/user', () => ({
  getStaffUsersNotInCourse: jest.fn(),
  getStudentsNotInCourse: jest.fn(),
  getUserById: jest.fn(),
  grantPromotedStaffAffiliation: jest.fn(),
  revokePromotedStaffAffiliation: jest.fn(),
}));

jest.mock('../../src/services/course', () => ({
  getCourseById: jest.fn(),
}));

jest.mock('../../src/services/course-section', () => ({
  getSectionsOwnedByUser: jest.fn(),
}));

const userCourseService = require('../../src/services/user-course');
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
const studentUser = { _id: 'stu-1', id: 'stu-1', puid: 'stu-1', affiliation: ['student'] };

function buildApp(user) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/users', usersRouter);
  return app;
}

const permissionsUrl = `/api/users/course/${COURSE_ID}/ta-permissions`;
const accessUrl = `/api/users/course/${COURSE_ID}/access`;
const rosterUrl = `/api/users/course/${COURSE_ID}`;

afterEach(() => {
  jest.clearAllMocks();
});

describe('PUT /api/users/course/:courseId/ta-permissions', () => {
  const taMembership = { userId: 'ta-1', courseId: COURSE_ID, courseRole: 'ta' };

  it('lets an instructor restrict a TA and replies with the effective map', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue(taMembership);

    const res = await request(buildApp(instructor))
      .put(permissionsUrl)
      .send({ userId: 'ta-1', permissions: { questionBank: false, users: false } });

    expect(res.status).toBe(200);
    expect(userCourseService.setUserCourseTaPermissions).toHaveBeenCalledWith(
      'ta-1',
      COURSE_ID,
      { questionBank: false, users: false }
    );
    // The reply expands the stored map to the full effective map.
    expect(res.body.permissions.questionBank).toBe(false);
    expect(res.body.permissions.users).toBe(false);
    expect(res.body.permissions.questionFlags).toBe(true);
  });

  it('rejects a TA caller: TAs cannot edit permissions (including their own)', async () => {
    const res = await request(buildApp(taUser))
      .put(permissionsUrl)
      .send({ userId: 'ta-1', permissions: { users: false } });

    expect(res.status).toBe(403);
    expect(userCourseService.setUserCourseTaPermissions).not.toHaveBeenCalled();
  });

  it('rejects a student caller', async () => {
    const res = await request(buildApp(studentUser))
      .put(permissionsUrl)
      .send({ userId: 'ta-1', permissions: { users: false } });

    expect(res.status).toBe(403);
    expect(userCourseService.setUserCourseTaPermissions).not.toHaveBeenCalled();
  });

  it('rejects an instructor who is not a member of the course', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(false);

    const res = await request(buildApp(instructor))
      .put(permissionsUrl)
      .send({ userId: 'ta-1', permissions: { users: false } });

    expect(res.status).toBe(403);
    expect(userCourseService.setUserCourseTaPermissions).not.toHaveBeenCalled();
  });

  it('rejects a target who is not a TA in this course', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue({
      userId: 'stu-1',
      courseId: COURSE_ID,
    });

    const res = await request(buildApp(instructor))
      .put(permissionsUrl)
      .send({ userId: 'stu-1', permissions: { users: false } });

    expect(res.status).toBe(400);
    expect(userCourseService.setUserCourseTaPermissions).not.toHaveBeenCalled();
  });

  it('rejects unknown keys (settings is not a configurable TA permission)', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue(taMembership);

    const res = await request(buildApp(instructor))
      .put(permissionsUrl)
      .send({ userId: 'ta-1', permissions: { settings: true } });

    expect(res.status).toBe(400);
    expect(userCourseService.setUserCourseTaPermissions).not.toHaveBeenCalled();
  });

  it('rejects non-boolean values and missing payloads', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue(taMembership);

    for (const permissions of [{ users: 'no' }, null, undefined, 'users']) {
      const res = await request(buildApp(instructor))
        .put(permissionsUrl)
        .send({ userId: 'ta-1', permissions });
      expect(res.status).toBe(400);
    }
    expect(userCourseService.setUserCourseTaPermissions).not.toHaveBeenCalled();
  });
});

describe('GET /api/users/course/:courseId/access (TA permission map)', () => {
  it('returns the restricted map for a TA', async () => {
    userCourseService.getUserCourseMembership.mockResolvedValue({
      userId: 'ta-1',
      courseId: COURSE_ID,
      courseRole: 'ta',
      taPermissions: { questionBank: false },
    });

    const res = await request(buildApp(taUser)).get(accessUrl);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('ta');
    expect(res.body.taPermissions.questionBank).toBe(false);
    expect(res.body.taPermissions.questionFlags).toBe(true);
  });
});

describe('GET /api/users/course/:courseId (roster gated by the users permission)', () => {
  it('blocks a TA whose map withholds the users permission', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue({
      userId: 'ta-1',
      courseId: COURSE_ID,
      courseRole: 'ta',
      taPermissions: { users: false },
    });

    const res = await request(buildApp(taUser)).get(rosterUrl);

    expect(res.status).toBe(403);
    expect(userCourseService.getCourseUsers).not.toHaveBeenCalled();
  });

  it('still allows a TA whose map grants the users permission', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue({
      userId: 'ta-1',
      courseId: COURSE_ID,
      courseRole: 'ta',
      taPermissions: { users: true, questionBank: false },
    });
    userCourseService.getCourseUsers.mockResolvedValue([
      {
        userId: 'ta-1',
        courseRole: 'ta',
        taPermissions: { users: true, questionBank: false },
        user: taUser,
        sections: [],
      },
    ]);
    courseSectionService.getSectionsOwnedByUser.mockResolvedValue([]);

    const res = await request(buildApp(taUser)).get(rosterUrl);

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    // TA rows carry the effective map so the editor modal can prefill.
    expect(res.body.users[0].taPermissions.questionBank).toBe(false);
    expect(res.body.users[0].taPermissions.dashboard).toBe(true);
  });
});
