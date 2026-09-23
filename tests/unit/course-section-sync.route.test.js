// Per-section Academic API student sync and the add-sections sync (issue #113).
//
// POST /api/courses/:courseId/sections/:sectionId/sync-students replaced the
// My Sections row button's call to the add-sections endpoint, which re-stamps
// the section's owner (a takeover). It must be owner-guarded, must never touch
// the section document, and must leave Canvas-linked sections to Canvas when
// Canvas is configured. The real courses router and syncStudentsToCourse run;
// services and the UBC Academic API are mocked.
const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));

jest.mock('../../src/services/course', () => ({
  getCourseById: jest.fn(),
}));

jest.mock('../../src/services/course-section', () => ({
  upsertCourseSection: jest.fn(),
  getCourseSections: jest.fn(),
  upsertUserCourseSection: jest.fn(),
  getUserCourseSections: jest.fn(),
  getSectionStudents: jest.fn(),
  getSectionsByOwner: jest.fn(),
  getSectionsForViewer: jest.fn(),
  getSectionsOwnedByUser: jest.fn(),
}));

jest.mock('../../src/services/user-course', () => {
  const { MEMBERSHIP_SOURCES } = jest.requireActual('../../src/services/user-course');
  return {
    MEMBERSHIP_SOURCES,
    createUserCourse: jest.fn(),
    isUserInCourse: jest.fn(),
    getUserCourses: jest.fn(),
    setUserCourseOrder: jest.fn(),
    getCourseUsers: jest.fn(),
  };
});

jest.mock('../../src/services/user', () => ({
  createOrUpdateUser: jest.fn(),
  getUserByPuid: jest.fn(),
  updateUserLegalName: jest.fn(),
}));

jest.mock('../../src/services/ubcApiService', () => ({
  getStudentsWithSectionsByIds: jest.fn(),
  getCourseSectionsByIds: jest.fn(),
}));

jest.mock('../../src/utils/course-access', () => ({
  ...jest.requireActual('../../src/utils/course-access'),
  hasStaffAccessInCourse: jest.fn(),
}));

jest.mock('../../src/utils/auth', () => ({
  ...jest.requireActual('../../src/utils/auth'),
  isFaculty: jest.fn(),
  isStaff: jest.fn(),
  isAppAdministrator: jest.fn(),
}));

const { getCourseById } = require('../../src/services/course');
const courseSectionService = require('../../src/services/course-section');
const userCourseService = require('../../src/services/user-course');
const userService = require('../../src/services/user');
const ubcApiService = require('../../src/services/ubcApiService');
const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const { isFaculty, isAppAdministrator } = require('../../src/utils/auth');
const { buildCourseCode } = require('../../src/utils/slug');
const coursesRouter = require('../../src/routes/courses');

const OWNER_ID = 'owner-1';
const CANVAS_ENV = {
  CANVAS_DOMAIN: 'https://canvas.example.test',
  CANVAS_CLIENT_ID: 'client-id',
  CANVAS_CLIENT_SECRET: 'client-secret',
  CANVAS_REDIRECT_URI: 'https://grasp.example.test/api/lms/canvas/auth/callback',
};
const SYNC_URL = '/api/courses/course-1/sections/101/sync-students';

const originalEnv = Object.fromEntries(Object.keys(CANVAS_ENV).map((k) => [k, process.env[k]]));

function setCanvasConfigured(configured) {
  for (const [key, value] of Object.entries(CANVAS_ENV)) {
    if (configured) process.env[key] = value;
    else delete process.env[key];
  }
}

function buildApp(user = { _id: OWNER_ID }) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/courses', coursesRouter);
  return app;
}

const UNLINKED = { sectionId: '101', academicPeriod: 'W2026', owner: OWNER_ID };
const CANVAS_LINKED = {
  ...UNLINKED,
  lmsLink: { provider: 'canvas', externalCourseId: '42', externalSectionId: '501' },
};
const MOODLE_LINKED = {
  ...UNLINKED,
  lmsLink: { provider: 'moodle', externalCourseId: '84', externalSectionId: '901' },
};

