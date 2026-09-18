// User-service pieces behind manual course access (issue #115):
//   - searchUsersNotInCourse: the search-only picker query
//   - grantPromotedStaffAffiliation: safe for SAML staff designated as TA

jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));

const { ObjectId } = require('mongodb');
const databaseService = require('../../src/services/database');
const {
  searchUsersNotInCourse,
  grantPromotedStaffAffiliation,
} = require('../../src/services/user');

const COURSE_ID = '507f1f77bcf86cd799439011';
const MEMBER_ID = new ObjectId('507f1f77bcf86cd799439021');
const GUEST_ID = new ObjectId('507f1f77bcf86cd799439022');
const GUEST2_ID = new ObjectId('507f1f77bcf86cd799439023');

describe('searchUsersNotInCourse', () => {
  let userFind;
  let userCursor;
  let membershipCollection;

  beforeEach(() => {
    jest.clearAllMocks();
    userCursor = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([
        { _id: GUEST_ID, email: 'guest@ubc.ca', affiliation: ['student'] },
        { _id: GUEST2_ID, email: 'guest2@ubc.ca', affiliation: ['staff'] },
      ]),
    };
    userFind = jest.fn(() => userCursor);
    membershipCollection = {
      // getUserIdsInCourse: one existing member
      find: jest.fn(() => ({
        toArray: () => Promise.resolve([{ userId: MEMBER_ID, courseId: COURSE_ID }]),
      })),
      // countMembershipsByUser: guest2 is in two courses, guest in none
      aggregate: jest.fn(() => ({
        toArray: () => Promise.resolve([{ _id: String(GUEST2_ID), count: 2 }]),
      })),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) =>
        name === 'grasp_user' ? { find: userFind } : membershipCollection
      ),
    });
  });

  it('matches email or either name case-insensitively, excluding current members', async () => {
    const results = await searchUsersNotInCourse(COURSE_ID, 'Guest');

    const [filter, options] = userFind.mock.calls[0];
    expect(filter._id.$nin).toEqual(expect.arrayContaining([MEMBER_ID, String(MEMBER_ID)]));
    expect(filter.$or.map((clause) => Object.keys(clause)[0])).toEqual([
      'email',
      'displayName',
      'legalName',
    ]);
    const pattern = filter.$or[0].email;
    expect(pattern).toBeInstanceOf(RegExp);
    expect(pattern.flags).toContain('i');
    expect(pattern.test('a.GUEST.b')).toBe(true);
    // Only fields the picker needs leave the database.
    expect(Object.keys(options.projection).sort()).toEqual(
      ['_id', 'affiliation', 'displayName', 'email', 'legalName', 'puid', 'staffViaTaPromotion'].sort()
    );
    expect(userCursor.limit).toHaveBeenCalledWith(10);

    expect(results.map((u) => [String(u._id), u.courseCount])).toEqual([
      [String(GUEST_ID), 0],
      [String(GUEST2_ID), 2],
    ]);
  });

  it('treats the query as literal text, not a regular expression', async () => {
    await searchUsersNotInCourse(COURSE_ID, 'a.b+c(d)');

    const pattern = userFind.mock.calls[0][0].$or[0].email;
    expect(pattern.source).toBe('a\\.b\\+c\\(d\\)');
    expect(pattern.test('xa.b+c(d)y')).toBe(true);
    expect(pattern.test('aXb+c(d)')).toBe(false);
  });

  it('caps the limit and returns nothing for a blank query without querying', async () => {
    await searchUsersNotInCourse(COURSE_ID, 'guest', { limit: 999 });
    expect(userCursor.limit).toHaveBeenCalledWith(50);

    userFind.mockClear();
    expect(await searchUsersNotInCourse(COURSE_ID, '   ')).toEqual([]);
    expect(userFind).not.toHaveBeenCalled();
  });

  it('drops a match whose membership id shape slipped past $nin', async () => {
    userCursor.toArray.mockResolvedValue([
      { _id: MEMBER_ID, email: 'member@ubc.ca', affiliation: ['student'] },
      { _id: GUEST_ID, email: 'guest@ubc.ca', affiliation: ['student'] },
    ]);

    const results = await searchUsersNotInCourse(COURSE_ID, 'ubc');

    expect(results.map((u) => String(u._id))).toEqual([String(GUEST_ID)]);
  });
});

describe('grantPromotedStaffAffiliation', () => {
  let collection;

  const withUser = (user) => {
    collection = {
      findOne: jest.fn().mockResolvedValue(user),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    databaseService.connect.mockResolvedValue({ collection: jest.fn(() => collection) });
  };

  beforeEach(() => jest.clearAllMocks());

  it('adds staff to a student and marks it as granted by a promotion', async () => {
    withUser({ _id: GUEST_ID, affiliation: 'student' });

    await grantPromotedStaffAffiliation(String(GUEST_ID));

    const [filter, update] = collection.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: GUEST_ID });
    expect(update.$set.affiliation).toEqual(['student', 'staff']);
    expect(update.$set.staffViaTaPromotion).toBe(true);
  });

  it('leaves a SAML staff affiliation untouched and never sets the promotion marker', async () => {
    withUser({ _id: GUEST2_ID, affiliation: ['staff'] });

    const result = await grantPromotedStaffAffiliation(GUEST2_ID);

    expect(result).toBeNull();
    expect(collection.updateOne).not.toHaveBeenCalled();
  });

  it('still refreshes a user who is already a promoted TA elsewhere', async () => {
    withUser({ _id: GUEST_ID, affiliation: ['student', 'staff'], staffViaTaPromotion: true });

    await grantPromotedStaffAffiliation(GUEST_ID);

    const [, update] = collection.updateOne.mock.calls[0];
    expect(update.$set.affiliation).toEqual(['student', 'staff']);
    expect(update.$set.staffViaTaPromotion).toBe(true);
  });

  it('returns null for an unknown user', async () => {
    withUser(null);
    expect(await grantPromotedStaffAffiliation(GUEST_ID)).toBeNull();
    expect(collection.updateOne).not.toHaveBeenCalled();
  });
});
