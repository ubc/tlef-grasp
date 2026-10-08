// Canvas quiz export import routes (#140):
//   POST /api/question-import/canvas/preview  (multipart: courseId, file)
//   POST /api/question-import/canvas/commit   (multipart: courseId, quizIdent, createQuiz, file)
// Who may import, what each upload problem answers, and what the controller
// hands the service. The co-instructor, TA and archived-course checks run for
// real on mocked course, settings and membership lookups. The import service
// is mocked for the happy paths and runs for real where the answer comes from
// reading the zip (it never reaches the database in those cases).

const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/database', () => ({
  connect: jest.fn().mockRejectedValue(new Error('route tests have no database')),
}));
jest.mock('../../src/services/canvas-quiz-import', () => {
  const actual = jest.requireActual('../../src/services/canvas-quiz-import');
  return { ...actual, previewCanvasImport: jest.fn(), commitCanvasQuiz: jest.fn() };
});
jest.mock('../../src/utils/course-access', () => ({
  TA_COURSE_ROLE: 'ta',
  hasStaffAccessInCourse: jest.fn(),
}));
jest.mock('../../src/utils/auth', () => ({
  isFaculty: jest.fn(),
  isAppAdministrator: jest.fn(),
}));
jest.mock('../../src/services/course', () => ({ getCourseById: jest.fn() }));
jest.mock('../../src/services/settings', () => ({ getSettings: jest.fn() }));
jest.mock('../../src/services/user-course', () => ({ getUserCourseMembership: jest.fn() }));

const databaseService = require('../../src/services/database');
const importService = require('../../src/services/canvas-quiz-import');
const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const { isFaculty, isAppAdministrator } = require('../../src/utils/auth');
const { getCourseById } = require('../../src/services/course');
const { getSettings } = require('../../src/services/settings');
const { getUserCourseMembership } = require('../../src/services/user-course');
const canvasQuizImportRouter = require('../../src/routes/canvas-quiz-import');
const { buildManifest, buildExportZip } = require('../fixtures/canvas-qti/zip');
const items = require('../fixtures/canvas-qti/items');

const actualService = jest.requireActual('../../src/services/canvas-quiz-import');

const COURSE_ID = '64b000000000000000000001';
const BASE = '/api/question-import/canvas';
const OWNER = { _id: 'faculty-owner', role: 'faculty' };
const CO_INSTRUCTOR = { _id: 'faculty-co', role: 'faculty' };
const TA = { _id: 'ta-1', role: 'student' };
const STAFF = { _id: 'staff-1', role: 'staff' };

const ZIP_BYTES = Buffer.from('PK\u0003\u0004 synthetic upload bytes');

const PREVIEW = {
  manifestTitle: 'QTI Quiz Export for course "Synthetic Chemistry 100"',
  totals: { quizzes: 1, items: 2, importable: 2, alreadyImported: 0, skipped: 0, remoteImages: 0, bundledImages: 0, predictedDrafts: 0 },
  quizzes: [],
};
const COMMIT = {
  quizIdent: 'gquizalpha',
  title: 'Alpha Quiz',
  created: { questions: 2, approved: 2, drafts: 0, objectives: 1 },
  alreadyImported: 0,
  skipped: [],
  drafts: [],
  failures: [],
  imageFailures: 0,
  quiz: { id: '64d000000000000000000001', name: 'Alpha Quiz', created: true },
};

function buildApp(user) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use(BASE, canvasQuizImportRouter);
  return app;
}

function post(path, user = OWNER) {
  return request(buildApp(user)).post(`${BASE}${path}`);
}

async function quizExport() {
  const ident = 'gquizalpha';
  return buildExportZip({
    entries: {
      'imsmanifest.xml': buildManifest({ quizzes: [{ ident }] }),
      [`${ident}/${ident}.xml`]: items.quizXml({ ident, title: 'Alpha Quiz', slots: [items.mcItem({ ident: 'gitema1' })] }),
      [`${ident}/assessment_meta.xml`]: items.metaXml({ ident, title: 'Alpha Quiz' }),
    },
  });
}

