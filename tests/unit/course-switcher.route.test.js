// Two writes back the reorderable course switcher, and each has one rule that
// is easy to lose in a refactor:
//   - the nickname is course-wide (students see it), so only the owner may set
//     it — not everyone with a write bit in the course;
//   - the order is per-user, so the handler must reorder the *caller's* rows
//     and never take a user id from the request body.

const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/course', () => ({
  createCourse: jest.fn(),
  updateCourseNickname: jest.fn(),
  MAX_NICKNAME_LENGTH: 60,
  getCourseById: jest.fn(),
  getCourseByCode: jest.fn(),
  findAvailableCourseCode: jest.fn(),
  getCourseByEnrollmentCode: jest.fn(),
  listCoursesForEnrollment: jest.fn(),
  updateCourseEnrollmentCode: jest.fn(),
  archiveCourse: jest.fn(),
  unarchiveCourse: jest.fn(),
  listArchivedCoursesForOwner: jest.fn(),
}));

jest.mock('../../src/services/user-course', () => ({
  createUserCourse: jest.fn(),
  getUserCourses: jest.fn(),
  setUserCourseOrder: jest.fn(),
  isUserInCourse: jest.fn(),
  getCourseUsers: jest.fn(),
}));

jest.mock('../../src/utils/co-instructor-permissions', () => ({
  assertCoInstructorPermission: jest.fn(),
  isCourseManager: jest.fn(),
  PERMISSION_KEYS: {},
}));

const courseService = require('../../src/services/course');
const userCourseService = require('../../src/services/user-course');
const { isCourseManager } = require('../../src/utils/co-instructor-permissions');
const coursesController = require('../../src/controllers/courses');

const OWNER = { _id: 'owner-1' };
const COURSE = { _id: 'course-1', courseName: 'CHEM 121' };

function buildApp(user = OWNER) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.patch('/courses/:courseId/nickname', coursesController.updateCourseNicknameHandler);
  app.put('/courses/order', coursesController.reorderMyCoursesHandler);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  courseService.getCourseById.mockResolvedValue(COURSE);
  courseService.updateCourseNickname.mockResolvedValue('Tuesday cohort');
  userCourseService.setUserCourseOrder.mockResolvedValue(2);
  isCourseManager.mockResolvedValue(true);
});

describe('PATCH /courses/:courseId/nickname', () => {
  it('stores the nickname for the owner', async () => {
    const res = await request(buildApp())
      .patch('/courses/course-1/nickname')
      .send({ nickname: 'Tuesday cohort' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, nickname: 'Tuesday cohort' });
    expect(courseService.updateCourseNickname).toHaveBeenCalledWith(
      'course-1',
      'Tuesday cohort'
    );
  });

  it('refuses a non-owner even though they may write in the course', async () => {
    // A co-instructor or TA can edit questions here; renaming the course for
    // every student is a different thing, and belongs to the owner.
    isCourseManager.mockResolvedValue(false);

    const res = await request(buildApp({ _id: 'co-instructor-9' }))
      .patch('/courses/course-1/nickname')
      .send({ nickname: 'mine now' });

    expect(res.status).toBe(403);
    expect(courseService.updateCourseNickname).not.toHaveBeenCalled();
  });

  it('404s before the ownership check when the course is gone', async () => {
    courseService.getCourseById.mockResolvedValue(null);

    const res = await request(buildApp())
      .patch('/courses/course-1/nickname')
      .send({ nickname: 'x' });

    expect(res.status).toBe(404);
    expect(courseService.updateCourseNickname).not.toHaveBeenCalled();
  });

  it('rejects a non-string nickname', async () => {
    const res = await request(buildApp())
      .patch('/courses/course-1/nickname')
      .send({ nickname: { $ne: null } });

    expect(res.status).toBe(400);
    expect(courseService.updateCourseNickname).not.toHaveBeenCalled();
  });

  it('accepts an empty nickname as a clear', async () => {
    courseService.updateCourseNickname.mockResolvedValue('');

    const res = await request(buildApp())
      .patch('/courses/course-1/nickname')
      .send({ nickname: '' });

    expect(res.status).toBe(200);
    expect(res.body.nickname).toBe('');
    expect(courseService.updateCourseNickname).toHaveBeenCalledWith('course-1', '');
  });
});

describe('PUT /courses/order', () => {
  it('reorders the caller\'s own memberships', async () => {
    const res = await request(buildApp())
      .put('/courses/order')
      .send({ courseIds: ['course-2', 'course-1'] });

    expect(res.status).toBe(200);
    expect(userCourseService.setUserCourseOrder).toHaveBeenCalledWith('owner-1', [
      'course-2',
      'course-1',
    ]);
  });

  it('takes the user id from the session, never from the body', async () => {
    await request(buildApp())
      .put('/courses/order')
      .send({ courseIds: ['course-1'], userId: 'somebody-else' });

    expect(userCourseService.setUserCourseOrder).toHaveBeenCalledWith('owner-1', [
      'course-1',
    ]);
  });

  it('rejects a body that is not an array of ids', async () => {
    const app = buildApp();

    const notArray = await request(app).put('/courses/order').send({ courseIds: 'course-1' });
    expect(notArray.status).toBe(400);

    const notStrings = await request(app)
      .put('/courses/order')
      .send({ courseIds: [{ courseId: 'course-1' }] });
    expect(notStrings.status).toBe(400);

    expect(userCourseService.setUserCourseOrder).not.toHaveBeenCalled();
  });
});
