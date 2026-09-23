// Canvas roster sync (issue #113): how one GRASP section's enrollments are
// reconciled with the students of the LMS section it is linked to.
//
// The collaborating services (user, user-course, course-section, access log)
// are mocked, so these tests pin the sync service's own decisions: who is
// added / restored / kept / dropped, when it must ask before dropping, when it
// must not drop at all, and exactly what it writes when it applies. The
// services it delegates to have their own tests (course-section-soft-drop,
// user-lms-account).
jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

jest.mock('../../src/services/user', () => ({
  createOrUpdateUser: jest.fn(),
  getUserByPuid: jest.fn(),
  upsertUserLmsAccount: jest.fn(),
}));

jest.mock('../../src/services/user-course', () => {
  const { MEMBERSHIP_SOURCES } = jest.requireActual('../../src/services/user-course');
  return {
    MEMBERSHIP_SOURCES,
    createUserCourse: jest.fn(),
    isUserInCourse: jest.fn(),
  };
});

jest.mock('../../src/services/course-section', () => {
  const { DROPPED_REASONS, SECTION_ENROLLMENT_SOURCES } =
    jest.requireActual('../../src/services/course-section');
  return {
    DROPPED_REASONS,
    SECTION_ENROLLMENT_SOURCES,
    upsertUserCourseSection: jest.fn(),
    dropUserCourseSection: jest.fn(),
    countActiveUserCourseSections: jest.fn(),
  };
});

jest.mock('../../src/services/course-access-log', () => {
  const { ACCESS_ACTIONS } = jest.requireActual('../../src/services/course-access-log');
  return {
    ACCESS_ACTIONS,
    recordCourseAccessEvent: jest.fn(),
  };
});

const { ObjectId } = require('mongodb');
const databaseService = require('../../src/services/database');
const userService = require('../../src/services/user');
const userCourseService = require('../../src/services/user-course');
const courseSectionService = require('../../src/services/course-section');
const accessLog = require('../../src/services/course-access-log');
const { LmsRosterError } = require('../../src/lms/roster-errors');
const { syncSectionRoster } = require('../../src/services/lms-roster-sync');

const oid = (n) => new ObjectId(n.toString(16).padStart(24, '0'));

const COURSE_ID = '507f1f77bcf86cd799439011';
const COURSE_OID = new ObjectId(COURSE_ID);
const ACTOR_ID = '507f191e810c19729de860ea';
const INSTANCE = 'https://canvas.example.test';
const NOW = new Date('2026-09-01T10:00:00.000Z');
const REVIEWED = new Date('2026-08-01T10:00:00.000Z');

// A GRASP user and the Canvas roster row that stands for them.
function student(n, name, extra = {}) {
  return {
    _id: oid(n),
    puid: `P${String(n).padStart(4, '0')}`,
    displayName: name,
    email: `${name.split(' ')[0].toLowerCase()}@student.ubc.ca`,
    ...extra,
  };
}

function rosterRow(user, extra = {}) {
  return {
    externalUserId: String(9000 + parseInt(String(user._id).slice(-4), 16)),
    integrationId: user.puid,
    sisUserId: `SIS-${user.puid}`,
    loginId: user.email,
    name: user.displayName,
    sortableName: `${user.displayName.split(' ')[1]}, ${user.displayName.split(' ')[0]}`,
    ...extra,
  };
}

function activeRow(user) {
  return { userId: user._id, courseId: COURSE_OID, sectionId: '101', source: 'canvas' };
}

function droppedRow(user, droppedReason) {
  return { ...activeRow(user), droppedAt: REVIEWED, droppedReason };
}

function membership(user, source, extra = {}) {
  return { _id: oid(0x9000 + parseInt(String(user._id).slice(-4), 16)), userId: user._id, courseId: COURSE_OID, source, ...extra };
}

function linkedSection(linkExtra = {}) {
  return {
    _id: oid(0xabc),
    courseId: COURSE_OID,
    sectionId: '101',
    lmsLink: {
      provider: 'canvas',
      instance: INSTANCE,
      externalCourseId: '42',
      externalSectionId: '501',
      dropsReviewedAt: REVIEWED,
      ...linkExtra,
    },
  };
}

// In-memory stand-ins for the collections the sync service reads directly.
// Each find honours the one filter shape the service sends it.
let state;
let collections;

