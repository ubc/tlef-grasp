// Course-scoped staff/TA access (issue #40): promoted TAs act as staff only
// in courses where their membership carries courseRole 'ta'; genuine SAML
// staff keep course-wide staff access; faculty always pass.

jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

jest.mock('../../src/services/user-course', () => ({
  getUserCourseMembership: jest.fn(),
}));

jest.mock('../../src/services/user', () => ({
  getUserById: jest.fn(),
}));

const { getUserCourseMembership } = require('../../src/services/user-course');
const { getUserById } = require('../../src/services/user');
const {
  TA_COURSE_ROLE,
  hasStaffAccessInCourse,
  resolveCourseRole,
} = require('../../src/utils/course-access');

const COURSE_ID = 'course-1';

const faculty = { _id: 'prof-1', puid: 'prof-1', affiliation: ['faculty'] };
const samlStaff = { _id: 'staff-1', puid: 'staff-1', affiliation: ['staff'] };
const promotedTa = {
  _id: 'ta-1',
  puid: 'ta-1',
  affiliation: ['student', 'staff'],
  staffViaTaPromotion: true,
};
const student = { _id: 'stu-1', puid: 'stu-1', affiliation: ['student'] };

describe('hasStaffAccessInCourse', () => {
  afterEach(() => {
    getUserCourseMembership.mockReset();
    getUserById.mockReset();
  });

  it('always allows faculty', async () => {
    await expect(hasStaffAccessInCourse(faculty, COURSE_ID)).resolves.toBe(true);
    expect(getUserCourseMembership).not.toHaveBeenCalled();
  });

  it('denies plain students', async () => {
    await expect(hasStaffAccessInCourse(student, COURSE_ID)).resolves.toBe(false);
    expect(getUserCourseMembership).not.toHaveBeenCalled();
  });

  it('denies staff-affiliated users who are not members of the course', async () => {
    getUserCourseMembership.mockResolvedValue(null);
    await expect(hasStaffAccessInCourse(samlStaff, COURSE_ID)).resolves.toBe(false);
  });

  it('allows a promoted TA in the course they are a TA of', async () => {
    getUserCourseMembership.mockResolvedValue({ courseRole: TA_COURSE_ROLE });
    await expect(hasStaffAccessInCourse(promotedTa, COURSE_ID)).resolves.toBe(true);
    // The membership role decides; no need to look at the promotion flag.
    expect(getUserById).not.toHaveBeenCalled();
  });

  it('denies a promoted TA in another course where they are only a student', async () => {
    getUserCourseMembership.mockResolvedValue({ userId: 'ta-1', courseId: 'course-2' });
    getUserById.mockResolvedValue(promotedTa);
    await expect(hasStaffAccessInCourse(promotedTa, 'course-2')).resolves.toBe(false);
  });

  it('allows genuine SAML staff in any course they belong to', async () => {
    getUserCourseMembership.mockResolvedValue({ userId: 'staff-1', courseId: COURSE_ID });
    getUserById.mockResolvedValue(samlStaff);
    await expect(hasStaffAccessInCourse(samlStaff, COURSE_ID)).resolves.toBe(true);
  });

  it('denies when user or course is missing', async () => {
    await expect(hasStaffAccessInCourse(null, COURSE_ID)).resolves.toBe(false);
    await expect(hasStaffAccessInCourse(samlStaff, null)).resolves.toBe(false);
  });
});

describe('resolveCourseRole', () => {
  it('resolves faculty before anything else', () => {
    expect(resolveCourseRole(faculty, { courseRole: 'ta' }, true)).toBe('faculty');
  });

  it('resolves TA from the membership course role', () => {
    expect(resolveCourseRole(promotedTa, { courseRole: 'ta' }, false)).toBe('ta');
  });

  it('resolves a promoted TA without the course role here as student', () => {
    expect(resolveCourseRole(promotedTa, {}, false)).toBe('student');
  });

  it('resolves genuine SAML staff as staff', () => {
    expect(resolveCourseRole(samlStaff, {}, false)).toBe('staff');
  });

  it('resolves plain students as student', () => {
    expect(resolveCourseRole(student, {}, false)).toBe('student');
    expect(resolveCourseRole(student, null, false)).toBe('student');
  });
});
