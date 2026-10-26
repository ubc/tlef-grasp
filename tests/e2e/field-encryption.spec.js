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

const databaseService = require('../../src/services/database');
const { createLmsTokenStore } = require('../../src/lms/token-store');
const { FIELD_ENCRYPTION_ON } = require('./helpers');

const DB_NAME = process.env.MONGODB_DB_NAME || 'grasp_db';
const CANVAS_TOKENS = 'grasp_lms_canvas_tokens';

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
    await databaseService.disconnect();
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