function setupDb({ users = [], rows = [], memberships = [], owner = oid(0xfff) } = {}) {
  state = { users: [...users], rows, memberships };
  const ids = (list) => (list || []).map(String);

  collections = {
    grasp_user: {
      find: jest.fn((filter) => ({
        toArray: async () => {
          if (filter.puid) return state.users.filter((u) => filter.puid.$in.includes(u.puid));
          const wanted = ids(filter._id.$in);
          return state.users.filter((u) => wanted.includes(String(u._id)));
        },
      })),
    },
    grasp_user_course_section: {
      find: jest.fn((filter) => ({
        toArray: async () => state.rows.filter((row) =>
          String(row.courseId) === String(filter.courseId) && row.sectionId === filter.sectionId
        ),
      })),
    },
    grasp_user_course: {
      find: jest.fn((filter) => ({
        toArray: async () => {
          const wanted = ids(filter.$and[1].userId.$in);
          return state.memberships.filter((m) => wanted.includes(String(m.userId)));
        },
      })),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    },
    grasp_course: {
      findOne: jest.fn().mockResolvedValue({ _id: COURSE_OID, owner }),
    },
    grasp_course_section: {
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    },
  };
  databaseService.connect.mockResolvedValue({
    collection: jest.fn((name) => {
      if (!collections[name]) throw new Error(`unexpected collection ${name}`);
      return collections[name];
    }),
  });

  // Placeholder creation goes through the real user service in production;
  // here it adds to the same in-memory user list the batch lookup reads.
  userService.getUserByPuid.mockImplementation(async (puid) =>
    state.users.find((u) => u.puid === puid) || null
  );
  userService.createOrUpdateUser.mockImplementation(async ({ puid, displayName }) => {
    state.users.push({ _id: oid(0x5000 + state.users.length), puid, displayName });
  });
  userCourseService.isUserInCourse.mockResolvedValue(false);
  // clearMocks keeps implementations; tests that make a write fail set their own.
  userCourseService.createUserCourse.mockResolvedValue(undefined);
  userService.upsertUserLmsAccount.mockResolvedValue(undefined);
  courseSectionService.dropUserCourseSection.mockResolvedValue(true);
  courseSectionService.countActiveUserCourseSections.mockResolvedValue(0);
}

function sync(overrides = {}) {
  return syncSectionRoster({
    courseId: COURSE_ID,
    section: linkedSection(),
    provider: 'canvas',
    instance: INSTANCE,
    roster: [],
    actorUserId: ACTOR_ID,
    now: NOW,
    ...overrides,
  });
}

const eventsOf = (action) =>
  accessLog.recordCourseAccessEvent.mock.calls
    .map(([event]) => event)
    .filter((event) => event.action === action);

const linkUpdate = () => collections.grasp_course_section.updateOne.mock.calls[0];

function expectNothingApplied() {
  expect(userService.createOrUpdateUser).not.toHaveBeenCalled();
  expect(userCourseService.createUserCourse).not.toHaveBeenCalled();
  expect(courseSectionService.upsertUserCourseSection).not.toHaveBeenCalled();
  expect(courseSectionService.dropUserCourseSection).not.toHaveBeenCalled();
  expect(userService.upsertUserLmsAccount).not.toHaveBeenCalled();
  expect(accessLog.recordCourseAccessEvent).not.toHaveBeenCalled();
  expect(collections.grasp_user_course.deleteOne).not.toHaveBeenCalled();
  expect(collections.grasp_course_section.updateOne).not.toHaveBeenCalled();
}

const ALICE = student(1, 'Alice Keep');
const BOB = student(2, 'Bob Add');
const DAVE = student(4, 'Dave Restore');
const ERIN = student(5, 'Erin Removed');
const FRANK = student(6, 'Frank Dropped');
const GINA = student(7, 'Gina Manual');
const HANK = student(8, 'Hank Ta');
const IVY = student(9, 'Ivy Twosections');
const JUNO = student(10, 'Juno Invited');
const OWNER = student(11, 'Olive Owner');