const STUDENT = { _id: 'student-1', puid: 'PUID1', legalName: 'Ann Student' };

afterAll(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  setCanvasConfigured(true);
  getCourseById.mockResolvedValue({
    _id: 'course-1',
    owner: OWNER_ID,
    courseCode: buildCourseCode('Cell Biology', undefined),
  });
  hasStaffAccessInCourse.mockResolvedValue(true);
  isFaculty.mockResolvedValue(true);
  isAppAdministrator.mockResolvedValue(false);
  userCourseService.isUserInCourse.mockImplementation(async (userId) => userId === OWNER_ID);
  userService.getUserByPuid.mockResolvedValue(STUDENT);
  ubcApiService.getStudentsWithSectionsByIds.mockResolvedValue([
    { puid: 'PUID1', legalName: 'Ann Student', sectionIds: ['101'] },
  ]);
});

describe('POST /api/courses/:courseId/sections/:sectionId/sync-students', () => {
  it('syncs an unlinked section from the Academic API without touching the section or its owner', async () => {
    courseSectionService.getSectionsOwnedByUser.mockResolvedValue([UNLINKED]);

    const response = await request(buildApp()).post(SYNC_URL).send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, syncResult: { added: 1 } });
    expect(ubcApiService.getStudentsWithSectionsByIds).toHaveBeenCalledWith(['101'], 'W2026');
    expect(userCourseService.createUserCourse).toHaveBeenCalledWith(
      'student-1', 'course-1', { source: 'roster-sync' }
    );
    expect(courseSectionService.upsertUserCourseSection).toHaveBeenCalledWith('student-1', 'course-1', '101');
    expect(courseSectionService.upsertCourseSection).not.toHaveBeenCalled();
  });

  it('403s an instructor who does not own the section, syncing nothing', async () => {
    courseSectionService.getSectionsOwnedByUser.mockResolvedValue([]);

    const response = await request(buildApp({ _id: 'co-instructor' })).post(SYNC_URL).send({});

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: false, error: 'You can only manage sections that you own' });
    expect(ubcApiService.getStudentsWithSectionsByIds).not.toHaveBeenCalled();
    expect(courseSectionService.upsertCourseSection).not.toHaveBeenCalled();
  });

  it('403s a user without staff access in the course', async () => {
    hasStaffAccessInCourse.mockResolvedValue(false);

    const response = await request(buildApp({ _id: 'student-9' })).post(SYNC_URL).send({});

    expect(response.status).toBe(403);
    expect(ubcApiService.getStudentsWithSectionsByIds).not.toHaveBeenCalled();
  });

  it('409s a Canvas-linked section while Canvas is configured', async () => {
    courseSectionService.getSectionsOwnedByUser.mockResolvedValue([CANVAS_LINKED]);

    const response = await request(buildApp()).post(SYNC_URL).send({});

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ success: false, error: 'This section syncs students from Canvas.' });
    expect(ubcApiService.getStudentsWithSectionsByIds).not.toHaveBeenCalled();
  });

  it('falls back to the Academic API for a Canvas-linked section when Canvas is not configured', async () => {
    setCanvasConfigured(false);
    courseSectionService.getSectionsOwnedByUser.mockResolvedValue([CANVAS_LINKED]);

    const response = await request(buildApp()).post(SYNC_URL).send({});

    expect(response.status).toBe(200);
    expect(ubcApiService.getStudentsWithSectionsByIds).toHaveBeenCalledWith(['101'], 'W2026');
  });

  it('syncs a Moodle-linked section from the Academic API', async () => {
    courseSectionService.getSectionsOwnedByUser.mockResolvedValue([MOODLE_LINKED]);

    const response = await request(buildApp()).post(SYNC_URL).send({});

    expect(response.status).toBe(200);
    expect(ubcApiService.getStudentsWithSectionsByIds).toHaveBeenCalledWith(['101'], 'W2026');
  });

  it('502s with a clear message when the Academic API fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    courseSectionService.getSectionsOwnedByUser.mockResolvedValue([UNLINKED]);
    ubcApiService.getStudentsWithSectionsByIds.mockRejectedValue(new Error('upstream 503'));

    const response = await request(buildApp()).post(SYNC_URL).send({});
    console.error.mockRestore();

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      success: false,
      error: 'The UBC Academic API could not return the students for this section. Please try again.',
    });
  });

  it('refuses to sync a section of an archived course', async () => {
    courseSectionService.getSectionsOwnedByUser.mockResolvedValue([UNLINKED]);
    getCourseById.mockResolvedValue({ _id: 'course-1', owner: OWNER_ID, archived: true });

    const response = await request(buildApp()).post(SYNC_URL).send({});

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('course_archived');
    expect(ubcApiService.getStudentsWithSectionsByIds).not.toHaveBeenCalled();
  });

  it('lets an app administrator sync a section they do not own, still without re-stamping its owner', async () => {
    courseSectionService.getSectionsOwnedByUser.mockResolvedValue([]);
    courseSectionService.getCourseSections.mockResolvedValue([UNLINKED]);
    isAppAdministrator.mockResolvedValue(true);

    const response = await request(buildApp({ _id: 'admin-1' })).post(SYNC_URL).send({});

    expect(response.status).toBe(200);
    expect(courseSectionService.upsertCourseSection).not.toHaveBeenCalled();
  });
});

