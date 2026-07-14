const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/user-course', () => ({
  getCourseUsers: jest.fn(),
  createUserCourse: jest.fn(),
  deleteUserCourse: jest.fn(),
  isUserInCourse: jest.fn(),
}));

jest.mock('../../src/services/user', () => ({
  getStaffUsersNotInCourse: jest.fn(),
  getStudentsNotInCourse: jest.fn(),
  getUserById: jest.fn(),
}));

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
const { isFaculty } = require('../../src/utils/auth');
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
});
