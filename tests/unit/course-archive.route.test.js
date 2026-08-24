// Archiving is GRASP's soft delete. Two things about it are easy to get wrong
// and are pinned here: only the owner may archive or unarchive, and unarchiving
// has to cope with the course code having been released and re-taken while the
// course was away.

const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/course', () => ({
  createCourse: jest.fn(),
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

jest.mock('../../src/utils/co-instructor-permissions', () => ({
  assertCoInstructorPermission: jest.fn(),
  isCourseManager: jest.fn(),
  PERMISSION_KEYS: {},
}));

const courseService = require('../../src/services/course');
const { isCourseManager } = require('../../src/utils/co-instructor-permissions');
const coursesController = require('../../src/controllers/courses');

const OWNER = { _id: 'owner-1' };

const ARCHIVED = {
  _id: 'course-1',
  courseName: 'CHEM 121',
  courseCode: 'chem-121-v',
  courseAccess: 'secret-invite-code',
  archived: true,
};

const LIVE = { _id: 'course-1', courseName: 'CHEM 121', courseCode: 'chem-121-v' };

function buildApp(user = OWNER) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.get('/courses/archived', coursesController.getArchivedCoursesHandler);
  app.post('/courses/:courseId/archive', coursesController.archiveCourseHandler);
  app.post('/courses/:courseId/unarchive', coursesController.unarchiveCourseHandler);
  return app;
}

describe('POST /courses/:courseId/archive', () => {
  beforeEach(() => {
    isCourseManager.mockResolvedValue(true);
    courseService.archiveCourse.mockResolvedValue({ modifiedCount: 1 });
  });

  it('archives a live course for its owner', async () => {
    courseService.getCourseById
      .mockResolvedValueOnce(LIVE)
      .mockResolvedValueOnce({ ...LIVE, archived: true });

    const res = await request(buildApp()).post('/courses/course-1/archive');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.course.archived).toBe(true);
    expect(courseService.archiveCourse).toHaveBeenCalledWith('course-1', 'owner-1');
  });

  it('refuses anyone who is not the owner or an app administrator', async () => {
    courseService.getCourseById.mockResolvedValue(LIVE);
    isCourseManager.mockResolvedValue(false);

    const res = await request(buildApp({ _id: 'co-instructor' })).post(
      '/courses/course-1/archive'
    );

    expect(res.status).toBe(403);
    expect(courseService.archiveCourse).not.toHaveBeenCalled();
  });

  it('404s on a course that does not exist', async () => {
    courseService.getCourseById.mockResolvedValue(null);
    const res = await request(buildApp()).post('/courses/course-1/archive');
    expect(res.status).toBe(404);
    expect(courseService.archiveCourse).not.toHaveBeenCalled();
  });

  it('refuses to archive a course that is already archived', async () => {
    courseService.getCourseById.mockResolvedValue(ARCHIVED);
    const res = await request(buildApp()).post('/courses/course-1/archive');
    expect(res.status).toBe(409);
    expect(courseService.archiveCourse).not.toHaveBeenCalled();
  });

  it('never returns the invite code', async () => {
    courseService.getCourseById
      .mockResolvedValueOnce(LIVE)
      .mockResolvedValueOnce({ ...ARCHIVED });

    const res = await request(buildApp()).post('/courses/course-1/archive');

    expect(res.body.course).not.toHaveProperty('courseAccess');
  });
});

describe('POST /courses/:courseId/unarchive', () => {
  beforeEach(() => {
    isCourseManager.mockResolvedValue(true);
    courseService.unarchiveCourse.mockResolvedValue({ modifiedCount: 1 });
    courseService.getCourseByCode.mockResolvedValue(null);
  });

  it('restores the course when its code is still free', async () => {
    courseService.getCourseById
      .mockResolvedValueOnce(ARCHIVED)
      .mockResolvedValueOnce(LIVE);

    const res = await request(buildApp()).post('/courses/course-1/unarchive');

    expect(res.status).toBe(200);
    expect(res.body.course.archived).toBeUndefined();
    expect(courseService.unarchiveCourse).toHaveBeenCalledWith('course-1', undefined);
  });

  it('refuses with code_conflict when another course took the code', async () => {
    courseService.getCourseById.mockResolvedValue(ARCHIVED);
    courseService.getCourseByCode.mockResolvedValue({
      _id: 'course-2',
      courseName: 'CHEM 121 (2026W)',
      courseCode: 'chem-121-v',
    });
    courseService.findAvailableCourseCode.mockResolvedValue('chem-121-v-1');

    const res = await request(buildApp()).post('/courses/course-1/unarchive');

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('code_conflict');
    expect(res.body.conflictingCourseName).toBe('CHEM 121 (2026W)');
    expect(res.body.suggestedCode).toBe('chem-121-v-1');
    expect(courseService.unarchiveCourse).not.toHaveBeenCalled();
  });

  it('restores under a replacement code when the owner supplies one', async () => {
    courseService.getCourseById
      .mockResolvedValueOnce(ARCHIVED)
      .mockResolvedValueOnce({ ...LIVE, courseCode: 'chem-121-v-archive' });

    const res = await request(buildApp())
      .post('/courses/course-1/unarchive')
      .send({ courseCode: 'chem-121-v-archive' });

    expect(res.status).toBe(200);
    expect(courseService.getCourseByCode).toHaveBeenCalledWith('chem-121-v-archive');
    expect(courseService.unarchiveCourse).toHaveBeenCalledWith(
      'course-1',
      'chem-121-v-archive'
    );
  });

  it('refuses a replacement code that is itself taken', async () => {
    courseService.getCourseById.mockResolvedValue(ARCHIVED);
    courseService.getCourseByCode.mockResolvedValue({
      _id: 'course-3',
      courseName: 'Something Else',
    });
    courseService.findAvailableCourseCode.mockResolvedValue('taken-code-1');

    const res = await request(buildApp())
      .post('/courses/course-1/unarchive')
      .send({ courseCode: 'taken-code' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('code_conflict');
    expect(courseService.unarchiveCourse).not.toHaveBeenCalled();
  });

  it('refuses anyone who is not the owner or an app administrator', async () => {
    courseService.getCourseById.mockResolvedValue(ARCHIVED);
    isCourseManager.mockResolvedValue(false);

    const res = await request(buildApp({ _id: 'co-instructor' })).post(
      '/courses/course-1/unarchive'
    );

    expect(res.status).toBe(403);
    expect(courseService.unarchiveCourse).not.toHaveBeenCalled();
  });

  it('refuses to unarchive a course that is not archived', async () => {
    courseService.getCourseById.mockResolvedValue(LIVE);
    const res = await request(buildApp()).post('/courses/course-1/unarchive');
    expect(res.status).toBe(409);
    expect(courseService.unarchiveCourse).not.toHaveBeenCalled();
  });
});

describe('GET /courses/archived', () => {
  it('lists the caller’s archived courses without their invite codes', async () => {
    courseService.listArchivedCoursesForOwner.mockResolvedValue([ARCHIVED]);

    const res = await request(buildApp()).get('/courses/archived');

    expect(res.status).toBe(200);
    expect(courseService.listArchivedCoursesForOwner).toHaveBeenCalledWith('owner-1');
    expect(res.body.courses).toHaveLength(1);
    expect(res.body.courses[0]).not.toHaveProperty('courseAccess');
    expect(res.body.courses[0].courseName).toBe('CHEM 121');
  });
});