describe('POST /api/courses/:courseId/sections with syncStudents', () => {
  function ubcSection(id) {
    return {
      courseSectionId: id,
      sectionNumber: id,
      course: { title: 'Cell Biology', courseSubject: { code: 'BIOL' }, courseNumber: '200' },
    };
  }

  function addSections(sectionIds) {
    ubcApiService.getCourseSectionsByIds.mockResolvedValue(sectionIds.map(ubcSection));
    return request(buildApp())
      .post('/api/courses/course-1/sections')
      .send({ sectionIds, academicPeriod: 'W2026', academicPeriodName: '2026W', syncStudents: true });
  }

  it('does not Academic-API-sync a section that is linked to Canvas', async () => {
    courseSectionService.getCourseSections.mockResolvedValue([
      { sectionId: '101', lmsLink: { provider: 'canvas' } },
      { sectionId: '102' },
    ]);

    const response = await addSections(['101', '102']);

    expect(response.status).toBe(200);
    expect(ubcApiService.getStudentsWithSectionsByIds).toHaveBeenCalledTimes(1);
    expect(ubcApiService.getStudentsWithSectionsByIds).toHaveBeenCalledWith(['102'], 'W2026');
  });

  it('skips the Academic API entirely when every section is Canvas-linked', async () => {
    courseSectionService.getCourseSections.mockResolvedValue([
      { sectionId: '101', lmsLink: { provider: 'canvas' } },
    ]);

    const response = await addSections(['101']);

    expect(response.status).toBe(200);
    expect(response.body.syncResult).toEqual({ added: 0 });
    expect(ubcApiService.getStudentsWithSectionsByIds).not.toHaveBeenCalled();
  });

  it('still syncs Moodle-linked sections, and Canvas-linked ones when Canvas is not configured', async () => {
    courseSectionService.getCourseSections.mockResolvedValue([
      { sectionId: '101', lmsLink: { provider: 'canvas' } },
      { sectionId: '102', lmsLink: { provider: 'moodle' } },
    ]);

    await addSections(['101', '102']);
    expect(ubcApiService.getStudentsWithSectionsByIds).toHaveBeenLastCalledWith(['102'], 'W2026');

    setCanvasConfigured(false);
    await addSections(['101', '102']);
    expect(ubcApiService.getStudentsWithSectionsByIds).toHaveBeenLastCalledWith(['101', '102'], 'W2026');
  });
});
