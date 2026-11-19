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

// grasp_user as the toolkit leaves it usable once lmsAccounts holds an
// encrypted login id: whole-document reads, dotted-path filters, and
// whole-array $set guarded by lmsAccountsVersion. $elemMatch, $pull and
// positional paths are refused, as the toolkit refuses them.
function fakeUsers(docs) {
  const same = (a, b) => String(a) === String(b);
  const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => {
    if (key === '_id' && value && value.$ne !== undefined) return !same(doc._id, value.$ne);
    if (key === '_id') return same(doc._id, value);
    if (key.startsWith('lmsAccounts.')) {
      const field = key.slice('lmsAccounts.'.length);
      return (doc.lmsAccounts || []).some((entry) => entry[field] === value);
    }
    if (value && typeof value === 'object' && '$exists' in value) return (doc[key] !== undefined) === value.$exists;
    if (value && typeof value === 'object') throw new Error(`fake grasp_user refuses ${JSON.stringify(value)}`);
    return doc[key] === value;
  });
  const users = {
    docs,
    find: jest.fn((filter) => ({ toArray: async () => docs.filter((doc) => matches(doc, filter)) })),
    findOne: jest.fn(async (filter) => {
      const doc = docs.find((d) => matches(d, filter));
      return doc ? structuredClone(doc) : null;
    }),
    updateOne: jest.fn(async (filter, update) => {
      for (const key of Object.keys(update.$set || {})) {
        if (key.includes('$')) throw new Error(`fake grasp_user refuses ${key}`);
      }
      if (update.$pull || update.$push) throw new Error('fake grasp_user refuses $pull/$push here');
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, structuredClone(update.$set));
      for (const [key, by] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + by;
      return { matchedCount: 1, modifiedCount: 1 };
    }),
    updateMany: jest.fn(),
  };
  return users;
}