let consoleErrorSpy;

beforeEach(() => {
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  importService.previewCanvasImport.mockImplementation(actualService.previewCanvasImport);
  importService.commitCanvasQuiz.mockImplementation(actualService.commitCanvasQuiz);
  hasStaffAccessInCourse.mockResolvedValue(true);
  isFaculty.mockImplementation(async (user) => user.role === 'faculty');
  isAppAdministrator.mockResolvedValue(false);
  getCourseById.mockResolvedValue({ _id: COURSE_ID, owner: OWNER._id });
  getSettings.mockResolvedValue({});
  getUserCourseMembership.mockImplementation(async (userId) =>
    (userId === TA._id ? { courseRole: 'ta' } : { courseRole: 'instructor' }));
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe('upload problems', () => {
  it('asks for the export when no file is sent', async () => {
    const response = await post('/preview').field('courseId', COURSE_ID);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Upload a Canvas quiz export (.zip).' });
    expect(importService.previewCanvasImport).not.toHaveBeenCalled();
  });

  it('needs a course id', async () => {
    const response = await post('/preview').attach('file', ZIP_BYTES, 'export.zip');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Course ID is required' });
    expect(hasStaffAccessInCourse).not.toHaveBeenCalled();
  });

  it('refuses a course id sent twice instead of checking only one of them', async () => {
    const response = await post('/preview')
      .field('courseId', COURSE_ID)
      .field('courseId', '64b000000000000000000002')
      .attach('file', ZIP_BYTES, 'export.zip');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Course ID is required' });
    expect(hasStaffAccessInCourse).not.toHaveBeenCalled();
  });

  it('answers a file that is not a zip with the reader\'s message', async () => {
    const response = await post('/preview')
      .field('courseId', COURSE_ID)
      .attach('file', Buffer.from('{"questions": []}'), 'questions.zip');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "That file isn't a zip archive. Upload the .zip that Canvas gave you.",
      code: 'NOT_A_ZIP',
    });
    expect(databaseService.connect).not.toHaveBeenCalled();
  });

  it('points a full course export to the quiz export', async () => {
    const courseExport = await buildExportZip({
      entries: {
        'imsmanifest.xml': buildManifest({ quizzes: [] }),
        'course_settings/course_settings.xml': '<course/>',
      },
    });

    const response = await post('/preview').field('courseId', COURSE_ID).attach('file', courseExport, 'course.imscc.zip');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'This is a full Canvas course export. In Canvas, use Settings > Export Course Content > Quiz instead, and upload that .zip.',
      code: 'COURSE_EXPORT',
    });
  });

  it('refuses an upload over 50 MB with 413', async () => {
    const oversized = Buffer.alloc(50 * 1024 * 1024 + 1);

    const response = await post('/preview').field('courseId', COURSE_ID).attach('file', oversized, 'huge.zip');

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: 'This file is larger than 50 MB, which is too large to import.',
      code: 'TOO_LARGE',
    });
    expect(importService.previewCanvasImport).not.toHaveBeenCalled();
  });

  it('refuses a file sent under another field name', async () => {
    const response = await post('/preview').field('courseId', COURSE_ID).attach('upload', ZIP_BYTES, 'export.zip');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Upload one Canvas quiz export (.zip).' });
  });
});