describe('syncSectionRoster: adds, placeholders, restores, keeps', () => {
  it('adds a matched student who has no row: membership, canvas section row, access-log event', async () => {
    setupDb({ users: [BOB] });

    const result = await sync({ roster: [rosterRow(BOB)] });

    expect(result.status).toBe('applied');
    expect(result.summary).toEqual(expect.objectContaining({
      added: 1, restored: 0, kept: 0, dropped: 0, errors: [],
    }));
    expect(userCourseService.createUserCourse).toHaveBeenCalledWith(
      BOB._id, COURSE_OID, { source: 'roster-sync' }
    );
    expect(courseSectionService.upsertUserCourseSection).toHaveBeenCalledWith(
      BOB._id, COURSE_OID, '101', { source: 'canvas', now: NOW }
    );
    expect(eventsOf('sync-added')).toEqual([{
      courseId: COURSE_OID,
      targetUserId: BOB._id,
      actorUserId: ACTOR_ID,
      action: 'sync-added',
      role: 'student',
      details: { provider: 'canvas', sectionId: '101', restored: false, previouslyRemoved: false },
    }]);
    expect(userService.createOrUpdateUser).not.toHaveBeenCalled();
  });

  it('creates a placeholder keyed by PUID for a student who has never signed in', async () => {
    setupDb();
    const row = { externalUserId: '9100', integrationId: 'NEWPUID1', name: 'Carol Canvas' };

    const result = await sync({ roster: [row] });

    expect(userService.createOrUpdateUser).toHaveBeenCalledTimes(1);
    expect(userService.createOrUpdateUser).toHaveBeenCalledWith({
      puid: 'NEWPUID1',
      displayName: 'Carol Canvas',
      affiliation: ['student'],
    });
    const created = state.users.find((u) => u.puid === 'NEWPUID1');
    expect(userCourseService.createUserCourse).toHaveBeenCalledWith(
      created._id, COURSE_OID, { source: 'roster-sync' }
    );
    expect(courseSectionService.upsertUserCourseSection).toHaveBeenCalledWith(
      created._id, COURSE_OID, '101', { source: 'canvas', now: NOW }
    );
    expect(result.summary.added).toBe(1);
  });

  it('matches on the trimmed PUID, falling back to its upper-cased form, in one batched lookup', async () => {
    const lower = student(20, 'Lower Case', { puid: 'abc123' });
    const upper = student(21, 'Upper Case', { puid: 'XYZ789' });
    setupDb({ users: [lower, upper] });

    const result = await sync({
      roster: [
        rosterRow(lower, { integrationId: '  abc123 ' }),
        rosterRow(upper, { integrationId: 'xyz789' }),
      ],
    });

    expect(userService.createOrUpdateUser).not.toHaveBeenCalled();
    expect(result.summary.added).toBe(2);
    const puidLookups = collections.grasp_user.find.mock.calls.filter(([filter]) => filter.puid);
    expect(puidLookups).toHaveLength(1);
    expect(puidLookups[0][0].puid.$in).toEqual(expect.arrayContaining(['abc123', 'xyz789', 'XYZ789']));
    expect(userCourseService.createUserCourse.mock.calls.map(([userId]) => userId))
      .toEqual([lower._id, upper._id]);
  });

  it('never guesses a match from email, SIS id, or name when integration_id is missing', async () => {
    setupDb({ users: [ALICE, BOB] });

    const result = await sync({
      roster: [
        rosterRow(ALICE),
        // Every identifier of Bob except the one GRASP matches on.
        rosterRow(BOB, { integrationId: undefined, sisUserId: BOB.puid, loginId: BOB.email }),
      ],
    });

    expect(result.summary.unmatched).toEqual([{ name: 'Bob Add' }]);
    expect(result.summary.added).toBe(1);
    const touched = courseSectionService.upsertUserCourseSection.mock.calls.map(([userId]) => userId);
    expect(touched).toEqual([ALICE._id]);
    expect(userService.createOrUpdateUser).not.toHaveBeenCalled();
  });

  it('restores dropped rows and flags the ones an instructor had removed from the course', async () => {
    setupDb({
      users: [DAVE, ERIN],
      rows: [droppedRow(DAVE, 'lms-roster'), droppedRow(ERIN, 'removed-from-course')],
      // Dave kept his course membership; Erin's went with the removal.
      memberships: [membership(DAVE, 'roster-sync')],
    });

    const result = await sync({ roster: [rosterRow(DAVE), rosterRow(ERIN)] });

    expect(result.summary).toEqual(expect.objectContaining({
      added: 0, restored: 2, previouslyRemovedRestored: 1,
    }));
    expect(courseSectionService.upsertUserCourseSection).toHaveBeenCalledWith(
      DAVE._id, COURSE_OID, '101', { source: 'canvas', now: NOW }
    );
    expect(courseSectionService.upsertUserCourseSection).toHaveBeenCalledWith(
      ERIN._id, COURSE_OID, '101', { source: 'canvas', now: NOW }
    );
    expect(userCourseService.createUserCourse).toHaveBeenCalledTimes(1);
    expect(userCourseService.createUserCourse).toHaveBeenCalledWith(
      ERIN._id, COURSE_OID, { source: 'roster-sync' }
    );
    const details = Object.fromEntries(
      eventsOf('sync-added').map((event) => [String(event.targetUserId), event.details])
    );
    expect(details[String(DAVE._id)]).toEqual(
      { provider: 'canvas', sectionId: '101', restored: true, previouslyRemoved: false }
    );
    expect(details[String(ERIN._id)]).toEqual(
      { provider: 'canvas', sectionId: '101', restored: true, previouslyRemoved: true }
    );
  });

  it('keeps an active enrolled student without re-adding or logging them', async () => {
    setupDb({ users: [ALICE], rows: [activeRow(ALICE)], memberships: [membership(ALICE, 'roster-sync')] });

    const result = await sync({ roster: [rosterRow(ALICE)] });

    expect(result.summary).toEqual(expect.objectContaining({ added: 0, restored: 0, kept: 1, dropped: 0 }));
    expect(userCourseService.createUserCourse).not.toHaveBeenCalled();
    expect(accessLog.recordCourseAccessEvent).not.toHaveBeenCalled();
  });

  it('records the Canvas account of every matched student (added, restored, kept)', async () => {
    setupDb({
      users: [ALICE, BOB, DAVE],
      rows: [activeRow(ALICE), droppedRow(DAVE, 'lms-roster')],
      memberships: [membership(ALICE, 'roster-sync'), membership(DAVE, 'roster-sync')],
    });
    const rows = [rosterRow(ALICE), rosterRow(BOB), rosterRow(DAVE)];

    await sync({ roster: rows });

    expect(userService.upsertUserLmsAccount).toHaveBeenCalledTimes(3);
    for (const [user, row] of [[ALICE, rows[0]], [BOB, rows[1]], [DAVE, rows[2]]]) {
      expect(userService.upsertUserLmsAccount).toHaveBeenCalledWith(user._id, {
        provider: 'canvas',
        instance: INSTANCE,
        externalUserId: row.externalUserId,
        sisUserId: row.sisUserId,
        loginId: row.loginId,
        name: row.name,
        sortableName: row.sortableName,
        updatedAt: NOW,
      });
    }
  });

  it('does not record an LMS account for an unmatched roster row', async () => {
    setupDb({ users: [ALICE, BOB, DAVE, ERIN] });

    await sync({
      roster: [
        rosterRow(ALICE), rosterRow(BOB), rosterRow(DAVE), rosterRow(ERIN),
        { externalUserId: '777', name: 'Nobody Known' },
      ],
    });

    const recorded = userService.upsertUserLmsAccount.mock.calls.map(([, account]) => account.externalUserId);
    expect(recorded).not.toContain('777');
    expect(recorded).toHaveLength(4);
  });
});

