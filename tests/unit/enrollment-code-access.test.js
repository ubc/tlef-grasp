// Browsing courses and joining one with an invite code are for instructors and
// staff. A promoted TA carries a staff affiliation too, but only so the
// staff-tier routes admit them in their TA course; everywhere else they are a
// student. The check used to be "faculty or staff", which let every promoted
// TA list all of GRASP's courses and join any course whose code they had.
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/services/course', () => ({
  getCourseById: jest.fn(),
  getCourseByEnrollmentCode: jest.fn(),
  listCoursesForEnrollment: jest.fn(),
}));
jest.mock('../../src/services/user-course', () => ({
  ...jest.requireActual('../../src/services/user-course'),
  isUserInCourse: jest.fn(),
  createUserCourse: jest.fn(),
}));

const courseService = require('../../src/services/course');
const userCourseService = require('../../src/services/user-course');
const { canUseEnrollmentCode } = require('../../src/utils/auth');
const {
  listEnrollmentCourses,
  joinCourseWithCode,
  joinCourseByEnrollmentCode,
} = require('../../src/controllers/courses');

const COURSE_ID = '64b7f0c2a1b2c3d4e5f60718';
const CODE = 'JOIN-ME';

// Every user carries a puid, so no database lookup is needed to rule out
// app-administrator status.
const faculty = { _id: 'prof-1', puid: 'prof-1', affiliation: ['faculty'] };
const samlStaff = { _id: 'staff-1', puid: 'staff-1', affiliation: ['staff'] };
const promotedTa = {
  _id: 'ta-1',
  puid: 'ta-1',
  affiliation: ['student', 'staff'],
  staffViaTaPromotion: true,
};
const student = { _id: 'stu-1', puid: 'stu-1', affiliation: ['student'] };

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  courseService.getCourseById.mockResolvedValue({ _id: COURSE_ID, courseName: 'CHEM 121', courseCode: 'CHEM121', courseAccess: CODE });
  courseService.getCourseByEnrollmentCode.mockResolvedValue({ _id: COURSE_ID, courseName: 'CHEM 121', courseCode: 'CHEM121', courseAccess: CODE });
  courseService.listCoursesForEnrollment.mockResolvedValue([{ _id: COURSE_ID, courseName: 'CHEM 121', courseCode: 'CHEM121' }]);
  userCourseService.isUserInCourse.mockResolvedValue(false);
  userCourseService.createUserCourse.mockResolvedValue({});
});

afterEach(() => console.error.mockRestore());

describe('canUseEnrollmentCode', () => {
  it.each([
    ['faculty', faculty, true],
    ['SAML staff', samlStaff, true],
    ['a promoted TA', promotedTa, false],
    ['a student', student, false],
    ['nobody', null, false],
  ])('%s → %s', async (_label, user, expected) => {
    await expect(canUseEnrollmentCode(user)).resolves.toBe(expected);
  });

  it('lets an app administrator through whatever their affiliation', async () => {
    const previous = process.env.APP_ADMINISTRATOR;
    process.env.APP_ADMINISTRATOR = 'admin-1';
    try {
      await expect(canUseEnrollmentCode({ _id: 'admin-1', puid: 'admin-1', affiliation: [] })).resolves.toBe(true);
    } finally {
      if (previous === undefined) delete process.env.APP_ADMINISTRATOR;
      else process.env.APP_ADMINISTRATOR = previous;
    }
  });
});

describe('enrollment-code routes refuse a promoted TA', () => {
  it('GET /api/courses/enrollment-list', async () => {
    const res = makeRes();
    await listEnrollmentCourses({ user: promotedTa, query: {} }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(courseService.listCoursesForEnrollment).not.toHaveBeenCalled();
  });

  it('POST /api/courses/join-by-code', async () => {
    const res = makeRes();
    await joinCourseByEnrollmentCode({ user: promotedTa, body: { enrollmentCode: CODE } }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(userCourseService.createUserCourse).not.toHaveBeenCalled();
  });

  it('POST /api/courses/:courseId/join', async () => {
    const res = makeRes();
    await joinCourseWithCode({ user: promotedTa, params: { courseId: COURSE_ID }, body: { enrollmentCode: CODE } }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(userCourseService.createUserCourse).not.toHaveBeenCalled();
  });
});

describe('enrollment-code routes still serve staff from SAML', () => {
  it('lists courses to join', async () => {
    const res = makeRes();
    await listEnrollmentCourses({ user: samlStaff, query: {} }, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('joins a course with its invite code', async () => {
    const res = makeRes();
    await joinCourseByEnrollmentCode({ user: samlStaff, body: { enrollmentCode: CODE } }, res);

    expect(userCourseService.createUserCourse).toHaveBeenCalledWith('staff-1', COURSE_ID, expect.any(Object));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
