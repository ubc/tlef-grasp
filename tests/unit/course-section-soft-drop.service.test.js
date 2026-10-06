// Soft-dropped section enrollments (issue #113). A dropped row
// (`droppedAt` set) keeps its history and lets a later sync restore it, but
// grants nothing: every reader that decides access or visibility must skip it.
//
// The course-section service runs against a small in-memory stand-in for the
// collections it touches, so these tests check which rows each call really
// reads, writes, and deletes rather than the shape of its queries.
jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

jest.mock('../../src/services/quiz-schedule', () => ({
  removeSchedulesForSection: jest.fn(),
}));

jest.mock('../../src/services/quiz-lms-assignment', () => ({
  removeForSection: jest.fn(),
}));

const { ObjectId } = require('mongodb');
const databaseService = require('../../src/services/database');
const {
  getCourseSections,
  upsertUserCourseSection,
  dropUserCourseSection,
  dropUserCourseSections,
  countActiveUserCourseSections,
  getUserCourseSections,
  getSectionStudents,
  recycleSection,
} = require('../../src/services/course-section');
const { getCourseUsers } = require('../../src/services/user-course');

const oid = (n) => new ObjectId(n.toString(16).padStart(24, '0'));

const COURSE = oid(0xc1);
const OTHER_COURSE = oid(0xc2);
const OWNER = oid(0x0e);
const ACTOR = oid(0xac);
const NOW = new Date('2026-09-01T10:00:00.000Z');
const EARLIER = new Date('2026-08-01T10:00:00.000Z');

const isId = (value) => value && typeof value.toHexString === 'function';
const same = (a, b) => (isId(a) || isId(b) ? String(a) === String(b) : a === b);

// Equality plus Mongo's `field: null` (matches a missing field too) — the
// only operators these service calls send.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (value === null) return doc[key] === undefined || doc[key] === null;
    return same(doc[key], value);
  });
}