describe('syncSectionRoster: drops and the course-membership rule', () => {
  it('soft-drops a student no longer on the roster on a later sync, as the syncing instructor', async () => {
    setupDb({
      users: [ALICE, BOB, DAVE, ERIN, FRANK],
      rows: [ALICE, BOB, DAVE, ERIN, FRANK].map(activeRow),
      memberships: [ALICE, BOB, DAVE, ERIN, FRANK].map((u) => membership(u, 'roster-sync')),
    });

    const result = await sync({ roster: [ALICE, BOB, DAVE, ERIN].map((u) => rosterRow(u)) });

    expect(result.status).toBe('applied');
    expect(result.summary).toEqual(expect.objectContaining({ kept: 4, dropped: 1, dropsSkipped: null }));
    expect(courseSectionService.dropUserCourseSection).toHaveBeenCalledTimes(1);
    expect(courseSectionService.dropUserCourseSection).toHaveBeenCalledWith(
      FRANK._id, COURSE_OID, '101', { reason: 'lms-roster', droppedBy: ACTOR_ID, now: NOW }
    );
    expect(eventsOf('sync-dropped')).toEqual([{
      courseId: COURSE_OID,
      targetUserId: FRANK._id,
      actorUserId: ACTOR_ID,
      action: 'sync-dropped',
      role: 'student',
      details: { provider: 'canvas', sectionId: '101', membershipRemoved: true },
    }]);
  });

  it('removes only roster-sync memberships left with no active section; manual, invite-code, TA and owner stay', async () => {
    const candidates = [FRANK, GINA, HANK, IVY, JUNO, OWNER];
    setupDb({
      users: [ALICE, ...candidates],
      rows: [ALICE, ...candidates].map(activeRow),
      memberships: [
        membership(ALICE, 'roster-sync'),
        membership(FRANK, 'roster-sync'),
        membership(GINA, 'manual'),
        membership(HANK, 'roster-sync', { courseRole: 'ta' }),
        membership(IVY, 'roster-sync'),
        membership(JUNO, 'invite-code'),
        // Even a roster-sync stamp never removes the course owner.
        membership(OWNER, 'roster-sync'),
      ],
      owner: OWNER._id,
    });
    // Ivy is still active in another section of the course.
    courseSectionService.countActiveUserCourseSections.mockImplementation(async (userId) =>
      (String(userId) === String(IVY._id) ? 1 : 0)
    );

    const result = await sync({
      roster: [rosterRow(ALICE)],
      confirmDropUserIds: candidates.map((u) => String(u._id)),
    });

    expect(result.status).toBe('applied');
    expect(result.summary.dropped).toBe(6);
    expect(courseSectionService.dropUserCourseSection).toHaveBeenCalledTimes(6);
    expect(collections.grasp_user_course.deleteOne).toHaveBeenCalledTimes(1);
    expect(collections.grasp_user_course.deleteOne).toHaveBeenCalledWith({
      _id: membership(FRANK, 'roster-sync')._id,
    });
    const removed = Object.fromEntries(
      eventsOf('sync-dropped').map((event) => [String(event.targetUserId), event.details.membershipRemoved])
    );
    expect(removed).toEqual({
      [String(FRANK._id)]: true,
      [String(GINA._id)]: false,
      [String(HANK._id)]: false,
      [String(IVY._id)]: false,
      [String(JUNO._id)]: false,
      [String(OWNER._id)]: false,
    });
  });

  it('does not count or log a drop whose row was already dropped by the time it was applied', async () => {
    setupDb({
      users: [ALICE, BOB, FRANK],
      rows: [ALICE, BOB, FRANK].map(activeRow),
      memberships: [ALICE, BOB, FRANK].map((u) => membership(u, 'roster-sync')),
    });
    courseSectionService.dropUserCourseSection.mockResolvedValue(false);

    const result = await sync({ roster: [rosterRow(ALICE), rosterRow(BOB)] });

    expect(result.summary.dropped).toBe(0);
    expect(eventsOf('sync-dropped')).toEqual([]);
    expect(collections.grasp_user_course.deleteOne).not.toHaveBeenCalled();
  });
});

