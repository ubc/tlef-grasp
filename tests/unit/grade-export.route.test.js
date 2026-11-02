// Who may download a section's grade CSV (issue #126): instructors and app
// administrators, only for sections they may see; never TAs or students. The
// real role check (middleware/auth + utils/auth) runs; services are mocked.
const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/answer-grading', () => ({}));
jest.mock('../../src/services/question', () => ({}));
jest.mock('../../src/services/quiz-question-flag', () => ({}));
jest.mock('../../src/services/quiz-session', () => ({}));
jest.mock('../../src/services/course', () => ({ getCourseById: jest.fn() }));
jest.mock('../../src/services/course-section', () => ({ getSectionsForViewer: jest.fn() }));
jest.mock('../../src/services/grade-export', () => ({
  getSectionGradeOverview: jest.fn(),
  buildSectionGradeCsv: jest.fn(),
}));

const { getCourseById } = require('../../src/services/course');
const { getSectionsForViewer } = require('../../src/services/course-section');
const gradeExportService = require('../../src/services/grade-export');
const quizRouter = require('../../src/routes/quiz');

const COURSE_ID = '507f1f77bcf86cd799439011';
const BASE = `/api/quiz/course/${COURSE_ID}/grade-export`;
const SECTION = { _id: 'sec-oid', sectionId: 'SEC-101', sectionNumber: '101' };

const FACULTY = { _id: '507f191e810c19729de860ea', puid: 'FAC00001', affiliation: ['faculty'] };
const TA = { _id: '507f191e810c19729de860eb', puid: 'TA000001', affiliation: ['student', 'staff'] };
const STUDENT = { _id: '507f191e810c19729de860ec', puid: 'STU00001', affiliation: ['student'] };
const ADMIN = { _id: '507f191e810c19729de860ed', puid: 'ADM00001', affiliation: ['staff'] };

function buildApp(user) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    req.isAuthenticated = () => !!user;
    next();
  });
  app.use('/api/quiz', quizRouter);
  return app;
}

let savedAdmins;
beforeAll(() => {
  savedAdmins = process.env.APP_ADMINISTRATOR;
  process.env.APP_ADMINISTRATOR = ADMIN.puid;
});
afterAll(() => {
  if (savedAdmins === undefined) delete process.env.APP_ADMINISTRATOR;
  else process.env.APP_ADMINISTRATOR = savedAdmins;
});

beforeEach(() => {
  jest.clearAllMocks();
  getCourseById.mockResolvedValue({ _id: COURSE_ID, courseCode: 'CHEM 123' });
  getSectionsForViewer.mockResolvedValue({ seeAll: false, sections: [SECTION] });
  gradeExportService.getSectionGradeOverview.mockResolvedValue({ studentCount: 3, quizzes: [] });
  gradeExportService.buildSectionGradeCsv.mockResolvedValue({
    csv: '﻿Student,ID\r\n',
    quizCount: 1,
    studentCount: 3,
  });
});

describe('who may export', () => {
  it.each([
    ['a TA', TA],
    ['a student', STUDENT],
  ])('refuses %s on both endpoints', async (_label, user) => {
    const app = buildApp(user);
    await request(app).get(`${BASE}?sectionId=SEC-101`).expect(403);
    await request(app).get(`${BASE}/csv?sectionId=SEC-101&quizIds=q1`).expect(403);
    expect(gradeExportService.getSectionGradeOverview).not.toHaveBeenCalled();
    expect(gradeExportService.buildSectionGradeCsv).not.toHaveBeenCalled();
  });

  it('refuses a signed-out request', async () => {
    await request(buildApp(null)).get(`${BASE}/csv?sectionId=SEC-101&quizIds=q1`).expect(401);
  });

  it("refuses an instructor a section they can't see", async () => {
    getSectionsForViewer.mockResolvedValue({ seeAll: false, sections: [] });
    const res = await request(buildApp(FACULTY))
      .get(`${BASE}/csv?sectionId=SEC-101&quizIds=q1`)
      .expect(403);
    expect(res.body.error).toMatch(/sections you own/);
    expect(gradeExportService.buildSectionGradeCsv).not.toHaveBeenCalled();
  });

  it('lets an app administrator export', async () => {
    await request(buildApp(ADMIN)).get(`${BASE}/csv?sectionId=SEC-101&quizIds=q1`).expect(200);
  });
});

describe('GET grade-export (dialog)', () => {
  it("returns the section's quizzes", async () => {
    const res = await request(buildApp(FACULTY)).get(`${BASE}?sectionId=SEC-101`).expect(200);
    expect(res.body).toEqual({ success: true, studentCount: 3, quizzes: [] });
    expect(gradeExportService.getSectionGradeOverview).toHaveBeenCalledWith(COURSE_ID, SECTION);
  });

  it('needs a section', async () => {
    await request(buildApp(FACULTY)).get(BASE).expect(400);
  });
});

describe('GET grade-export/csv', () => {
  it('sends the file as a named, uncached CSV attachment', async () => {
    const res = await request(buildApp(FACULTY))
      .get(`${BASE}/csv?sectionId=SEC-101&quizIds=q1,q2`)
      .expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="grasp-grades-CHEM-123-101-\d{4}-\d{2}-\d{2}\.csv"$/
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toBe('﻿Student,ID\r\n');
    expect(gradeExportService.buildSectionGradeCsv).toHaveBeenCalledWith(COURSE_ID, SECTION, ['q1', 'q2'], {
      includeQuestionsCorrect: false,
    });
  });

  it('adds the questions-correct columns only when asked', async () => {
    await request(buildApp(FACULTY))
      .get(`${BASE}/csv?sectionId=SEC-101&quizIds=q1&questionsCorrect=1`)
      .expect(200);
    expect(gradeExportService.buildSectionGradeCsv).toHaveBeenCalledWith(COURSE_ID, SECTION, ['q1'], {
      includeQuestionsCorrect: true,
    });
  });

  it('needs at least one quiz', async () => {
    await request(buildApp(FACULTY)).get(`${BASE}/csv?sectionId=SEC-101&quizIds=`).expect(400);
  });

  it('refuses when none of the quizzes are on the section', async () => {
    gradeExportService.buildSectionGradeCsv.mockResolvedValue({ csv: '', quizCount: 0, studentCount: 0 });
    const res = await request(buildApp(FACULTY))
      .get(`${BASE}/csv?sectionId=SEC-101&quizIds=q9`)
      .expect(400);
    expect(res.body.error).toMatch(/scheduled for this section/);
  });
});
