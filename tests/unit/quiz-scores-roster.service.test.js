/**
 * M10: who appears on the instructor's Quiz Scores table.
 *
 * getQuizScores used to build the roster from global SAML affiliation with the
 * test `student && !staff && !faculty`. Anyone carrying both 'student' and
 * 'staff' was dropped — every promoted TA taking another course as a learner,
 * and work-learn students whose institutional affiliation is dual. Their
 * attempt was still recorded; the row simply never rendered, and nothing
 * anywhere told the instructor a submission existed.
 *
 * The roster now comes from the role the user holds *in this course*
 * (resolveCourseRole — the same call the Users page makes), plus a safety net:
 * anyone with a recorded score is listed regardless of how their role reads,
 * because a submitted attempt must never be silently absent.
 */

jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/services/user-course', () => ({
  getCourseUsers: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const { getCourseUsers } = require('../../src/services/user-course');
const quizService = require('../../src/services/quiz');

const QUIZ_ID = '507f1f77bcf86cd799439011';

// grasp_user_course rows as getCourseUsers returns them: user fields projected
// to the top level, the full user document kept under `user`.
const member = (id, { affiliation, courseRole, staffViaTaPromotion, name }) => ({
  userId: id,
  courseRole,
  affiliation,
  legalName: name,
  email: `${id}@ubc.ca`,
  sections: ['S1'],
  user: { _id: id, puid: `PUID-${id}`, affiliation, staffViaTaPromotion, legalName: name },
});

let quizCollection;
let scoreCollection;
let attemptCollection;
let scoreRows;

beforeEach(() => {
  scoreRows = [];
  quizCollection = {
    findOne: jest.fn().mockResolvedValue({ _id: QUIZ_ID, courseId: 'course-1' }),
  };
  scoreCollection = {
    find: jest.fn(() => ({ toArray: () => Promise.resolve(scoreRows) })),
  };
  attemptCollection = {
    aggregate: jest.fn(() => ({ toArray: () => Promise.resolve([]) })),
  };
  databaseService.connect.mockResolvedValue({
    collection: jest.fn((name) => {
      if (name === 'grasp_quiz_score') return scoreCollection;
      if (name === 'grasp_student_attempt') return attemptCollection;
      return quizCollection;
    }),
  });
});

const namesOn = async () =>
  (await quizService.getQuizScores(QUIZ_ID)).map((row) => row.studentName);

describe('getQuizScores roster', () => {
  it('lists a promoted TA who is taking this course as a student', async () => {
    // The promotion happened in some other course, so this membership has no
    // courseRole — but the staff affiliation it granted is global, which is
    // exactly what the old affiliation filter tripped over.
    getCourseUsers.mockResolvedValue([
      member('u-ta', {
        affiliation: ['student', 'staff'],
        staffViaTaPromotion: true,
        name: 'Grad Student',
      }),
    ]);

    expect(await namesOn()).toEqual(['Grad Student']);
  });

  it('still excludes this course\'s TA, faculty and genuine staff', async () => {
    getCourseUsers.mockResolvedValue([
      member('u-ta-here', {
        affiliation: ['student', 'staff'],
        staffViaTaPromotion: true,
        courseRole: 'ta',
        name: 'Course TA',
      }),
      member('u-faculty', { affiliation: ['faculty'], name: 'Professor' }),
      member('u-staff', { affiliation: ['staff'], name: 'Department Staff' }),
      member('u-student', { affiliation: ['student'], name: 'Plain Student' }),
    ]);

    expect(await namesOn()).toEqual(['Plain Student']);
  });

  it('lists anyone with a recorded score even when their role reads as staff', async () => {
    // A work-learn student: genuine SAML ['student','staff'], no promotion
    // flag, so role resolution cannot tell them apart from an instructor. They
    // took the quiz, so the row has to appear.
    getCourseUsers.mockResolvedValue([
      member('u-worklearn', { affiliation: ['student', 'staff'], name: 'Work Learn' }),
    ]);
    scoreRows = [
      { _id: 's1', userId: 'u-worklearn', score: 80, correctAnswers: 4, totalQuestions: 5 },
    ];

    const rows = await quizService.getQuizScores(QUIZ_ID);
    expect(rows.map((r) => r.studentName)).toEqual(['Work Learn']);
    expect(rows[0].score).toBe(80);
  });

  it('does not list the same person twice when they are both rostered and scored', async () => {
    getCourseUsers.mockResolvedValue([
      member('u-student', { affiliation: ['student'], name: 'Plain Student' }),
    ]);
    scoreRows = [{ _id: 's1', userId: 'u-student', score: 100, correctAnswers: 5, totalQuestions: 5 }];

    expect(await namesOn()).toEqual(['Plain Student']);
  });

  it('skips a membership whose user document is missing', async () => {
    // The $lookup preserves orphaned memberships, so `user` can be absent.
    getCourseUsers.mockResolvedValue([
      { userId: 'u-orphan', sections: [] },
      member('u-student', { affiliation: ['student'], name: 'Plain Student' }),
    ]);

    expect(await namesOn()).toEqual(['Plain Student']);
  });
});