describe('syncSectionRoster: integration_id coverage guard', () => {
  function rosterWithCoverage(withId, total) {
    const users = Array.from({ length: total }, (_, i) => student(100 + i, `Student N${i}`));
    const roster = users.map((u, i) => rosterRow(u, i < withId ? {} : { integrationId: undefined }));
    return { users, roster };
  }

  it('below 80% coverage: adds who it can, drops nobody, and says why', async () => {
    const { users, roster } = rosterWithCoverage(7, 10);
    setupDb({
      users: [...users, FRANK],
      rows: [activeRow(FRANK)],
      memberships: [membership(FRANK, 'roster-sync')],
    });

    const result = await sync({ roster, coverage: { total: 10, integrationId: 7 } });

    expect(result.status).toBe('applied');
    expect(result.summary).toEqual(expect.objectContaining({
      added: 7, dropped: 0, dropsSkipped: 'low-coverage', coverage: 0.7,
    }));
    expect(result.summary.unmatched).toHaveLength(3);
    expect(courseSectionService.dropUserCourseSection).not.toHaveBeenCalled();
    // Drops were not reviewed, so the next sync must still ask.
    expect(linkUpdate()[1].$set).not.toHaveProperty(['lmsLink.dropsReviewedAt']);
  });

  it('below 80% coverage on a first sync applies adds without asking for confirmation', async () => {
    const { users, roster } = rosterWithCoverage(1, 2);
    setupDb({ users: [...users, FRANK], rows: [activeRow(FRANK)] });

    const result = await sync({
      roster,
      coverage: { total: 2, integrationId: 1 },
      section: linkedSection({ dropsReviewedAt: undefined }),
    });

    expect(result.status).toBe('applied');
    expect(result.summary.dropsSkipped).toBe('low-coverage');
    expect(courseSectionService.dropUserCourseSection).not.toHaveBeenCalled();
  });

  it('at exactly 80% coverage drops normally', async () => {
    const { users, roster } = rosterWithCoverage(8, 10);
    setupDb({
      users: [...users, FRANK],
      rows: [...users.slice(0, 8), FRANK].map(activeRow),
      memberships: [...users.slice(0, 8), FRANK].map((u) => membership(u, 'roster-sync')),
    });

    const result = await sync({ roster, coverage: { total: 10, integrationId: 8 } });

    expect(result.summary.dropsSkipped).toBeNull();
    expect(result.summary.dropped).toBe(1);
  });

  it('with no integration_id at all aborts with a typed error and applies nothing', async () => {
    const { users, roster } = rosterWithCoverage(0, 3);
    setupDb({ users: [...users, FRANK], rows: [activeRow(FRANK)] });

    const error = await sync({ roster, coverage: { total: 3, integrationId: 0 } }).catch((e) => e);

    expect(error).toBeInstanceOf(LmsRosterError);
    expect(error.code).toBe('no-integration-ids');
    expectNothingApplied();
  });

  it('computes coverage from the roster when the adapter did not supply it', async () => {
    const { roster } = rosterWithCoverage(0, 2);
    setupDb();

    const error = await sync({ roster }).catch((e) => e);

    expect(error).toBeInstanceOf(LmsRosterError);
    expect(error.code).toBe('no-integration-ids');
  });
});

