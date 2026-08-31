// The storage half of the reorderable switcher. Three things are pinned here
// because getting them wrong is silent rather than loud:
//   - a cleared nickname is $unset, not stored as "", so the label builders
//     only ever have to handle "absent";
//   - reordering writes absolute positions scoped to one user, so it can
//     neither drift under repeated clicks nor touch anyone else's switcher;
//   - the academic period is derived from the course's sections, because it is
//     deliberately not stored on the course itself.

jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const { updateCourseNickname, MAX_NICKNAME_LENGTH } = require('../../src/services/course');
const { setUserCourseOrder, getUserCourses } = require('../../src/services/user-course');

describe('updateCourseNickname', () => {
  let collection;

  beforeEach(() => {
    jest.clearAllMocks();
    collection = { updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
    databaseService.connect.mockResolvedValue({ collection: jest.fn(() => collection) });
  });

  it('trims the nickname before storing it', async () => {
    const stored = await updateCourseNickname('507f1f77bcf86cd799439011', '  Tuesday cohort  ');

    expect(stored).toBe('Tuesday cohort');
    expect(collection.updateOne.mock.calls[0][1].$set.nickname).toBe('Tuesday cohort');
  });

  it('unsets the field for a blank nickname instead of storing ""', async () => {
    const stored = await updateCourseNickname('507f1f77bcf86cd799439011', '   ');

    expect(stored).toBe('');
    const update = collection.updateOne.mock.calls[0][1];
    expect(update.$unset).toEqual({ nickname: '' });
    expect(update.$set.nickname).toBeUndefined();
  });

  it('truncates a nickname too long to read in the sidebar', async () => {
    const stored = await updateCourseNickname('507f1f77bcf86cd799439011', 'x'.repeat(200));

    expect(stored).toHaveLength(MAX_NICKNAME_LENGTH);
  });
});

describe('setUserCourseOrder', () => {
  let collection;

  beforeEach(() => {
    jest.clearAllMocks();
    collection = { bulkWrite: jest.fn().mockResolvedValue({ modifiedCount: 2 }) };
    databaseService.connect.mockResolvedValue({ collection: jest.fn(() => collection) });
  });

  it('writes absolute positions, so a repeated call is idempotent', async () => {
    const ids = ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'];
    await setUserCourseOrder('507f1f77bcf86cd7994390aa', ids);

    const operations = collection.bulkWrite.mock.calls[0][0];
    expect(operations.map((op) => op.updateOne.update.$set.displayOrder)).toEqual([0, 1]);
  });

  it('scopes every write to the caller, so it cannot reorder another user', async () => {
    await setUserCourseOrder('507f1f77bcf86cd7994390aa', ['507f1f77bcf86cd799439011']);

    const [filter] = collection.bulkWrite.mock.calls[0][0].map((op) => op.updateOne.filter);
    const userClause = filter.$and[0].$or;
    expect(userClause.every((clause) => String(clause.userId) === '507f1f77bcf86cd7994390aa')).toBe(
      true
    );
  });

  it('matches memberships whose courseId was stored as a string', async () => {
    // Older memberships were written with string courseIds; an ObjectId-only
    // filter would silently reorder nothing for those users.
    await setUserCourseOrder('507f1f77bcf86cd7994390aa', ['507f1f77bcf86cd799439011']);

    const [filter] = collection.bulkWrite.mock.calls[0][0].map((op) => op.updateOne.filter);
    const courseClause = filter.$and[1].$or;
    expect(courseClause.some((clause) => typeof clause.courseId === 'string')).toBe(true);
  });

  it('does nothing at all for an empty list', async () => {
    expect(await setUserCourseOrder('507f1f77bcf86cd7994390aa', [])).toBe(0);
    expect(collection.bulkWrite).not.toHaveBeenCalled();
  });
});

describe('getUserCourses', () => {
  let pipeline;

  beforeEach(async () => {
    jest.clearAllMocks();
    const collection = {
      find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })),
      aggregate: jest.fn((stages) => {
        pipeline = stages;
        return { toArray: jest.fn().mockResolvedValue([]) };
      }),
    };
    databaseService.connect.mockResolvedValue({ collection: jest.fn(() => collection) });
    await getUserCourses('507f1f77bcf86cd7994390aa');
  });

  it('derives the academic period from the newest section, not from the course', () => {
    // The period is deliberately absent from the course document so a shell can
    // be reused across terms — the sections are the only truthful source.
    const lookup = pipeline.find((stage) => stage.$lookup?.from === 'grasp_course_section');
    expect(lookup).toBeDefined();
    expect(lookup.$lookup.pipeline).toContainEqual({ $sort: { academicPeriod: -1 } });
    expect(lookup.$lookup.pipeline).toContainEqual({ $limit: 1 });
  });

  it('returns courses in the user\'s saved order, unordered ones last', () => {
    const sort = pipeline.find((stage) => stage.$sort);
    expect(sort.$sort).toEqual({ orderKey: 1, 'course.courseName': 1 });

    const addFields = pipeline.find((stage) => stage.$addFields?.orderKey);
    expect(addFields.$addFields.orderKey).toEqual({
      $ifNull: ['$displayOrder', Number.MAX_SAFE_INTEGER],
    });
  });
});