describe('who may import', () => {
  it('refuses a user without staff access to the course', async () => {
    hasStaffAccessInCourse.mockResolvedValue(false);

    const response = await post('/preview', STAFF).field('courseId', COURSE_ID).attach('file', ZIP_BYTES, 'export.zip');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'User is not in course' });
    expect(hasStaffAccessInCourse).toHaveBeenCalledWith(STAFF, COURSE_ID);
    expect(importService.previewCanvasImport).not.toHaveBeenCalled();
  });

  it.each([
    ['question generation', 'questionGeneration'],
    ['the question bank', 'questionBank'],
  ])('refuses a co-instructor the owner has denied %s', async (_label, key) => {
    getSettings.mockResolvedValue({ coInstructorPermissions: { [key]: false } });

    const response = await post('/commit', CO_INSTRUCTOR)
      .field('courseId', COURSE_ID)
      .field('quizIdent', 'gquizalpha')
      .field('createQuiz', 'true')
      .attach('file', ZIP_BYTES, 'export.zip');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "You don't have permission to perform this action in this course." });
    expect(importService.commitCanvasQuiz).not.toHaveBeenCalled();
  });

  it.each([
    ['question generation', 'questionGeneration'],
    ['the question bank', 'questionBank'],
  ])('refuses a TA without access to %s', async (_label, key) => {
    getUserCourseMembership.mockResolvedValue({ courseRole: 'ta', taPermissions: { [key]: false } });

    const response = await post('/preview', TA).field('courseId', COURSE_ID).attach('file', ZIP_BYTES, 'export.zip');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      success: false,
      error: 'Your TA role does not include access to this feature in this course.',
    });
    expect(importService.previewCanvasImport).not.toHaveBeenCalled();
  });

  it('refuses everyone but the owner on an archived course', async () => {
    getCourseById.mockResolvedValue({ _id: COURSE_ID, owner: OWNER._id, archived: true });

    const response = await post('/preview', CO_INSTRUCTOR).field('courseId', COURSE_ID).attach('file', ZIP_BYTES, 'export.zip');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'course_archived', message: 'This course has been archived by its instructor.' });
    expect(hasStaffAccessInCourse).not.toHaveBeenCalled();
  });

  it('keeps an archived course read-only for its owner too', async () => {
    getCourseById.mockResolvedValue({ _id: COURSE_ID, owner: OWNER._id, archived: true });

    const response = await post('/commit', OWNER)
      .field('courseId', COURSE_ID)
      .field('quizIdent', 'gquizalpha')
      .attach('file', ZIP_BYTES, 'export.zip');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: 'course_archived',
      message: 'This course is archived and read-only. Unarchive it to make changes.',
    });
    expect(importService.commitCanvasQuiz).not.toHaveBeenCalled();
  });
});

describe('POST /preview', () => {
  it.each([
    ['the faculty owner', OWNER, {}, { canApprove: true, canCreateQuizzes: true }],
    ['a faculty co-instructor', CO_INSTRUCTOR, {}, { canApprove: true, canCreateQuizzes: true }],
    ['a faculty co-instructor without quiz creation', CO_INSTRUCTOR, { createQuiz: false }, { canApprove: true, canCreateQuizzes: false }],
    ['a TA', TA, {}, { canApprove: false, canCreateQuizzes: false }],
    ['staff', STAFF, {}, { canApprove: false, canCreateQuizzes: false }],
  ])('returns the preview with what %s may do', async (_label, user, coInstructorPermissions, permissions) => {
    getSettings.mockResolvedValue({ coInstructorPermissions });
    importService.previewCanvasImport.mockResolvedValueOnce(PREVIEW);

    const response = await post('/preview', user).field('courseId', COURSE_ID).attach('file', ZIP_BYTES, 'export.zip');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ...PREVIEW, permissions });
    expect(importService.previewCanvasImport).toHaveBeenCalledWith({ courseId: COURSE_ID, buffer: ZIP_BYTES });
  });

  it('hides an unexpected failure behind a generic message and logs no link', async () => {
    const secret = 'https://canvas.example.test/assessment_questions/7/files/11/download?verifier=secret11';
    importService.previewCanvasImport.mockRejectedValueOnce(new Error(`fetch failed for ${secret}`));

    const response = await post('/preview').field('courseId', COURSE_ID).attach('file', ZIP_BYTES, 'export.zip');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'The Canvas import failed.' });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = consoleErrorSpy.mock.calls[0].join(' ');
    expect(logged).toContain('fetch failed for [url]');
    expect(logged).not.toMatch(/canvas\.example\.test|verifier/);
  });
});