describe('syncSectionRoster: confirmation before dropping', () => {
  function fiveActive() {
    const users = [ALICE, BOB, DAVE, ERIN, FRANK];
    setupDb({
      users,
      rows: users.map(activeRow),
      memberships: users.map((u) => membership(u, 'roster-sync')),
    });
  }

  it('first sync after linking asks before dropping anyone, listing who and applying nothing', async () => {
    setupDb({
      users: [ALICE, BOB, FRANK, GINA, DAVE],
      rows: [activeRow(ALICE), activeRow(FRANK), activeRow(GINA), droppedRow(DAVE, 'removed-from-course')],
      memberships: [ALICE, FRANK, GINA].map((u) => membership(u, 'roster-sync')),
    });
    state.users[3] = { ...GINA, legalName: 'Georgina Legal' };

    const result = await sync({
      section: linkedSection({ dropsReviewedAt: undefined }),
      roster: [
        rosterRow(ALICE), rosterRow(BOB), rosterRow(DAVE),
        { externalUserId: '5', name: 'Unmatched Person' },
        rosterRow(student(30, 'Filler One')), rosterRow(student(31, 'Filler Two')),
        rosterRow(student(32, 'Filler Three')), rosterRow(student(33, 'Filler Four')),
      ],
    });

    expect(result.status).toBe('confirmation-required');
    expect(result.reason).toBe('first-sync');
    expect(result.plan).toEqual(expect.objectContaining({
      add: 5, // Bob + four placeholders
      restore: 1,
      previouslyRemoved: 1,
      keep: 1,
      unmatched: [{ name: 'Unmatched Person' }],
    }));
    // Instructor views prefer the legal name.
    expect(result.plan.drop).toEqual([
      { userId: String(FRANK._id), name: 'Frank Dropped' },
      { userId: String(GINA._id), name: 'Georgina Legal' },
    ]);
    expectNothingApplied();
  });

  it('first sync with nobody to drop applies and marks drops as reviewed', async () => {
    setupDb({ users: [ALICE], rows: [activeRow(ALICE)], memberships: [membership(ALICE, 'roster-sync')] });

    const result = await sync({
      section: linkedSection({ dropsReviewedAt: undefined }),
      roster: [rosterRow(ALICE)],
    });

    expect(result.status).toBe('applied');
    expect(linkUpdate()[1].$set['lmsLink.dropsReviewedAt']).toEqual(NOW);
  });

  it('a later sync that would drop more than half the section asks first', async () => {
    fiveActive();

    const result = await sync({ roster: [rosterRow(ALICE), rosterRow(BOB)] });

    expect(result.status).toBe('confirmation-required');
    expect(result.reason).toBe('large-drop');
    expect(result.plan.drop.map((d) => d.userId)).toEqual(
      [DAVE, ERIN, FRANK].map((u) => String(u._id))
    );
    expectNothingApplied();
  });

  it('a later sync that drops exactly half the section applies without asking', async () => {
    const users = [ALICE, BOB, DAVE, ERIN];
    setupDb({
      users,
      rows: users.map(activeRow),
      memberships: users.map((u) => membership(u, 'roster-sync')),
    });

    const result = await sync({ roster: [rosterRow(ALICE), rosterRow(BOB)] });

    expect(result.status).toBe('applied');
    expect(result.summary.dropped).toBe(2);
  });

  it('an empty Canvas section on a later sync is a large drop, not a silent wipe', async () => {
    fiveActive();

    const result = await sync({ roster: [], coverage: { total: 0, integrationId: 0 } });

    expect(result.status).toBe('confirmation-required');
    expect(result.reason).toBe('large-drop');
    expectNothingApplied();
  });

  it('applies confirmed drops and marks drops as reviewed', async () => {
    fiveActive();

    const result = await sync({
      roster: [rosterRow(ALICE), rosterRow(BOB)],
      confirmDropUserIds: [DAVE, ERIN, FRANK].map((u) => String(u._id)),
    });

    expect(result.status).toBe('applied');
    expect(result.summary.dropped).toBe(3);
    expect(courseSectionService.dropUserCourseSection.mock.calls.map(([userId]) => userId))
      .toEqual([DAVE._id, ERIN._id, FRANK._id]);
    expect(linkUpdate()[1].$set['lmsLink.dropsReviewedAt']).toEqual(NOW);
  });

  it('a confirmed first sync drops the confirmed students', async () => {
    setupDb({
      users: [ALICE, FRANK],
      rows: [activeRow(ALICE), activeRow(FRANK)],
      memberships: [membership(ALICE, 'roster-sync'), membership(FRANK, 'roster-sync')],
    });

    const result = await sync({
      section: linkedSection({ dropsReviewedAt: undefined }),
      roster: [rosterRow(ALICE)],
      confirmDropUserIds: [String(FRANK._id)],
    });

    expect(result.status).toBe('applied');
    expect(result.summary.dropped).toBe(1);
    expect(linkUpdate()[1].$set['lmsLink.dropsReviewedAt']).toEqual(NOW);
  });

  it('asks again, applying nothing, when the roster now drops someone the instructor did not confirm', async () => {
    fiveActive();

    const result = await sync({
      roster: [rosterRow(ALICE), rosterRow(BOB)],
      // Confirmed from a preview in which Erin was still on the roster.
      confirmDropUserIds: [DAVE, FRANK].map((u) => String(u._id)),
    });

    expect(result.status).toBe('confirmation-required');
    // Still a large drop, but the instructor must be told the list changed.
    expect(result.reason).toBe('roster-changed');
    expect(result.plan.drop.map((d) => d.userId)).toEqual(
      [DAVE, ERIN, FRANK].map((u) => String(u._id))
    );
    expectNothingApplied();
  });

  it('on a first sync, says the roster changed when the confirmed list is now incomplete', async () => {
    setupDb({
      users: [ALICE, FRANK, GINA],
      rows: [activeRow(ALICE), activeRow(FRANK), activeRow(GINA)],
      memberships: [ALICE, FRANK, GINA].map((u) => membership(u, 'roster-sync')),
    });

    const result = await sync({
      section: linkedSection({ dropsReviewedAt: undefined }),
      roster: [rosterRow(ALICE)],
      // The preview listed only Frank; Gina left the Canvas section since.
      confirmDropUserIds: [String(FRANK._id)],
    });

    expect(result.status).toBe('confirmation-required');
    expect(result.reason).toBe('roster-changed');
    expect(result.plan.drop.map((d) => d.userId)).toEqual(
      [FRANK, GINA].map((u) => String(u._id))
    );
    expectNothingApplied();
  });

  it('never drops a confirmed id that is back on the roster', async () => {
    fiveActive();

    const result = await sync({
      roster: [rosterRow(ALICE), rosterRow(BOB), rosterRow(DAVE)],
      confirmDropUserIds: [ALICE, ERIN, FRANK].map((u) => String(u._id)),
    });

    expect(result.status).toBe('applied');
    expect(courseSectionService.dropUserCourseSection.mock.calls.map(([userId]) => userId))
      .toEqual([ERIN._id, FRANK._id]);
    expect(result.summary.kept).toBe(3);
  });

  it('skipDrops applies adds and keeps, drops nobody, and leaves drops unreviewed', async () => {
    setupDb({
      users: [ALICE, BOB, FRANK],
      rows: [activeRow(ALICE), activeRow(FRANK)],
      memberships: [membership(ALICE, 'roster-sync'), membership(FRANK, 'roster-sync')],
    });

    const result = await sync({
      section: linkedSection({ dropsReviewedAt: undefined }),
      roster: [rosterRow(ALICE), rosterRow(BOB)],
      skipDrops: true,
    });

    expect(result.status).toBe('applied');
    expect(result.summary).toEqual(expect.objectContaining({
      added: 1, kept: 1, dropped: 0, dropsSkipped: 'instructor-skipped',
    }));
    expect(courseSectionService.dropUserCourseSection).not.toHaveBeenCalled();
    expect(linkUpdate()[1].$set).not.toHaveProperty(['lmsLink.dropsReviewedAt']);
  });
});