function fakeCollection(docs) {
  const apply = (doc, update) => {
    Object.assign(doc, update.$set || {});
    for (const key of Object.keys(update.$unset || {})) delete doc[key];
  };
  return {
    docs,
    find: jest.fn((filter) => ({ toArray: async () => docs.filter((d) => matches(d, filter)) })),
    findOne: jest.fn(async (filter) => docs.find((d) => matches(d, filter)) || null),
    countDocuments: jest.fn(async (filter) => docs.filter((d) => matches(d, filter)).length),
    aggregate: jest.fn((pipeline) => ({
      toArray: async () => docs.filter((d) => matches(d, pipeline[0].$match || {})),
    })),
    updateOne: jest.fn(async (filter, update, options = {}) => {
      const doc = docs.find((d) => matches(d, filter));
      if (doc) {
        apply(doc, update);
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (!options.upsert) return { matchedCount: 0, modifiedCount: 0 };
      const created = { ...(update.$setOnInsert || {}) };
      apply(created, update);
      docs.push(created);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }),
    updateMany: jest.fn(async (filter, update) => {
      const hit = docs.filter((d) => matches(d, filter));
      hit.forEach((doc) => apply(doc, update));
      return { matchedCount: hit.length, modifiedCount: hit.length };
    }),
    deleteMany: jest.fn(async (filter) => {
      const before = docs.length;
      for (let i = docs.length - 1; i >= 0; i -= 1) if (matches(docs[i], filter)) docs.splice(i, 1);
      return { deletedCount: before - docs.length };
    }),
    deleteOne: jest.fn(async (filter) => {
      const index = docs.findIndex((d) => matches(d, filter));
      if (index >= 0) docs.splice(index, 1);
      return { deletedCount: index >= 0 ? 1 : 0 };
    }),
  };
}

let db;
function setupDb({ rows = [], memberships = [], sections = [] } = {}) {
  db = {
    grasp_user_course_section: fakeCollection(rows),
    grasp_user_course: fakeCollection(memberships),
    grasp_course: fakeCollection([{ _id: COURSE, owner: OWNER }]),
    grasp_course_section: fakeCollection(sections),
  };
  databaseService.connect.mockResolvedValue({ collection: (name) => db[name] });
}

const row = (userId, sectionId, extra = {}) => ({ userId, courseId: COURSE, sectionId, ...extra });
const dropped = (userId, sectionId, extra = {}) =>
  row(userId, sectionId, { droppedAt: EARLIER, droppedReason: 'lms-roster', ...extra });
const rowsOf = (userId) =>
  db.grasp_user_course_section.docs.filter((d) => same(d.userId, userId));

const STUDENT = oid(1);

describe('readers ignore soft-dropped rows', () => {
  it('getUserCourseSections returns only the active sections (quiz access, my-sections)', async () => {
    setupDb({
      rows: [
        row(STUDENT, '101'),
        dropped(STUDENT, '102'),
        row(STUDENT, '103', { droppedAt: null }),
        dropped(STUDENT, '104', { droppedReason: 'removed-from-course' }),
        { ...row(STUDENT, '105'), courseId: OTHER_COURSE },
      ],
    });

    const sections = await getUserCourseSections(String(STUDENT), String(COURSE));

    expect(sections.map((s) => s.sectionId).sort()).toEqual(['101', '103']);
  });

  it('getSectionStudents lists only the active students of the section', async () => {
    setupDb({
      rows: [row(oid(1), '101'), dropped(oid(2), '101'), row(oid(3), '102')],
    });

    const students = await getSectionStudents(String(COURSE), '101');

    expect(students.map((s) => String(s.userId))).toEqual([String(oid(1))]);
  });

  it('countActiveUserCourseSections counts active rows only', async () => {
    setupDb({ rows: [row(STUDENT, '101'), dropped(STUDENT, '102'), dropped(STUDENT, '103')] });

    await expect(countActiveUserCourseSections(STUDENT, COURSE)).resolves.toBe(1);
  });

  it('the Users page / Quiz Scores section lookup skips dropped rows', async () => {
    setupDb();
    db.grasp_user_course.aggregate = jest.fn(() => ({ toArray: async () => [] }));

    await getCourseUsers(String(COURSE));

    const pipeline = db.grasp_user_course.aggregate.mock.calls[0][0];
    const sectionLookup = pipeline.find((stage) => stage.$lookup?.from === 'grasp_user_course_section');
    const [{ $match }] = sectionLookup.$lookup.pipeline;
    expect($match.droppedAt).toBeNull();
  });
});

describe('upsertUserCourseSection (Academic API writer)', () => {
  it('restores a dropped row and stamps it as confirmed by the Academic API', async () => {
    setupDb({
      rows: [dropped(STUDENT, '101', { droppedBy: ACTOR, createdAt: EARLIER })],
    });

    await upsertUserCourseSection(String(STUDENT), String(COURSE), '101', { now: NOW });

    expect(rowsOf(STUDENT)).toEqual([{
      userId: STUDENT,
      courseId: COURSE,
      sectionId: '101',
      createdAt: EARLIER,
      source: 'academic-api',
      syncedAt: NOW,
    }]);
    await expect(getUserCourseSections(STUDENT, COURSE)).resolves.toHaveLength(1);
  });

  it('inserts a new row with its creation time, keeping the legacy three-argument call working', async () => {
    setupDb();

    await upsertUserCourseSection(String(STUDENT), String(COURSE), '101');

    const [created] = rowsOf(STUDENT);
    expect(created).toEqual(expect.objectContaining({
      userId: STUDENT, courseId: COURSE, sectionId: '101', source: 'academic-api',
    }));
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.syncedAt).toEqual(created.createdAt);
    expect(created).not.toHaveProperty('droppedAt');
  });

  it('records the Canvas source when a Canvas sync confirms the row', async () => {
    setupDb({ rows: [row(STUDENT, '101', { source: 'academic-api' })] });

    await upsertUserCourseSection(STUDENT, COURSE, '101', { source: 'canvas', now: NOW });

    expect(rowsOf(STUDENT)).toHaveLength(1);
    expect(rowsOf(STUDENT)[0]).toEqual(expect.objectContaining({ source: 'canvas', syncedAt: NOW }));
  });
});

