const express = require('express');
const request = require('supertest');

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

jest.mock('../../src/utils/auth', () => ({
  isFaculty: jest.fn(),
  parseAffiliations: jest.fn(() => []),
}));

jest.mock('../../src/utils/co-instructor-permissions', () => ({
  isCourseManager: jest.fn(),
}));

const userCourseService = require('../../src/services/user-course');
const userService = require('../../src/services/user');
const accessLog = require('../../src/services/course-access-log');
const { isFaculty, parseAffiliations } = require('../../src/utils/auth');
const { isCourseManager } = require('../../src/utils/co-instructor-permissions');
const usersRouter = require('../../src/routes/users');

const OWNER = { _id: 'owner-1', affiliation: ['faculty'] };
const CO_INSTRUCTOR = { _id: 'co-1', affiliation: ['faculty'] };

const TARGET_INSTRUCTOR = { _id: 'instructor-2', affiliation: ['faculty'] };
const TARGET_STUDENT = { _id: 'student-1', affiliation: ['student'] };

function buildApp(user) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/users', usersRouter);
  return app;
}

describe('DELETE /api/users/course/:courseId/remove/:userId', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // Requester and target are both in the course by default.
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.deleteUserCourse.mockResolvedValue({ deletedCount: 1 });
    // isFaculty resolves per-user based on affiliation.
    isFaculty.mockImplementation(async (user) =>
      (user?.affiliation || []).includes('faculty')
    );
    // resetAllMocks wipes the factory's implementation; resolveCourseRole
    // needs an array back to work out the role being revoked.
    parseAffiliations.mockImplementation((user) => user?.affiliation || []);
  });

  it('lets the course owner remove another instructor', async () => {
    isCourseManager.mockResolvedValue(true);
    userService.getUserById.mockResolvedValue(TARGET_INSTRUCTOR);

    const response = await request(buildApp(OWNER)).delete(
      '/api/users/course/course-1/remove/instructor-2'
    );

    expect(response.status).toBe(200);
    expect(userCourseService.deleteUserCourse).toHaveBeenCalledWith(
      'instructor-2',
      'course-1'
    );
  });

  it('blocks a co-instructor from removing another instructor', async () => {
    isCourseManager.mockResolvedValue(false);
    userService.getUserById.mockResolvedValue(TARGET_INSTRUCTOR);

    const response = await request(buildApp(CO_INSTRUCTOR)).delete(
      '/api/users/course/course-1/remove/instructor-2'
    );

    expect(response.status).toBe(403);
    expect(response.body.error).toBe(
      'Only the course owner can remove other instructors'
    );
    expect(userCourseService.deleteUserCourse).not.toHaveBeenCalled();
  });

  it('still lets a co-instructor remove a student', async () => {
    isCourseManager.mockResolvedValue(false);
    userService.getUserById.mockResolvedValue(TARGET_STUDENT);

    const response = await request(buildApp(CO_INSTRUCTOR)).delete(
      '/api/users/course/course-1/remove/student-1'
    );

    expect(response.status).toBe(200);
    expect(userCourseService.deleteUserCourse).toHaveBeenCalledWith(
      'student-1',
      'course-1'
    );
  });

  // Issue #115: a removal is a revocation and must leave evidence.
  it('records the removal, with the role the member held, in the access log', async () => {
    isCourseManager.mockResolvedValue(false);
    userService.getUserById.mockResolvedValue(TARGET_STUDENT);
    userCourseService.getUserCourseMembership.mockResolvedValue({
      userId: 'student-1',
      courseId: 'course-1',
      source: 'manual',
    });

    await request(buildApp(CO_INSTRUCTOR)).delete(
      '/api/users/course/course-1/remove/student-1'
    );

    expect(accessLog.recordCourseAccessEvent).toHaveBeenCalledWith({
      courseId: 'course-1',
      targetUserId: 'student-1',
      actorUserId: 'co-1',
      action: 'removed',
      role: 'student',
    });
  });

  it('removing a TA also revokes the promoted staff affiliation when it was their last TA course', async () => {
    const promotedTa = {
      _id: 'ta-1',
      affiliation: ['student', 'staff'],
      staffViaTaPromotion: true,
    };
    isCourseManager.mockResolvedValue(false);
    userService.getUserById.mockResolvedValue(promotedTa);
    userCourseService.getUserCourseMembership.mockResolvedValue({
      userId: 'ta-1',
      courseId: 'course-1',
      courseRole: 'ta',
    });
    userCourseService.countTaMemberships.mockResolvedValue(0);

    const response = await request(buildApp(CO_INSTRUCTOR)).delete(
      '/api/users/course/course-1/remove/ta-1'
    );

    expect(response.status).toBe(200);
    expect(userCourseService.deleteUserCourse).toHaveBeenCalledWith('ta-1', 'course-1');
    // The membership is already gone, so there is no role to clear — only
    // the affiliation that the promotion granted.
    expect(userCourseService.setUserCourseRole).not.toHaveBeenCalled();
    expect(userService.revokePromotedStaffAffiliation).toHaveBeenCalledWith('ta-1');
    expect(accessLog.recordCourseAccessEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'removed', role: 'ta', targetUserId: 'ta-1' })
    );
  });

  it('keeps the promoted staff affiliation while the removed TA is still a TA elsewhere', async () => {
    isCourseManager.mockResolvedValue(false);
    userService.getUserById.mockResolvedValue({
      _id: 'ta-1',
      affiliation: ['student', 'staff'],
      staffViaTaPromotion: true,
    });
    userCourseService.getUserCourseMembership.mockResolvedValue({ courseRole: 'ta' });
    userCourseService.countTaMemberships.mockResolvedValue(1);

    const response = await request(buildApp(CO_INSTRUCTOR)).delete(
      '/api/users/course/course-1/remove/ta-1'
    );

    expect(response.status).toBe(200);
    expect(userService.revokePromotedStaffAffiliation).not.toHaveBeenCalled();
  });
});
