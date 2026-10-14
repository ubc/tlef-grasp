// Which quizzes and students go into a section's grade CSV (issue #126).
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/services/quiz-schedule', () => ({ getSchedulesForSection: jest.fn() }));

const { ObjectId } = require('mongodb');
const databaseService = require('../../src/services/database');
const quizScheduleService = require('../../src/services/quiz-schedule');
const {
  buildSectionGradeCsv,
  getSectionGradeOverview,
  getSectionQuizzes,
  getSectionStudents,
  quizStatus,
} = require('../../src/services/grade-export');

const COURSE_ID = '507f1f77bcf86cd799439011';
const NOW = new Date('2026-10-14T12:00:00Z');
const id = () => new ObjectId();

const QUIZ_CLOSED = id();
const QUIZ_OPEN = id();
const QUIZ_UPCOMING = id();
const STUDENT = id();
const TA_WITH_SCORE = id();
const TA = id();

const SECTION = {
  _id: id(),
  sectionId: 'SEC-101',
  sectionNumber: '101',
  lmsLink: { provider: 'canvas', instance: 'https://canvas.ubc.test' },
};

// A tiny in-memory stand-in for the collections the service reads. Each
// collection returns its fixed rows and records the query it was given.
function fakeDb(rowsByCollection) {
  const queries = {};
  const cursor = (rows) => ({
    project: () => cursor(rows),
    toArray: async () => rows,
  });
  return {
    queries,
    collection: (name) => ({
      find: (query) => {
        queries[name] = query;
        return cursor(rowsByCollection[name] || []);
      },
      aggregate: (pipeline) => {
        queries[name] = pipeline;
        return cursor(rowsByCollection[`${name}:aggregate`] || []);
      },
    }),
  };
}

function seed(overrides = {}) {
  quizScheduleService.getSchedulesForSection.mockResolvedValue([
    { quizId: QUIZ_UPCOMING.toString(), releaseDate: new Date('2026-10-20'), expireDate: new Date('2026-10-27') },
    { quizId: QUIZ_CLOSED.toString(), releaseDate: new Date('2026-10-01'), expireDate: new Date('2026-10-08') },
    { quizId: QUIZ_OPEN.toString(), releaseDate: new Date('2026-10-10'), expireDate: new Date('2026-10-17') },
  ]);
  const db = fakeDb({
    // The query asks for published quizzes only; an unpublished one would
    // simply not come back.
    grasp_quiz: [
      { _id: QUIZ_UPCOMING, name: 'Quiz 3' },
      { _id: QUIZ_CLOSED, name: 'Quiz 1' },
      { _id: QUIZ_OPEN, name: 'Quiz 2' },
    ],
    grasp_user_course_section: [{ userId: STUDENT }, { userId: TA_WITH_SCORE }, { userId: TA }],
    grasp_user: [
      {
        _id: STUDENT,
        puid: 'PUID0001',
        legalName: 'Zoe Student',
        affiliation: ['student'],
        lmsAccounts: [
          { provider: 'canvas', instance: 'https://other.test', externalUserId: '9', loginId: 'WRONG' },
          { provider: 'canvas', instance: 'https://canvas.ubc.test', externalUserId: '77', loginId: 'PUID0001' },
        ],
      },
      { _id: TA_WITH_SCORE, puid: 'PUID0002', legalName: 'Amy Worklearn', affiliation: ['student', 'staff'], staffViaTaPromotion: true },
      { _id: TA, puid: 'PUID0003', legalName: 'Tim TA', affiliation: ['student', 'staff'], staffViaTaPromotion: true },
    ],
    grasp_user_course: [
      { userId: STUDENT },
      { userId: TA_WITH_SCORE, courseRole: 'ta' },
      { userId: TA, courseRole: 'ta' },
    ],
    grasp_quiz_score: [
      { userId: STUDENT, quizId: QUIZ_OPEN, score: 90, correctAnswers: 9, totalQuestions: 10 },
      { userId: TA_WITH_SCORE, quizId: QUIZ_CLOSED, score: 60, correctAnswers: 3, totalQuestions: 5 },
    ],
    'grasp_student_attempt:aggregate': [{ _id: QUIZ_CLOSED, count: 2 }],
    ...overrides,
  });
  databaseService.connect.mockResolvedValue(db);
  return db;
}

afterEach(() => jest.clearAllMocks());