describe('syncSectionRoster: lastSync and failures', () => {
  // Per-student failures are logged loudly by design; keep the output clean.
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => console.error.mockRestore());

  it('stamps lastSync on the link it synced, by the instructor who ran it', async () => {
    const EXTRA = student(40, 'Extra Kept');
    setupDb({
      users: [ALICE, BOB, DAVE, FRANK, EXTRA],
      rows: [activeRow(ALICE), droppedRow(DAVE, 'lms-roster'), activeRow(FRANK), activeRow(EXTRA)],
      memberships: [ALICE, DAVE, FRANK, EXTRA].map((u) => membership(u, 'roster-sync')),
    });

    await sync({
      roster: [rosterRow(ALICE), rosterRow(BOB), rosterRow(DAVE), rosterRow(EXTRA),
        { externalUserId: '1', name: 'No Id' }],
      coverage: { total: 5, integrationId: 4 },
    });

    expect(collections.grasp_course_section.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = linkUpdate();
    expect(filter).toEqual({
      courseId: COURSE_OID,
      sectionId: '101',
      'lmsLink.provider': 'canvas',
      'lmsLink.externalSectionId': '501',
    });
    expect(update.$set['lmsLink.lastSync']).toEqual({
      at: NOW,
      by: new ObjectId(ACTOR_ID),
      added: 1,
      restored: 1,
      dropped: 1,
      kept: 2,
      unmatched: 1,
      dropsSkipped: null,
      coverage: 0.8,
    });
    expect(update.$set['lmsLink.dropsReviewedAt']).toEqual(NOW);
    // The link already carries its instance.
    expect(update.$set).not.toHaveProperty(['lmsLink.instance']);
  });

  it('backfills the instance on a legacy link that has none', async () => {
    setupDb({ users: [ALICE] });

    await sync({ section: linkedSection({ instance: undefined }), roster: [rosterRow(ALICE)] });

    expect(linkUpdate()[1].$set['lmsLink.instance']).toBe(INSTANCE);
  });

  it('reports a student whose add failed instead of counting them as added', async () => {
    setupDb({ users: [ALICE, BOB] });
    userCourseService.createUserCourse.mockImplementation(async (userId) => {
      if (String(userId) === String(BOB._id)) throw new Error('write failed');
    });

    const result = await sync({ roster: [rosterRow(ALICE), rosterRow(BOB)] });

    expect(result.status).toBe('applied');
    expect(result.summary.added).toBe(1);
    expect(result.summary.errors).toEqual([{ name: 'Bob Add', action: 'add' }]);
    expect(eventsOf('sync-added').map((e) => e.targetUserId)).toEqual([ALICE._id]);
    expect(linkUpdate()[1].$set['lmsLink.lastSync'].added).toBe(1);
  });

  it('still counts and logs an add when only the LMS-account write fails afterwards', async () => {
    setupDb({ users: [ALICE, BOB] });
    userService.upsertUserLmsAccount.mockImplementation(async (userId) => {
      if (String(userId) === String(BOB._id)) throw new Error('primary stepped down');
    });

    const result = await sync({ roster: [rosterRow(ALICE), rosterRow(BOB)] });

    // Bob's membership and section row were written, so Bob is enrolled.
    expect(courseSectionService.upsertUserCourseSection).toHaveBeenCalledWith(
      BOB._id, COURSE_OID, '101', { source: 'canvas', now: NOW }
    );
    expect(result.summary.added).toBe(2);
    expect(result.summary.errors).toEqual([]);
    expect(eventsOf('sync-added').map((e) => e.targetUserId)).toEqual([ALICE._id, BOB._id]);
    expect(linkUpdate()[1].$set['lmsLink.lastSync'].added).toBe(2);
  });

  it('still counts a kept student when only the LMS-account write fails', async () => {
    setupDb({ users: [ALICE], rows: [activeRow(ALICE)], memberships: [membership(ALICE, 'roster-sync')] });
    userService.upsertUserLmsAccount.mockRejectedValue(new Error('write failed'));

    const result = await sync({ roster: [rosterRow(ALICE)] });

    expect(result.summary).toEqual(expect.objectContaining({ kept: 1, errors: [] }));
    expect(linkUpdate()[1].$set['lmsLink.lastSync'].kept).toBe(1);
  });

  it('reports a failed drop instead of counting it as dropped', async () => {
    const users = [ALICE, BOB, DAVE, FRANK];
    setupDb({ users, rows: users.map(activeRow), memberships: users.map((u) => membership(u, 'roster-sync')) });
    courseSectionService.dropUserCourseSection.mockRejectedValue(new Error('write failed'));

    const result = await sync({ roster: [rosterRow(ALICE), rosterRow(BOB), rosterRow(DAVE)] });

    expect(result.summary.dropped).toBe(0);
    expect(result.summary.errors).toEqual([{ name: 'Frank Dropped', action: 'drop' }]);
    expect(eventsOf('sync-dropped')).toEqual([]);
  });

  it('logs a drop whose membership step failed, reports it, and leaves drops unreviewed', async () => {
    const users = [ALICE, BOB, DAVE, FRANK];
    setupDb({ users, rows: users.map(activeRow), memberships: users.map((u) => membership(u, 'roster-sync')) });
    courseSectionService.countActiveUserCourseSections.mockRejectedValue(new Error('db blip'));

    const result = await sync({ roster: [rosterRow(ALICE), rosterRow(BOB), rosterRow(DAVE)] });

    expect(courseSectionService.dropUserCourseSection).toHaveBeenCalledTimes(1);
    expect(result.summary.dropped).toBe(0);
    expect(result.summary.errors).toEqual([{ name: 'Frank Dropped', action: 'drop' }]);
    // The row is dropped, so the audit entry exists; the membership is not gone yet.
    expect(eventsOf('sync-dropped')).toEqual([expect.objectContaining({
      targetUserId: FRANK._id,
      details: { provider: 'canvas', sectionId: '101', membershipRemoved: false },
    })]);
    expect(collections.grasp_user_course.deleteOne).not.toHaveBeenCalled();
    expect(linkUpdate()[1].$set['lmsLink.lastSync'].dropped).toBe(0);
    expect(linkUpdate()[1].$set).not.toHaveProperty(['lmsLink.dropsReviewedAt']);
  });

  it('does not swallow a failure of the sync as a whole', async () => {
    setupDb({ users: [ALICE] });
    collections.grasp_user_course_section.find.mockImplementation(() => ({
      toArray: async () => { throw new Error('db down'); },
    }));

    await expect(sync({ roster: [rosterRow(ALICE)] })).rejects.toThrow('db down');
    expect(collections.grasp_course_section.updateOne).not.toHaveBeenCalled();
  });
});