describe('POST /commit', () => {
  it('imports the chosen quiz with the importer\'s permissions', async () => {
    importService.commitCanvasQuiz.mockResolvedValueOnce(COMMIT);

    const response = await post('/commit', OWNER)
      .field('courseId', COURSE_ID)
      .field('quizIdent', 'gquizalpha')
      .field('createQuiz', 'true')
      .attach('file', ZIP_BYTES, 'export.zip');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(COMMIT);
    expect(importService.commitCanvasQuiz).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      buffer: ZIP_BYTES,
      quizIdent: 'gquizalpha',
      createQuiz: true,
      user: OWNER,
      canApprove: true,
      canCreateQuizzes: true,
    });
  });

  it.each([['false'], ['yes'], [undefined]])('does not create a GRASP quiz when createQuiz is %p', async (createQuiz) => {
    importService.commitCanvasQuiz.mockResolvedValueOnce({ ...COMMIT, quiz: null });
    const req = post('/commit', TA).field('courseId', COURSE_ID).field('quizIdent', 'gquizalpha');
    if (createQuiz !== undefined) req.field('createQuiz', createQuiz);

    const response = await req.attach('file', ZIP_BYTES, 'export.zip');

    expect(response.status).toBe(200);
    expect(importService.commitCanvasQuiz).toHaveBeenCalledWith(expect.objectContaining({
      createQuiz: false,
      canApprove: false,
      canCreateQuizzes: false,
      user: TA,
    }));
  });

  it('needs the Canvas quiz to import', async () => {
    const response = await post('/commit').field('courseId', COURSE_ID).attach('file', ZIP_BYTES, 'export.zip');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Choose a Canvas quiz to import.' });
    expect(importService.commitCanvasQuiz).not.toHaveBeenCalled();
  });

  it('refuses a quiz that is not in the uploaded export', async () => {
    const response = await post('/commit')
      .field('courseId', COURSE_ID)
      .field('quizIdent', 'gnotthere')
      .field('createQuiz', 'true')
      .attach('file', await quizExport(), 'export.zip');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "This quiz isn't in the uploaded export. Upload the export again and choose from its quizzes.",
      code: 'UNKNOWN_QUIZ',
    });
    expect(databaseService.connect).not.toHaveBeenCalled();
  });

  it('answers 409 while the same Canvas quiz is being imported', async () => {
    // Another commit holds the lock, so the lock insert hits the unique _id.
    const duplicateKey = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    const locks = {
      insertOne: jest.fn().mockRejectedValue(duplicateKey),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    };
    databaseService.connect.mockResolvedValueOnce({
      collection: (name) => {
        if (name !== 'grasp_canvas_import_lock') throw new Error(`no ${name} before the lock`);
        return locks;
      },
    });

    const response = await post('/commit')
      .field('courseId', COURSE_ID)
      .field('quizIdent', 'gquizalpha')
      .field('createQuiz', 'true')
      .attach('file', await quizExport(), 'export.zip');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'This Canvas quiz is already being imported. Try again in a minute.',
      code: 'IMPORT_IN_PROGRESS',
    });
    expect(locks.insertOne).toHaveBeenCalledTimes(2);
    expect(locks.insertOne.mock.calls[0][0]._id).toBe(`${COURSE_ID}:gquizalpha`);
  });

  it('answers an unexpected failure with 500', async () => {
    importService.commitCanvasQuiz.mockRejectedValueOnce(new Error('database went away'));

    const response = await post('/commit')
      .field('courseId', COURSE_ID)
      .field('quizIdent', 'gquizalpha')
      .attach('file', ZIP_BYTES, 'export.zip');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'The Canvas import failed.' });
  });
});