describe('dropping section rows', () => {
  it('dropUserCourseSection soft-drops one active row, recording why and by whom', async () => {
    setupDb({ rows: [row(STUDENT, '101'), row(STUDENT, '102')] });

    const result = await dropUserCourseSection(String(STUDENT), String(COURSE), '101', {
      reason: 'lms-roster', droppedBy: String(ACTOR), now: NOW,
    });

    expect(result).toBe(true);
    expect(rowsOf(STUDENT).find((d) => d.sectionId === '101')).toEqual(expect.objectContaining({
      droppedAt: NOW, droppedReason: 'lms-roster', droppedBy: ACTOR,
    }));
    expect(rowsOf(STUDENT).find((d) => d.sectionId === '102')).not.toHaveProperty('droppedAt');
  });

  it('dropUserCourseSection reports false and keeps the original drop for a row already dropped', async () => {
    setupDb({ rows: [dropped(STUDENT, '101', { droppedReason: 'removed-from-course' })] });

    const result = await dropUserCourseSection(STUDENT, COURSE, '101', { reason: 'lms-roster', now: NOW });

    expect(result).toBe(false);
    expect(rowsOf(STUDENT)[0]).toEqual(expect.objectContaining({
      droppedAt: EARLIER, droppedReason: 'removed-from-course',
    }));
  });

  it('dropUserCourseSections drops every active row of that user in that course only', async () => {
    const OTHER = oid(2);
    setupDb({
      rows: [
        row(STUDENT, '101'),
        row(STUDENT, '102'),
        dropped(STUDENT, '103'),
        { ...row(STUDENT, '201'), courseId: OTHER_COURSE },
        row(OTHER, '101'),
      ],
    });

    const count = await dropUserCourseSections(String(STUDENT), String(COURSE), {
      reason: 'removed-from-course', droppedBy: String(ACTOR), now: NOW,
    });

    expect(count).toBe(2);
    await expect(getUserCourseSections(STUDENT, COURSE)).resolves.toEqual([]);
    const bySection = Object.fromEntries(rowsOf(STUDENT).map((d) => [d.sectionId, d]));
    expect(bySection['101']).toEqual(expect.objectContaining({
      droppedAt: NOW, droppedReason: 'removed-from-course', droppedBy: ACTOR,
    }));
    // An earlier drop keeps its own reason.
    expect(bySection['103'].droppedReason).toBe('lms-roster');
    expect(bySection['201']).not.toHaveProperty('droppedAt');
    await expect(getUserCourseSections(OTHER, COURSE)).resolves.toHaveLength(1);
  });
});

describe('recycleSection with soft-dropped rows', () => {
  const ONLY_HERE = oid(1);
  const DROPPED_ELSEWHERE = oid(2);
  const ACTIVE_ELSEWHERE = oid(3);
  const ALREADY_DROPPED_HERE = oid(4);
  const membershipOf = (userId, source = 'roster-sync') => ({ _id: oid(0x100 + parseInt(String(userId).slice(-2), 16)), userId, courseId: COURSE, source });

  beforeEach(() => {
    setupDb({
      rows: [
        row(ONLY_HERE, '101'),
        row(DROPPED_ELSEWHERE, '101'),
        dropped(DROPPED_ELSEWHERE, '102'),
        row(ACTIVE_ELSEWHERE, '101'),
        row(ACTIVE_ELSEWHERE, '102'),
        dropped(ALREADY_DROPPED_HERE, '101'),
        row(OWNER, '101'),
      ],
      memberships: [
        membershipOf(ONLY_HERE),
        membershipOf(DROPPED_ELSEWHERE),
        membershipOf(ACTIVE_ELSEWHERE),
        membershipOf(ALREADY_DROPPED_HERE, 'manual'),
        membershipOf(OWNER, 'owner'),
      ],
      sections: [{ _id: oid(0x5ec), courseId: COURSE, sectionId: '101' }],
    });
  });

  it('deletes every row of the recycled section, dropped ones included', async () => {
    await recycleSection(String(COURSE), '101');

    expect(db.grasp_user_course_section.docs.filter((d) => d.sectionId === '101')).toEqual([]);
    expect(db.grasp_user_course_section.docs.map((d) => d.sectionId).sort()).toEqual(['102', '102']);
  });

  it('removes the membership of a student left with no ACTIVE section, and only theirs', async () => {
    await recycleSection(String(COURSE), '101');

    const remaining = db.grasp_user_course.docs.map((m) => String(m.userId)).sort();
    expect(remaining).toEqual([
      // A dropped row elsewhere is not a remaining section: DROPPED_ELSEWHERE is gone.
      String(ACTIVE_ELSEWHERE),
      // Only a dropped row here: the recycle changes nothing about their access.
      String(ALREADY_DROPPED_HERE),
      String(OWNER),
    ].sort());
    expect(remaining).not.toContain(String(ONLY_HERE));
  });
});

describe('getCourseSections', () => {
  it('never sends who linked the section or who last synced it to the browser', async () => {
    const project = jest.fn(() => ({ toArray: async () => [] }));
    databaseService.connect.mockResolvedValue({
      collection: () => ({ find: jest.fn(() => ({ project })) }),
    });

    await getCourseSections(String(COURSE));

    expect(project).toHaveBeenCalledWith(expect.objectContaining({
      'lmsLink.linkedBy': 0,
      'lmsLink.lastSync.by': 0,
    }));
  });
});
