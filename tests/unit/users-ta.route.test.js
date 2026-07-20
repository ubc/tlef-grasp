// TA promotion/demotion endpoints (issue #40):
// POST /api/users/course/:courseId/promote and /demote. Server-side
// authorization: only faculty course members may change roles; promotion
// keeps the student affiliation and adds staff; demotion is scoped to the
// course and only revokes the promoted staff affiliation once the user is a
// TA nowhere else.

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

// Effective TA permission map when nothing has been restricted (the default).
const FULL_TA_PERMISSIONS = {
  dashboard: true,
  courseMaterials: true,
  questionGeneration: true,
  questionBank: true,
  quizzes: true,
  quizScores: true,
  questionFlags: true,
  users: true,
};

const promoteUrl = `/api/users/course/${COURSE_ID}/promote`;
const demoteUrl = `/api/users/course/${COURSE_ID}/demote`;
const accessUrl = `/api/users/course/${COURSE_ID}/access`;

afterEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/users/course/:courseId/access', () => {
  it('grants instructor access in the course where the user is a TA', async () => {
    userCourseService.getUserCourseMembership.mockResolvedValue({
      userId: 'ta-1',
      courseId: COURSE_ID,
      courseRole: 'ta',
    });

    const res = await request(buildApp(taUser)).get(accessUrl);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      hasStaffAccess: true,
      role: 'ta',
      taPermissions: FULL_TA_PERMISSIONS,
    });
  });

  it('resolves the same promoted account as a student in another course', async () => {
    userCourseService.getUserCourseMembership.mockResolvedValue({
      userId: 'ta-1',
      courseId: COURSE_ID,
    });
    userService.getUserById.mockResolvedValue(taUser);

    const res = await request(buildApp(taUser)).get(accessUrl);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      hasStaffAccess: false,
      role: 'student',
      taPermissions: FULL_TA_PERMISSIONS,
    });
  });
});

