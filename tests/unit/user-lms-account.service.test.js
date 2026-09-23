// User-service writes added for Canvas roster sync (issue #113):
//   - upsertUserLmsAccount: one lmsAccounts entry per (provider, instance),
//     and one Canvas identity maps to one GRASP user;
//   - backfillUserEmail: a roster-sync placeholder gets its email at first
//     SAML login, and an email that is already set is never overwritten.
jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const { ObjectId } = require('mongodb');
const databaseService = require('../../src/services/database');
const { upsertUserLmsAccount, backfillUserEmail } = require('../../src/services/user');

const USER_ID = '507f1f77bcf86cd799439011';
const USER_OID = new ObjectId(USER_ID);
const INSTANCE = 'https://canvas.example.test';
const UPDATED = new Date('2026-09-01T10:00:00.000Z');

describe('upsertUserLmsAccount', () => {
  let users;

  beforeEach(() => {
    jest.clearAllMocks();
    users = {
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };
    databaseService.connect.mockResolvedValue({ collection: jest.fn(() => users) });
  });

  const account = (extra = {}) => ({
    provider: 'canvas',
    instance: INSTANCE,
    externalUserId: 9001,
    sisUserId: 'SIS1',
    loginId: 'ann@student.ubc.ca',
    name: 'Ann Student',
    sortableName: 'Student, Ann',
    updatedAt: UPDATED,
    ...extra,
  });

  const ENTRY = {
    provider: 'canvas',
    instance: INSTANCE,
    externalUserId: '9001',
    sisUserId: 'SIS1',
    loginId: 'ann@student.ubc.ca',
    name: 'Ann Student',
    sortableName: 'Student, Ann',
    updatedAt: UPDATED,
  };

  it('first takes the same Canvas identity away from any other GRASP user', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    users.updateMany.mockResolvedValue({ modifiedCount: 1 });

    await upsertUserLmsAccount(USER_ID, account());

    const identity = { provider: 'canvas', instance: INSTANCE, externalUserId: '9001' };
    expect(users.updateMany).toHaveBeenCalledWith(
      { _id: { $ne: USER_OID }, lmsAccounts: { $elemMatch: identity } },
      { $pull: { lmsAccounts: identity } }
    );
    // The move is logged, since it means the identity changed hands.
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(users.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(users.updateOne.mock.invocationCallOrder[0]);
    console.warn.mockRestore();
  });

  it('updates the existing entry for this provider and instance in place', async () => {
    await upsertUserLmsAccount(USER_ID, account());

    expect(users.updateOne).toHaveBeenCalledTimes(1);
    expect(users.updateOne).toHaveBeenCalledWith(
      { _id: USER_OID, lmsAccounts: { $elemMatch: { provider: 'canvas', instance: INSTANCE } } },
      { $set: { 'lmsAccounts.$': ENTRY } }
    );
  });

  it('appends an entry when the user has none for this instance, guarded against a double append', async () => {
    users.updateOne
      .mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 })
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });

    await upsertUserLmsAccount(USER_ID, account());

    expect(users.updateOne).toHaveBeenCalledTimes(2);
    expect(users.updateOne).toHaveBeenLastCalledWith(
      {
        _id: USER_OID,
        lmsAccounts: { $not: { $elemMatch: { provider: 'canvas', instance: INSTANCE } } },
      },
      { $push: { lmsAccounts: ENTRY } }
    );
  });

  it('stores only the optional fields Canvas actually returned', async () => {
    await upsertUserLmsAccount(USER_ID, account({ sisUserId: undefined, loginId: '', sortableName: null }));

    const [, update] = users.updateOne.mock.calls[0];
    expect(update.$set['lmsAccounts.$']).toEqual({
      provider: 'canvas',
      instance: INSTANCE,
      externalUserId: '9001',
      name: 'Ann Student',
      updatedAt: UPDATED,
    });
  });

  it('refuses an account without provider or instance and writes nothing', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(upsertUserLmsAccount(USER_ID, account({ instance: null }))).rejects.toThrow(/required/);
    await expect(upsertUserLmsAccount(USER_ID, account({ provider: '' }))).rejects.toThrow(/required/);

    expect(users.updateMany).not.toHaveBeenCalled();
    expect(users.updateOne).not.toHaveBeenCalled();
    console.error.mockRestore();
  });
});

describe('backfillUserEmail', () => {
  let users;

  beforeEach(() => {
    jest.clearAllMocks();
    users = { updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
    databaseService.connect.mockResolvedValue({ collection: jest.fn(() => users) });
  });

  it('sets the email only on a user whose email is missing, null, or empty', async () => {
    await expect(backfillUserEmail('PUID1', '  ann@student.ubc.ca ')).resolves.toBe(true);

    const [filter, update] = users.updateOne.mock.calls[0];
    expect(filter).toEqual({
      puid: 'PUID1',
      $or: [{ email: { $exists: false } }, { email: null }, { email: '' }],
    });
    expect(update.$set.email).toBe('ann@student.ubc.ca');
  });

  it('reports false when the user already had an email (nothing overwritten)', async () => {
    users.updateOne.mockResolvedValue({ modifiedCount: 0 });

    await expect(backfillUserEmail('PUID1', 'new@ubc.ca')).resolves.toBe(false);
  });

  it('writes nothing for an empty email', async () => {
    await expect(backfillUserEmail('PUID1', '   ')).resolves.toBe(false);
    expect(users.updateOne).not.toHaveBeenCalled();
  });
});