describe('upsertUserLmsAccount', () => {
  const OTHER_OID = new ObjectId('507f1f77bcf86cd799439012');
  const OTHER_INSTANCE = 'https://moodle.example.test';
  const CANVAS_9001 = { provider: 'canvas', instance: INSTANCE, externalUserId: '9001' };
  let users;

  const setup = (docs) => {
    users = fakeUsers(docs);
    databaseService.connect.mockResolvedValue({ collection: jest.fn(() => users) });
  };
  const doc = (id) => users.docs.find((d) => String(d._id) === String(id));

  beforeEach(() => {
    jest.clearAllMocks();
    setup([{ _id: USER_OID }, { _id: OTHER_OID }]);
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
    loginId: 'ann@student.ubc.ca',
    updatedAt: UPDATED,
  };

  it('first takes the same Canvas identity away from any other GRASP user', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const otherMoodle = { provider: 'moodle', instance: OTHER_INSTANCE, externalUserId: '9001' };
    setup([
      { _id: USER_OID },
      { _id: OTHER_OID, lmsAccounts: [{ ...CANVAS_9001, loginId: 'old' }, otherMoodle] },
    ]);

    await upsertUserLmsAccount(USER_ID, account());

    expect(doc(OTHER_OID).lmsAccounts).toEqual([otherMoodle]);
    expect(doc(USER_OID).lmsAccounts).toEqual([ENTRY]);
    expect(users.find).toHaveBeenCalledWith(
      {
        _id: { $ne: USER_OID },
        'lmsAccounts.provider': 'canvas',
        'lmsAccounts.instance': INSTANCE,
        'lmsAccounts.externalUserId': '9001',
      },
      { projection: { _id: 1 } }
    );
    // The move is logged, since it means the identity changed hands.
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('leaves alone a user whose entries only match the identity between them', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const split = [
      { provider: 'canvas', instance: INSTANCE, externalUserId: '1234' },
      { provider: 'moodle', instance: OTHER_INSTANCE, externalUserId: '9001' },
    ];
    setup([{ _id: USER_OID }, { _id: OTHER_OID, lmsAccounts: split, lmsAccountsVersion: 3 }]);

    await upsertUserLmsAccount(USER_ID, account());

    expect(doc(OTHER_OID)).toEqual({ _id: OTHER_OID, lmsAccounts: split, lmsAccountsVersion: 3 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('updates the existing entry for this provider and instance in place', async () => {
    const moodle = { provider: 'moodle', instance: OTHER_INSTANCE, externalUserId: '77' };
    setup([{
      _id: USER_OID,
      lmsAccounts: [moodle, { ...CANVAS_9001, loginId: 'old', updatedAt: new Date(0) }],
      lmsAccountsVersion: 4,
    }]);

    await upsertUserLmsAccount(USER_ID, account());

    expect(doc(USER_OID).lmsAccounts).toEqual([moodle, ENTRY]);
    expect(users.updateOne).toHaveBeenCalledWith(
      { _id: USER_OID, lmsAccountsVersion: 4 },
      { $set: { lmsAccounts: [moodle, ENTRY] }, $inc: { lmsAccountsVersion: 1 } }
    );
    expect(doc(USER_OID).lmsAccountsVersion).toBe(5);
  });

  it('appends an entry when the user has none for this instance', async () => {
    await upsertUserLmsAccount(USER_ID, account());

    expect(users.updateOne).toHaveBeenCalledWith(
      { _id: USER_OID, lmsAccountsVersion: { $exists: false } },
      { $set: { lmsAccounts: [ENTRY] }, $inc: { lmsAccountsVersion: 1 } }
    );
    expect(doc(USER_OID).lmsAccounts).toEqual([ENTRY]);
  });

  it('re-reads and retries when another write changed the list in between', async () => {
    const moodle = { provider: 'moodle', instance: OTHER_INSTANCE, externalUserId: '77' };
    const realFindOne = users.findOne.getMockImplementation();
    // Another sync appends its entry right after this one reads the user.
    users.findOne.mockImplementationOnce(async (filter) => {
      const read = await realFindOne(filter);
      Object.assign(doc(USER_OID), { lmsAccounts: [moodle], lmsAccountsVersion: 1 });
      return read;
    });

    await upsertUserLmsAccount(USER_ID, account());

    expect(users.updateOne).toHaveBeenCalledTimes(2);
    expect(doc(USER_OID).lmsAccounts).toEqual([moodle, ENTRY]);
    expect(doc(USER_OID).lmsAccountsVersion).toBe(2);
  });

  it('gives up after repeated lost races instead of looping', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    users.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

    await expect(upsertUserLmsAccount(USER_ID, account())).rejects.toThrow(/kept changing/);
    expect(users.updateOne).toHaveBeenCalledTimes(5);
    console.error.mockRestore();
  });

  it('stores the identity and login id, not the SIS id or names the roster carried', async () => {
    await upsertUserLmsAccount(USER_ID, account());

    expect(doc(USER_OID).lmsAccounts[0]).toEqual({
      provider: 'canvas',
      instance: INSTANCE,
      externalUserId: '9001',
      loginId: 'ann@student.ubc.ca',
      updatedAt: UPDATED,
    });
  });

  it('leaves the login id out when Canvas returned none', async () => {
    await upsertUserLmsAccount(USER_ID, account({ loginId: '' }));

    expect(doc(USER_OID).lmsAccounts[0]).not.toHaveProperty('loginId');
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
  const STAMP = new Date('2026-09-01T10:00:00.000Z');
  let users;

  beforeEach(() => {
    jest.clearAllMocks();
    users = {
      findOne: jest.fn().mockResolvedValue({ _id: USER_OID, updatedAt: STAMP }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    databaseService.connect.mockResolvedValue({ collection: jest.fn(() => users) });
  });

  it.each([
    ['missing', {}],
    ['null', { email: null }],
    ['empty', { email: '' }],
  ])('sets the email on a user whose email is %s, unless the user changed since it was read', async (_, stored) => {
    users.findOne.mockResolvedValue({ _id: USER_OID, updatedAt: STAMP, ...stored });

    await expect(backfillUserEmail('PUID1', '  ann@student.ubc.ca ')).resolves.toBe(true);

    expect(users.findOne).toHaveBeenCalledWith({ puid: 'PUID1' }, { projection: { _id: 1, email: 1, updatedAt: 1 } });
    const [filter, update] = users.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: USER_OID, updatedAt: STAMP });
    expect(update.$set.email).toBe('ann@student.ubc.ca');
  });

  it('guards a user that has never been updated on the missing timestamp', async () => {
    users.findOne.mockResolvedValue({ _id: USER_OID });

    await backfillUserEmail('PUID1', 'ann@student.ubc.ca');

    expect(users.updateOne.mock.calls[0][0]).toEqual({ _id: USER_OID, updatedAt: null });
  });

  it('never overwrites an email that is already set', async () => {
    users.findOne.mockResolvedValue({ _id: USER_OID, email: 'kept@ubc.ca', updatedAt: STAMP });

    await expect(backfillUserEmail('PUID1', 'new@ubc.ca')).resolves.toBe(false);
    expect(users.updateOne).not.toHaveBeenCalled();
  });

  it('reports false when the user changed between the read and the write', async () => {
    users.updateOne.mockResolvedValue({ modifiedCount: 0 });

    await expect(backfillUserEmail('PUID1', 'new@ubc.ca')).resolves.toBe(false);
  });

  it('reports false for an unknown PUID', async () => {
    users.findOne.mockResolvedValue(null);

    await expect(backfillUserEmail('NOPE', 'new@ubc.ca')).resolves.toBe(false);
    expect(users.updateOne).not.toHaveBeenCalled();
  });

  it('writes nothing for an empty email', async () => {
    await expect(backfillUserEmail('PUID1', '   ')).resolves.toBe(false);
    expect(users.findOne).not.toHaveBeenCalled();
    expect(users.updateOne).not.toHaveBeenCalled();
  });
});
