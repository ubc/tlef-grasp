const { test, expect } = require('@playwright/test');
const { randomBytes } = require('node:crypto');
const { MongoClient } = require('mongodb');

// Field-level encryption against a real MongoDB (src/services/encryption.config.cjs):
// a value GRASP writes through databaseService for a configured field is an
// envelope at rest, comes back as plaintext, and a row stored before the
// field was encrypted stays readable. No browser and no server: this drives
// GRASP's own modules from the runner process.
//
// The runner does not load .env. CI exports a per-run key; elsewhere a
// throwaway one is enough, because every row this spec writes is deleted
// again and the server never reads them.
process.env.GRASP_DATA_ENCRYPTION_KEY ||= randomBytes(32).toString('base64');
// The server builds the indexes; two processes doing it at once would race.
process.env.GRASP_SKIP_INDEX_INIT = '1';

const databaseService = require('../../src/services/database');
const { createLmsTokenStore } = require('../../src/lms/token-store');

const DB_NAME = process.env.MONGODB_DB_NAME || 'grasp_db';
const CANVAS_TOKENS = 'grasp_lms_canvas_tokens';

test.describe('Field-level encryption at rest', () => {
  test.skip(!process.env.MONGODB_URI, 'needs MONGODB_URI');

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