describe('syncSectionRoster: cleanup of memberships left behind by an earlier drop', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => console.error.mockRestore());

  // Frank was dropped by an earlier Canvas sync whose membership step failed:
  // his row is dropped, but his roster-sync membership is still there.
  function orphanedFrank({ frankMembership = membership(FRANK, 'roster-sync'), owner } = {}) {
    setupDb({
      users: [ALICE, FRANK],
      rows: [activeRow(ALICE), droppedRow(FRANK, 'lms-roster')],
      memberships: [membership(ALICE, 'roster-sync'), ...(frankMembership ? [frankMembership] : [])],
      ...(owner ? { owner } : {}),
    });
  }

  it('removes the membership on the next sync, logs the drop, and marks drops as reviewed', async () => {
    orphanedFrank();

    const result = await sync({ roster: [rosterRow(ALICE)] });

    expect(result.status).toBe('applied');
    expect(courseSectionService.dropUserCourseSection).not.toHaveBeenCalled();
    expect(courseSectionService.countActiveUserCourseSections).toHaveBeenCalledWith(FRANK._id, COURSE_OID);
    expect(collections.grasp_user_course.deleteOne).toHaveBeenCalledWith({
      _id: membership(FRANK, 'roster-sync')._id,
    });
    expect(eventsOf('sync-dropped')).toEqual([{
      courseId: COURSE_OID,
      targetUserId: FRANK._id,
      actorUserId: ACTOR_ID,
      action: 'sync-dropped',
      role: 'student',
      details: { provider: 'canvas', sectionId: '101', membershipRemoved: true },
    }]);
    // The row was dropped by the earlier sync; this one only finishes it.
    expect(result.summary).toEqual(expect.objectContaining({ dropped: 0, errors: [] }));
    expect(linkUpdate()[1].$set['lmsLink.dropsReviewedAt']).toEqual(NOW);
  });

  it('keeps the membership of a student still active in another section', async () => {
    orphanedFrank();
    courseSectionService.countActiveUserCourseSections.mockResolvedValue(1);

    await sync({ roster: [rosterRow(ALICE)] });

    expect(collections.grasp_user_course.deleteOne).not.toHaveBeenCalled();
    expect(eventsOf('sync-dropped')).toEqual([]);
  });

  it.each([
    ['manual', { frankMembership: membership(FRANK, 'manual') }],
    ['invite-code', { frankMembership: membership(FRANK, 'invite-code') }],
    ['TA', { frankMembership: membership(FRANK, 'roster-sync', { courseRole: 'ta' }) }],
    ['course owner', { owner: FRANK._id }],
  ])('leaves a %s membership alone', async (_label, options) => {
    orphanedFrank(options);

    await sync({ roster: [rosterRow(ALICE)] });

    expect(collections.grasp_user_course.deleteOne).not.toHaveBeenCalled();
    expect(eventsOf('sync-dropped')).toEqual([]);
  });

  it('skips students whose membership is already gone without querying their sections', async () => {
    orphanedFrank({ frankMembership: null });

    const result = await sync({ roster: [rosterRow(ALICE)] });

    expect(courseSectionService.countActiveUserCourseSections).not.toHaveBeenCalled();
    expect(collections.grasp_user_course.deleteOne).not.toHaveBeenCalled();
    expect(result.summary.errors).toEqual([]);
  });

  it('does not touch a previously dropped student who is back on the roster (restored instead)', async () => {
    orphanedFrank();

    const result = await sync({ roster: [rosterRow(ALICE), rosterRow(FRANK)] });

    expect(result.summary.restored).toBe(1);
    expect(collections.grasp_user_course.deleteOne).not.toHaveBeenCalled();
  });

  it('does not run when drops are skipped for low coverage', async () => {
    orphanedFrank();

    await sync({ roster: [rosterRow(ALICE)], coverage: { total: 10, integrationId: 7 } });

    expect(courseSectionService.countActiveUserCourseSections).not.toHaveBeenCalled();
    expect(collections.grasp_user_course.deleteOne).not.toHaveBeenCalled();
  });

  it('does not run when the instructor skips drops', async () => {
    orphanedFrank();

    await sync({ roster: [rosterRow(ALICE)], skipDrops: true });

    expect(courseSectionService.countActiveUserCourseSections).not.toHaveBeenCalled();
    expect(collections.grasp_user_course.deleteOne).not.toHaveBeenCalled();
  });

  it('reports a failed cleanup and leaves drops unreviewed so the next sync tries again', async () => {
    orphanedFrank();
    collections.grasp_user_course.deleteOne.mockRejectedValue(new Error('write failed'));

    const result = await sync({ roster: [rosterRow(ALICE)] });

    expect(result.summary.errors).toEqual([{ name: 'Frank Dropped', action: 'drop' }]);
    expect(eventsOf('sync-dropped')).toEqual([]);
    expect(linkUpdate()[1].$set).not.toHaveProperty(['lmsLink.dropsReviewedAt']);
  });
});
