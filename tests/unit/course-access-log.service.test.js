// Append-only audit of manual course access (issue #115): every grant, role
// change, and revocation is written with who did it, to whom, and when — and
// survives the membership being deleted, which is the whole point.

jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const { ObjectId } = require('mongodb');
const databaseService = require('../../src/services/database');
const {
  ACCESS_ACTIONS,
  COURSE_ACCESS_LOG_COLLECTION,
  recordCourseAccessEvent,
  getCourseAccessLog,
} = require('../../src/services/course-access-log');

const COURSE_ID = '507f1f77bcf86cd799439011';
const TARGET_ID = '507f1f77bcf86cd799439012';
const ACTOR_ID = '507f1f77bcf86cd799439013';

let collection;

beforeEach(() => {
  jest.clearAllMocks();
  collection = {
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'event-1' }),
    aggregate: jest.fn(() => ({ toArray: () => Promise.resolve([{ _id: 'event-1' }]) })),
  };
  databaseService.connect.mockResolvedValue({
    collection: jest.fn((name) => {
      expect(name).toBe(COURSE_ACCESS_LOG_COLLECTION);
      return collection;
    }),
  });
});

describe('recordCourseAccessEvent', () => {
  it('stores the event with ObjectId references, the role, and a timestamp', async () => {
    const before = Date.now();
    const stored = await recordCourseAccessEvent({
      courseId: COURSE_ID,
      targetUserId: TARGET_ID,
      actorUserId: new ObjectId(ACTOR_ID),
      action: ACCESS_ACTIONS.ADDED,
      role: 'ta',
    });

    expect(collection.insertOne).toHaveBeenCalledTimes(1);
    const [doc] = collection.insertOne.mock.calls[0];
    expect(doc.courseId).toBeInstanceOf(ObjectId);
    expect(String(doc.courseId)).toBe(COURSE_ID);
    expect(doc.targetUserId).toBeInstanceOf(ObjectId);
    expect(String(doc.actorUserId)).toBe(ACTOR_ID);
    expect(doc.action).toBe('added');
    expect(doc.role).toBe('ta');
    expect(doc.createdAt).toBeInstanceOf(Date);
    expect(doc.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(doc).not.toHaveProperty('details');
    expect(stored._id).toBe('event-1');
  });

  it('keeps non-ObjectId ids as given, defaults the role to null, and stores object details', async () => {
    await recordCourseAccessEvent({
      courseId: 'course-1',
      targetUserId: 'stu-1',
      actorUserId: 'prof-1',
      action: ACCESS_ACTIONS.PERMISSIONS_UPDATED,
      details: { permissions: { quizzes: false } },
    });

    const [doc] = collection.insertOne.mock.calls[0];
    expect(doc).toEqual(
      expect.objectContaining({
        courseId: 'course-1',
        targetUserId: 'stu-1',
        actorUserId: 'prof-1',
        action: 'permissions-updated',
        role: null,
        details: { permissions: { quizzes: false } },
      })
    );
  });

  it('refuses an incomplete event or an unknown action before touching the database', async () => {
    await expect(
      recordCourseAccessEvent({ courseId: 'c', targetUserId: 't', action: 'added' })
    ).rejects.toThrow(/required/);
    await expect(
      recordCourseAccessEvent({
        courseId: 'c',
        targetUserId: 't',
        actorUserId: 'a',
        action: 'vanished',
      })
    ).rejects.toThrow(/Unknown course access action/);
    expect(databaseService.connect).not.toHaveBeenCalled();
  });

  it('is best-effort: a failed insert is reported and returns null rather than throwing', async () => {
    collection.insertOne.mockRejectedValue(new Error('disk full'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const stored = await recordCourseAccessEvent({
      courseId: 'course-1',
      targetUserId: 'stu-1',
      actorUserId: 'prof-1',
      action: ACCESS_ACTIONS.REMOVED,
    });

    expect(stored).toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('getCourseAccessLog', () => {
  it('reads the course events newest first, resolving actor and target names', async () => {
    const events = await getCourseAccessLog(COURSE_ID, { limit: 20 });

    expect(events).toEqual([{ _id: 'event-1' }]);
    const [pipeline] = collection.aggregate.mock.calls[0];
    expect(pipeline[0]).toEqual({ $match: { courseId: new ObjectId(COURSE_ID) } });
    expect(pipeline[1]).toEqual({ $sort: { createdAt: -1 } });
    expect(pipeline[2]).toEqual({ $limit: 20 });
    const lookups = pipeline.filter((stage) => stage.$lookup);
    expect(lookups.map((stage) => stage.$lookup.as)).toEqual(['actor', 'target']);
    expect(lookups.every((stage) => stage.$lookup.from === 'grasp_user')).toBe(true);
  });

  it('clamps the limit to a sane range', async () => {
    await getCourseAccessLog(COURSE_ID, { limit: 5000 });
    expect(collection.aggregate.mock.calls[0][0][2]).toEqual({ $limit: 500 });

    await getCourseAccessLog(COURSE_ID, { limit: 0 });
    expect(collection.aggregate.mock.calls[1][0][2]).toEqual({ $limit: 100 });

    await getCourseAccessLog(COURSE_ID);
    expect(collection.aggregate.mock.calls[2][0][2]).toEqual({ $limit: 100 });
  });
});
