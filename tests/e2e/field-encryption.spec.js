const { test, expect } = require('@playwright/test');
const { MongoClient } = require('mongodb');

// Field-level encryption against a real MongoDB (src/services/encryption.config.cjs):
// a value GRASP writes through databaseService for a configured field is an
// envelope at rest, comes back as plaintext, and a row stored before the
// field was encrypted stays readable. No browser and no server: this drives
// GRASP's own modules from the runner process.
//
// It runs only when the runner has the server's key (CI exports one per run;
// see FIELD_ENCRYPTION_ON). Without a key, encryption is off by design, and
// writing here with a key of its own would mark the test database as
// encrypted for a server that cannot read it.
//
// The server builds the indexes; two processes doing it at once would race.
process.env.GRASP_SKIP_INDEX_INIT = '1';

const { ObjectId } = require('mongodb');
const databaseService = require('../../src/services/database');
const userService = require('../../src/services/user');
const { createLmsTokenStore } = require('../../src/lms/token-store');
const { FIELD_ENCRYPTION_ON } = require('./helpers');

const DB_NAME = process.env.MONGODB_DB_NAME || 'grasp_db';
const CANVAS_TOKENS = 'grasp_lms_canvas_tokens';

test.afterAll(async () => {
  await databaseService.disconnect();
});

test.describe('Field-level encryption at rest', () => {
  test.skip(!process.env.MONGODB_URI, 'needs MONGODB_URI');
  test.skip(!FIELD_ENCRYPTION_ON, 'needs GRASP_DATA_ENCRYPTION_KEY in the runner env (the server\'s key)');

  let rawClient;
  let rawTokens;
  const userKeys = [];
  const newUserKey = () => {
    const key = `e2e-encryption-${Date.now()}-${userKeys.length}`;
    userKeys.push(key);
    return key;
  };

  test.beforeAll(async () => {
    rawClient = new MongoClient(process.env.MONGODB_URI, { connectTimeoutMS: 8000 });
    await rawClient.connect();
    rawTokens = rawClient.db(DB_NAME).collection(CANVAS_TOKENS);
  });

  test.afterAll(async () => {
    if (rawTokens) await rawTokens.deleteMany({ userKey: { $in: userKeys } });
    await rawClient?.close();
  });

  test('Canvas tokens are stored encrypted and read back as written', async () => {
    const store = createLmsTokenStore(CANVAS_TOKENS);
    const userKey = newUserKey();
    const tokens = {
      accessToken: 'e2e-access-token-value',
      refreshToken: 'e2e-refresh-token-value',
      expiresAt: 4102444800000,
      canvasUserId: '4242',
    };

    await store.set(userKey, tokens);

    const raw = await rawTokens.findOne({ userKey });
    expect(raw.tokens).toMatchObject({ __ubc_enc: 1, alg: 'A256GCM', kid: 'data-2026-10' });
    const stored = JSON.stringify(raw);
    expect(stored).not.toContain('e2e-access-token-value');
    expect(stored).not.toContain('e2e-refresh-token-value');

    await expect(store.get(userKey)).resolves.toEqual(tokens);

    // The database now says it holds encrypted data, so a server started on
    // it without the key refuses to run.
    const marker = await rawClient.db(DB_NAME).collection('grasp_field_encryption')
      .findOne({ _id: 'field-encryption' });
    expect(marker.enabledAt).toBeInstanceOf(Date);
  });

  test('a token refresh with no canvasUserId on file still saves', async () => {
    // The LMS toolkit's refresh path copies canvasUserId from the stored row.
    const store = createLmsTokenStore(CANVAS_TOKENS);
    const userKey = newUserKey();

    await store.set(userKey, {
      accessToken: 'refreshed',
      refreshToken: 'kept',
      expiresAt: 4102444800000,
      canvasUserId: undefined,
    });

    await expect(store.get(userKey)).resolves.toEqual({
      accessToken: 'refreshed',
      refreshToken: 'kept',
      expiresAt: 4102444800000,
      canvasUserId: null,
    });
  });

  test('a token row stored before encryption is still read', async () => {
    const store = createLmsTokenStore(CANVAS_TOKENS);
    const userKey = newUserKey();
    const tokens = { accessToken: 'legacy', refreshToken: 'legacy-refresh', expiresAt: 4102444800000, canvasUserId: '7' };
    await rawTokens.insertOne({ userKey, tokens });

    await expect(store.get(userKey)).resolves.toEqual(tokens);
  });
});

