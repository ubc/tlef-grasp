/**
 * M10, second half: the "add a user to this course" pickers.
 *
 * getStaffUsersNotInCourse and getStudentsNotInCourse split candidates by
 * global affiliation. A promoted TA keeps 'student' and gains 'staff', so they
 * fell on the staff side of that split — an instructor adding them to a second
 * course as a learner had to find them under "Staff", and the Users page then
 * labelled them accordingly. The promotion is scoped to one course, so outside
 * it they belong in the student list, which is what resolveCourseRole already
 * concludes everywhere else.
 *
 * The two lists must stay a partition: getAllUsersNotInCourseHandler
 * concatenates them, so anyone in both would render twice.
 */

jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));

const databaseService = require('../../src/services/database');
const {
  getStaffUsersNotInCourse,
  getStudentsNotInCourse,
} = require('../../src/services/user');

const COURSE_ID = '507f1f77bcf86cd799439011';

const USERS = [
  { _id: 'u-student', displayName: 'Plain Student', affiliation: ['student'] },
  { _id: 'u-affiliate', displayName: 'Affiliate', affiliation: ['affiliate'] },
  { _id: 'u-staff', displayName: 'Department Staff', affiliation: ['staff'] },
  { _id: 'u-faculty', displayName: 'Professor', affiliation: ['faculty'] },
  {
    _id: 'u-ta',
    displayName: 'Promoted TA',
    affiliation: ['student', 'staff'],
    staffViaTaPromotion: true,
  },
  // Genuine dual affiliation with no promotion behind it: still offered under
  // staff, so they remain addable. Nothing on the user document distinguishes
  // them from an instructor.
  { _id: 'u-worklearn', displayName: 'Work Learn', affiliation: ['student', 'staff'] },
];

beforeEach(() => {
  databaseService.connect.mockResolvedValue({
    collection: jest.fn((name) => {
      if (name === 'grasp_user_course') {
        return { find: () => ({ toArray: () => Promise.resolve([]) }) };
      }
      return { find: () => ({ toArray: () => Promise.resolve(USERS) }) };
    }),
  });
});

const idsOf = (rows) => rows.map((row) => row._id).sort();

describe('candidate pickers for adding users to a course', () => {
  it('offers a promoted TA as a student, not as staff', async () => {
    expect(idsOf(await getStudentsNotInCourse(COURSE_ID))).toContain('u-ta');
    expect(idsOf(await getStaffUsersNotInCourse(COURSE_ID))).not.toContain('u-ta');
  });

  it('keeps the staff list to genuine staff', async () => {
    expect(idsOf(await getStaffUsersNotInCourse(COURSE_ID))).toEqual([
      'u-staff',
      'u-worklearn',
    ]);
  });

  it('keeps the student list to course learners', async () => {
    expect(idsOf(await getStudentsNotInCourse(COURSE_ID))).toEqual([
      'u-affiliate',
      'u-student',
      'u-ta',
    ]);
  });

  it('never offers the same person in both lists', async () => {
    const staff = idsOf(await getStaffUsersNotInCourse(COURSE_ID));
    const students = idsOf(await getStudentsNotInCourse(COURSE_ID));

    expect(staff.filter((id) => students.includes(id))).toEqual([]);
  });
});
