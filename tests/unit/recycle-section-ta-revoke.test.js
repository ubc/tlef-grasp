// Recycling a section deletes the course membership of anyone left with no
// active section there, and that includes a TA's. Every other path that takes
// a TA role away (demotion, removal) reconsiders the staff affiliation the
// promotion granted; recycling did not, so a promoted TA kept staff — and the
// global staff-tier routes — with no TA course left.
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/services/quiz-schedule', () => ({ removeSchedulesForSection: jest.fn() }));
jest.mock('../../src/services/quiz-lms-assignment', () => ({ removeForSection: jest.fn() }));
jest.mock('../../src/services/user-course', () => ({
  ...jest.requireActual('../../src/services/user-course'),
  revokePromotedStaffIfNoTaCourses: jest.fn(),
}));

const { ObjectId } = require('mongodb');
const databaseService = require('../../src/services/database');
const { revokePromotedStaffIfNoTaCourses } = require('../../src/services/user-course');
const { recycleSection } = require('../../src/services/course-section');

const oid = (n) => new ObjectId(n.toString(16).padStart(24, '0'));
const COURSE = oid(0xc1);
const OWNER = oid(0x0e);
const TA = oid(1);
const STUDENT = oid(2);
const TA_ELSEWHERE = oid(3);

const same = (a, b) => String(a) === String(b);
const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => {
  if (value === null) return doc[key] == null;
  return same(doc[key], value);
});

function fakeCollection(docs) {
  return {
    docs,
    find: jest.fn((filter) => ({ toArray: async () => docs.filter((d) => matches(d, filter)) })),
    findOne: jest.fn(async (filter) => docs.find((d) => matches(d, filter)) || null),
    countDocuments: jest.fn(async (filter) => docs.filter((d) => matches(d, filter)).length),
    deleteOne: jest.fn(async () => ({ deletedCount: 1 })),
    deleteMany: jest.fn(async (filter) => {
      const kept = docs.filter((d) => !matches(d, filter));
      const deletedCount = docs.length - kept.length;
      docs.splice(0, docs.length, ...kept);
      return { deletedCount };
    }),
  };
}

let db;
const row = (userId, sectionId) => ({ userId, courseId: COURSE, sectionId, droppedAt: null });

beforeEach(() => {
  jest.clearAllMocks();
  db = {
    grasp_user_course_section: fakeCollection([
      row(TA, '101'),
      row(STUDENT, '101'),
      row(TA_ELSEWHERE, '101'),
      row(TA_ELSEWHERE, '102'),
      row(OWNER, '101'),
    ]),
    grasp_user_course: fakeCollection([
      { userId: TA, courseId: COURSE, courseRole: 'ta' },
      { userId: STUDENT, courseId: COURSE },
      { userId: TA_ELSEWHERE, courseId: COURSE, courseRole: 'ta' },
      { userId: OWNER, courseId: COURSE, source: 'owner' },
    ]),
    grasp_course: fakeCollection([{ _id: COURSE, owner: OWNER }]),
    grasp_course_section: fakeCollection([]),
  };
  databaseService.connect.mockResolvedValue({ collection: (name) => db[name] });
});

it('reconsiders the promoted staff of a TA whose membership it deletes', async () => {
  await recycleSection(String(COURSE), '101');

  expect(db.grasp_user_course.docs.some((m) => same(m.userId, TA))).toBe(false);
  expect(revokePromotedStaffIfNoTaCourses).toHaveBeenCalledTimes(1);
  expect(String(revokePromotedStaffIfNoTaCourses.mock.calls[0][0])).toBe(String(TA));
});

it('leaves non-TAs and members who keep another section alone', async () => {
  await recycleSection(String(COURSE), '101');

  // STUDENT's membership goes, but there is no TA role to reconsider.
  expect(db.grasp_user_course.docs.some((m) => same(m.userId, STUDENT))).toBe(false);
  // TA_ELSEWHERE still has section 102, so keeps the membership and the role.
  expect(db.grasp_user_course.docs.some((m) => same(m.userId, TA_ELSEWHERE) && m.courseRole === 'ta')).toBe(true);
  const revoked = revokePromotedStaffIfNoTaCourses.mock.calls.map(([id]) => String(id));
  expect(revoked).not.toContain(String(STUDENT));
  expect(revoked).not.toContain(String(TA_ELSEWHERE));
});