test.describe('Field-level encryption of users', () => {
  test.skip(!process.env.MONGODB_URI, 'needs MONGODB_URI');
  test.skip(!FIELD_ENCRYPTION_ON, 'needs GRASP_DATA_ENCRYPTION_KEY in the runner env (the server\'s key)');

  const ENVELOPE = { __ubc_enc: 1, alg: 'A256GCM', kid: 'data-2026-10' };
  const INSTANCE = 'https://canvas.e2e-encryption.test';
  const run = `${Date.now()}`;
  const puidOf = (n) => `E2EENC${run}${n}`;

  let rawClient;
  let rawUsers;
  const created = [];
  const createUser = async (fields) => {
    await userService.createOrUpdateUser(fields);
    const user = await userService.getUserByPuid(fields.puid);
    created.push(user._id);
    return user;
  };

  test.beforeAll(async () => {
    rawClient = new MongoClient(process.env.MONGODB_URI, { connectTimeoutMS: 8000 });
    await rawClient.connect();
    rawUsers = rawClient.db(DB_NAME).collection('grasp_user');
  });

  test.afterAll(async () => {
    if (rawUsers) await rawUsers.deleteMany({ _id: { $in: created } });
    await rawClient?.close();
  });

  test('who a user is is stored encrypted, and found by PUID, by id and by search', async () => {
    const puid = puidOf(1);
    const user = await createUser({
      puid,
      email: `ann.${run}@student.ubc.ca`,
      legalName: `Annabel Encrypted ${run}`,
      displayName: 'Ann',
      affiliation: ['student'],
    });

    expect(user).toMatchObject({ puid, email: `ann.${run}@student.ubc.ca`, legalName: `Annabel Encrypted ${run}`, displayName: 'Ann' });
    expect(user).not.toHaveProperty('puid__bidx');

    const raw = await rawUsers.findOne({ _id: user._id });
    for (const field of ['puid', 'email', 'legalName', 'displayName']) {
      expect(raw[field]).toMatchObject(ENVELOPE);
    }
    expect(typeof raw.puid__bidx).not.toBe('undefined');
    expect(JSON.stringify(raw)).not.toContain(run);

    const byId = await userService.getUsersByIds([String(user._id)], { legalName: 1 });
    expect(byId.get(String(user._id)).legalName).toBe(`Annabel Encrypted ${run}`);

    const found = await userService.searchUsersNotInCourse(new ObjectId(), `encrypted ${run}`);
    expect(found.map((match) => String(match._id))).toEqual([String(user._id)]);
  });

  test('a roster placeholder gets its email at first login', async () => {
    const puid = puidOf(2);
    const placeholder = await createUser({ puid, displayName: 'Canvas Name', affiliation: ['student'] });
    expect(placeholder.email).toBeUndefined();

    await expect(userService.backfillUserEmail(puid, `bea.${run}@student.ubc.ca`)).resolves.toBe(true);
    await expect(userService.backfillUserEmail(puid, 'other@student.ubc.ca')).resolves.toBe(false);

    expect((await userService.getUserByPuid(puid)).email).toBe(`bea.${run}@student.ubc.ca`);
  });

  test('a Canvas login id is stored encrypted, and an identity moves between users', async () => {
    const [first, second] = [puidOf(3), puidOf(4)];
    const firstUser = await createUser({ puid: first, affiliation: ['student'] });
    const secondUser = await createUser({ puid: second, affiliation: ['student'] });
    const account = { provider: 'canvas', instance: INSTANCE, externalUserId: `9${run}` };
    const warn = console.warn;
    console.warn = () => {};
    try {
      await userService.upsertUserLmsAccount(firstUser._id, { ...account, loginId: first });
      await userService.upsertUserLmsAccount(firstUser._id, { ...account, loginId: `${first}-updated` });
      await userService.upsertUserLmsAccount(secondUser._id, { ...account, loginId: second });
    } finally {
      console.warn = warn;
    }

    expect((await userService.getUserById(firstUser._id)).lmsAccounts).toEqual([]);
    const moved = (await userService.getUserById(secondUser._id)).lmsAccounts;
    expect(moved).toEqual([expect.objectContaining({ ...account, loginId: second })]);

    const raw = await rawUsers.findOne({ _id: secondUser._id });
    expect(raw.lmsAccounts[0].loginId).toMatchObject(ENVELOPE);
    expect(raw.lmsAccounts[0].externalUserId).toBe(`9${run}`);
  });

  test('a user row stored before encryption is still found, and encrypted on its next write', async () => {
    const puid = puidOf(5);
    const { insertedId } = await rawUsers.insertOne({
      puid,
      email: `legacy.${run}@ubc.ca`,
      affiliation: ['faculty'],
      lmsAccounts: [{ provider: 'canvas', instance: INSTANCE, externalUserId: `8${run}`, loginId: puid }],
    });
    created.push(insertedId);

    expect((await userService.getUserByPuid(puid))._id).toEqual(insertedId);

    await userService.createOrUpdateUser({ puid, email: `legacy.${run}@ubc.ca`, affiliation: ['faculty'] });
    await userService.upsertUserLmsAccount(insertedId, { provider: 'canvas', instance: INSTANCE, externalUserId: `8${run}`, loginId: puid });

    const raw = await rawUsers.findOne({ _id: insertedId });
    expect(raw.puid).toMatchObject(ENVELOPE);
    expect(raw.email).toMatchObject(ENVELOPE);
    expect(raw.lmsAccounts[0].loginId).toMatchObject(ENVELOPE);
    expect((await userService.getUserByPuid(puid))._id).toEqual(insertedId);
  });
});