describe('quizStatus', () => {
  const window = { releaseDate: '2026-10-10T00:00:00Z', expireDate: '2026-10-17T00:00:00Z' };
  it('is upcoming before release, open inside the window, closed after it', () => {
    expect(quizStatus(window, new Date('2026-10-09T00:00:00Z'))).toBe('upcoming');
    expect(quizStatus(window, new Date('2026-10-17T00:00:00Z'))).toBe('open');
    expect(quizStatus(window, new Date('2026-10-17T00:00:01Z'))).toBe('closed');
  });
});

describe('getSectionQuizzes', () => {
  it('lists the published quizzes scheduled on the section, in release order', async () => {
    const db = seed();
    const quizzes = await getSectionQuizzes(COURSE_ID, SECTION, NOW);

    expect(quizzes.map((q) => [q.name, q.status])).toEqual([
      ['Quiz 1', 'closed'],
      ['Quiz 2', 'open'],
      ['Quiz 3', 'upcoming'],
    ]);
    expect(quizScheduleService.getSchedulesForSection).toHaveBeenCalledWith(SECTION._id);
    expect(db.queries.grasp_quiz).toEqual(
      expect.objectContaining({ published: true, courseId: new ObjectId(COURSE_ID) })
    );
  });

  it('is empty without touching quizzes when nothing is scheduled', async () => {
    const db = seed();
    quizScheduleService.getSchedulesForSection.mockResolvedValue([]);
    expect(await getSectionQuizzes(COURSE_ID, SECTION, NOW)).toEqual([]);
    expect(db.queries.grasp_quiz).toBeUndefined();
  });
});

describe('getSectionStudents', () => {
  it('reads only active enrollments of the section', async () => {
    const db = seed();
    await getSectionStudents(COURSE_ID, SECTION, [QUIZ_CLOSED.toString()]);
    expect(db.queries.grasp_user_course_section).toEqual({
      courseId: new ObjectId(COURSE_ID),
      sectionId: 'SEC-101',
      droppedAt: null,
    });
  });

  it("keeps students, drops TAs, but never drops someone who has a score", async () => {
    seed();
    const students = await getSectionStudents(COURSE_ID, SECTION, [QUIZ_CLOSED.toString(), QUIZ_OPEN.toString()]);
    expect(students.map((s) => s.name)).toEqual(['Amy Worklearn', 'Zoe Student']);
  });

  it("takes the Canvas ids from the account on the section's linked Canvas", async () => {
    seed();
    const [, zoe] = await getSectionStudents(COURSE_ID, SECTION, [QUIZ_CLOSED.toString()]);
    expect(zoe).toEqual(expect.objectContaining({ puid: 'PUID0001', canvasUserId: '77', loginId: 'PUID0001' }));
  });
});

describe('getSectionGradeOverview', () => {
  it('reports the student count and disputed AI grades per quiz', async () => {
    seed();
    const overview = await getSectionGradeOverview(COURSE_ID, SECTION, NOW);
    expect(overview.studentCount).toBe(2);
    expect(overview.quizzes.map((q) => q.gradesAwaitingReview)).toEqual([2, 0, 0]);
  });
});

describe('buildSectionGradeCsv', () => {
  it('writes only the chosen quizzes that are on the section', async () => {
    seed();
    const { csv, quizCount, studentCount } = await buildSectionGradeCsv(
      COURSE_ID,
      SECTION,
      [QUIZ_OPEN.toString(), QUIZ_CLOSED.toString(), id().toString()],
      { now: NOW }
    );
    expect(quizCount).toBe(2);
    expect(studentCount).toBe(2);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe(
      'Student,ID,SIS User ID,SIS Login ID,Integration ID,Section,GRASP: Quiz 1,GRASP: Quiz 2,GRASP: Average'
    );
    expect(lines.slice(2)).toEqual([
      'Amy Worklearn,,,PUID0002,PUID0002,101,60,,60',
      'Zoe Student,77,,PUID0001,PUID0001,101,0,90,45',
    ]);
  });

  it('adds questions correct from the recorded score when asked', async () => {
    seed();
    const { csv } = await buildSectionGradeCsv(
      COURSE_ID,
      SECTION,
      [QUIZ_CLOSED.toString(), QUIZ_OPEN.toString()],
      { now: NOW, includeQuestionsCorrect: true }
    );
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines.slice(2)).toEqual([
      'Amy Worklearn,,,PUID0002,PUID0002,101,60,3 of 5,,,60',
      'Zoe Student,77,,PUID0001,PUID0001,101,0,,90,9 of 10,45',
    ]);
  });
});
