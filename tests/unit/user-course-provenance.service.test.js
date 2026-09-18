// Membership provenance (issue #115): how a person got into a course, and
// who granted or changed a TA designation, is kept on grasp_user_course so the
// roster can show it without consulting the audit log.

jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));

const { ObjectId } = require('mongodb');
const databaseService = require('../../src/services/database');
const {
  MEMBERSHIP_SOURCES,
  createUserCourse,
  setUserCourseRole,
} = require('../../src/services/user-course');

const USER_ID = '507f1f77bcf86cd799439021';
const COURSE_ID = '507f1f77bcf86cd799439011';
const PROF_ID = '507f1f77bcf86cd799439031';

let collection;

beforeEach(() => {
  jest.clearAllMocks();
  collection = {
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'm-1' }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  databaseService.connect.mockResolvedValue({ collection: jest.fn(() => collection) });
});

describe('createUserCourse', () => {
  it('records the source and the granting instructor for a manual membership', async () => {
    await createUserCourse(USER_ID, COURSE_ID, {
      source: MEMBERSHIP_SOURCES.MANUAL,
      addedBy: PROF_ID,
    });

    const [doc] = collection.insertOne.mock.calls[0];
    expect(doc.userId).toEqual(new ObjectId(USER_ID));
    expect(doc.courseId).toEqual(new ObjectId(COURSE_ID));
    expect(doc.source).toBe('manual');
    expect(doc.addedBy).toEqual(new ObjectId(PROF_ID));
    expect(doc.createdAt).toBeInstanceOf(Date);
  });

  it('records only the source for memberships GRASP creates itself', async () => {
    await createUserCourse(USER_ID, COURSE_ID, { source: MEMBERSHIP_SOURCES.ROSTER_SYNC });

    const [doc] = collection.insertOne.mock.calls[0];
    expect(doc.source).toBe('roster-sync');
    expect(doc).not.toHaveProperty('addedBy');
  });

  it('keeps working for callers that pass no provenance', async () => {
    await createUserCourse(USER_ID, COURSE_ID);

    const [doc] = collection.insertOne.mock.calls[0];
    expect(Object.keys(doc).sort()).toEqual(['courseId', 'createdAt', 'userId']);
  });
});

describe('setUserCourseRole', () => {
  it('stamps who granted the TA role and when', async () => {
    await setUserCourseRole(USER_ID, COURSE_ID, 'ta', { changedBy: PROF_ID });

    const [, update] = collection.updateOne.mock.calls[0];
    expect(update.$set.courseRole).toBe('ta');
    expect(update.$set.courseRoleChangedBy).toEqual(new ObjectId(PROF_ID));
    expect(update.$set.courseRoleChangedAt).toBeInstanceOf(Date);
  });

  it('stamps who revoked the TA role while clearing it', async () => {
    await setUserCourseRole(USER_ID, COURSE_ID, null, { changedBy: PROF_ID });

    const [, update] = collection.updateOne.mock.calls[0];
    expect(update.$unset).toEqual({ courseRole: '' });
    expect(update.$set.courseRoleChangedBy).toEqual(new ObjectId(PROF_ID));
    expect(update.$set).not.toHaveProperty('courseRole');
  });

  it('writes the plain role change when no actor is given', async () => {
    await setUserCourseRole(USER_ID, COURSE_ID, 'ta');
    expect(collection.updateOne.mock.calls[0][1]).toEqual({ $set: { courseRole: 'ta' } });

    await setUserCourseRole(USER_ID, COURSE_ID, null);
    expect(collection.updateOne.mock.calls[1][1]).toEqual({ $unset: { courseRole: '' } });
  });
});