describe('GET /api/users/course/:courseId', () => {
  it('lets a TA view the Users page roster in their TA course', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue({ courseRole: 'ta' });
    userCourseService.getCourseUsers.mockResolvedValue([
      { userId: 'ta-1', courseRole: 'ta', user: taUser, sections: [] },
    ]);
    courseSectionService.getSectionsOwnedByUser.mockResolvedValue([]);

    const res = await request(buildApp(taUser)).get(`/api/users/course/${COURSE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].courseRole).toBe('ta');
  });

  it('blocks a promoted TA from viewing another course roster as staff', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue({
      userId: 'ta-1',
      courseId: COURSE_ID,
    });
    userService.getUserById.mockResolvedValue(taUser);

    const res = await request(buildApp(taUser)).get(`/api/users/course/${COURSE_ID}`);

    expect(res.status).toBe(403);
    expect(userCourseService.getCourseUsers).not.toHaveBeenCalled();
  });
});

describe('POST /api/users/course/:courseId/promote', () => {
  it('lets an instructor promote a student to TA, keeping student and gaining staff', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue({
      userId: 'stu-1',
      courseId: COURSE_ID,
    });
    userService.getUserById.mockResolvedValue(studentUser);

    const res = await request(buildApp(instructor)).post(promoteUrl).send({ userId: 'stu-1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(userCourseService.setUserCourseRole).toHaveBeenCalledWith('stu-1', COURSE_ID, 'ta');
    // Staff affiliation is added via $addToSet + promotion marker; the student
    // affiliation is never removed by this service.
    expect(userService.grantPromotedStaffAffiliation).toHaveBeenCalledWith('stu-1');
  });

  it('rejects a TA (staff) caller: TAs cannot promote users', async () => {
    const res = await request(buildApp(taUser)).post(promoteUrl).send({ userId: 'stu-1' });

    expect(res.status).toBe(403);
    expect(userCourseService.setUserCourseRole).not.toHaveBeenCalled();
    expect(userService.grantPromotedStaffAffiliation).not.toHaveBeenCalled();
  });

  it('rejects a regular student caller', async () => {
    const res = await request(buildApp(studentUser)).post(promoteUrl).send({ userId: 'stu-2' });

    expect(res.status).toBe(403);
    expect(userCourseService.setUserCourseRole).not.toHaveBeenCalled();
  });

  it('rejects an instructor who is not a member of the course', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(false);

    const res = await request(buildApp(instructor)).post(promoteUrl).send({ userId: 'stu-1' });

    expect(res.status).toBe(403);
    expect(userCourseService.setUserCourseRole).not.toHaveBeenCalled();
  });

  it('rejects self-promotion', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);

    const res = await request(buildApp(instructor)).post(promoteUrl).send({ userId: 'prof-1' });

    expect(res.status).toBe(400);
    expect(userCourseService.setUserCourseRole).not.toHaveBeenCalled();
  });

  it('rejects promoting a user who is not in the course', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue(null);

    const res = await request(buildApp(instructor)).post(promoteUrl).send({ userId: 'stu-1' });

    expect(res.status).toBe(404);
  });

  it('rejects promoting a user who is already a TA in this course', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue({ courseRole: 'ta' });

    const res = await request(buildApp(instructor)).post(promoteUrl).send({ userId: 'stu-1' });

    expect(res.status).toBe(409);
    expect(userCourseService.setUserCourseRole).not.toHaveBeenCalled();
  });

  it('rejects promoting an instructor (cannot change another instructor)', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue({
      userId: 'prof-2',
      courseId: COURSE_ID,
    });
    userService.getUserById.mockResolvedValue({
      _id: 'prof-2',
      puid: 'prof-2',
      affiliation: ['faculty'],
    });

    const res = await request(buildApp(instructor)).post(promoteUrl).send({ userId: 'prof-2' });

    expect(res.status).toBe(400);
    expect(userCourseService.setUserCourseRole).not.toHaveBeenCalled();
  });

  it('rejects promoting genuine SAML staff', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue({
      userId: 'staff-1',
      courseId: COURSE_ID,
    });
    userService.getUserById.mockResolvedValue({
      _id: 'staff-1',
      puid: 'staff-1',
      affiliation: ['staff'],
    });

    const res = await request(buildApp(instructor)).post(promoteUrl).send({ userId: 'staff-1' });

    expect(res.status).toBe(400);
    expect(userCourseService.setUserCourseRole).not.toHaveBeenCalled();
  });

  it('allows promoting an existing TA of another course who is a student here', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue({
      userId: 'ta-1',
      courseId: COURSE_ID,
    });
    userService.getUserById.mockResolvedValue(taUser);

    const res = await request(buildApp(instructor)).post(promoteUrl).send({ userId: 'ta-1' });

    expect(res.status).toBe(200);
    expect(userCourseService.setUserCourseRole).toHaveBeenCalledWith('ta-1', COURSE_ID, 'ta');
  });

  it('requires a userId', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);

    const res = await request(buildApp(instructor)).post(promoteUrl).send({});

    expect(res.status).toBe(400);
  });
});

describe('POST /api/users/course/:courseId/demote', () => {
  it('demotes a TA, clears the course role, and revokes promoted staff when it was their last TA course', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue({ courseRole: 'ta' });
    userCourseService.countTaMemberships.mockResolvedValue(0);
    userService.getUserById.mockResolvedValue(taUser);

    const res = await request(buildApp(instructor)).post(demoteUrl).send({ userId: 'ta-1' });

    expect(res.status).toBe(200);
    expect(userCourseService.setUserCourseRole).toHaveBeenCalledWith('ta-1', COURSE_ID, null);
    expect(userService.revokePromotedStaffAffiliation).toHaveBeenCalledWith('ta-1');
  });

  it('keeps the staff affiliation while the user is still a TA in another course', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue({ courseRole: 'ta' });
    userCourseService.countTaMemberships.mockResolvedValue(1);
    userService.getUserById.mockResolvedValue(taUser);

    const res = await request(buildApp(instructor)).post(demoteUrl).send({ userId: 'ta-1' });

    expect(res.status).toBe(200);
    expect(userCourseService.setUserCourseRole).toHaveBeenCalledWith('ta-1', COURSE_ID, null);
    expect(userService.revokePromotedStaffAffiliation).not.toHaveBeenCalled();
  });

  it('never revokes a staff affiliation that did not come from a promotion', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue({ courseRole: 'ta' });
    userCourseService.countTaMemberships.mockResolvedValue(0);
    userService.getUserById.mockResolvedValue({
      _id: 'staff-1',
      puid: 'staff-1',
      affiliation: ['staff', 'student'],
      // no staffViaTaPromotion: staff came from SAML
    });

    const res = await request(buildApp(instructor)).post(demoteUrl).send({ userId: 'staff-1' });

    expect(res.status).toBe(200);
    expect(userService.revokePromotedStaffAffiliation).not.toHaveBeenCalled();
  });

  it('rejects demoting a user who is not a TA in this course', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);
    userCourseService.getUserCourseMembership.mockResolvedValue({
      userId: 'stu-1',
      courseId: COURSE_ID,
    });

    const res = await request(buildApp(instructor)).post(demoteUrl).send({ userId: 'stu-1' });

    expect(res.status).toBe(400);
    expect(userCourseService.setUserCourseRole).not.toHaveBeenCalled();
  });

  it('rejects TA and student callers', async () => {
    for (const caller of [taUser, studentUser]) {
      const res = await request(buildApp(caller)).post(demoteUrl).send({ userId: 'ta-1' });
      expect(res.status).toBe(403);
    }
    expect(userCourseService.setUserCourseRole).not.toHaveBeenCalled();
  });
});
