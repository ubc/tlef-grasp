// Field encryption follows GRASP_DATA_ENCRYPTION_KEY: on when it is set, off
// (plain driver Db) when it is not, and a database that has been used with
// the key refuses to run without it.
jest.mock('@ubc/genai-toolkit-encryption', () => ({
  ...jest.requireActual('@ubc/genai-toolkit-encryption'),
  createEncryptedDb: jest.fn(),
}));

const { randomBytes } = require('node:crypto');
const { createEncryptedDb } = require('@ubc/genai-toolkit-encryption');
const databaseService = require('../../src/services/database');

const KEY_ENV = 'GRASP_DATA_ENCRYPTION_KEY';

function fakeRawDb({ marker = null, upsertError = null } = {}) {
  const markers = {
    findOne: jest.fn().mockResolvedValue(marker),
    updateOne: upsertError
      ? jest.fn().mockRejectedValue(upsertError)
      : jest.fn().mockResolvedValue({ upsertedCount: 1 }),
  };
  return { markers, rawDb: { collection: jest.fn(() => markers) } };
}

describe('field encryption on/off', () => {
  const previousKey = process.env[KEY_ENV];

  beforeEach(() => {
    jest.clearAllMocks();
    createEncryptedDb.mockResolvedValue('protected-db');
  });

  afterEach(() => {
    if (previousKey === undefined) delete process.env[KEY_ENV];
    else process.env[KEY_ENV] = previousKey;
  });

  describe('without the key', () => {
    beforeEach(() => {
      delete process.env[KEY_ENV];
    });

    it('uses the plain driver Db on a database never used with the key', async () => {
      const { rawDb, markers } = fakeRawDb();

      await expect(databaseService.wrapForEncryption(rawDb)).resolves.toBe(rawDb);

      expect(rawDb.collection).toHaveBeenCalledWith('grasp_field_encryption');
      expect(markers.findOne).toHaveBeenCalledWith({ _id: 'field-encryption' });
      expect(createEncryptedDb).not.toHaveBeenCalled();
      expect(markers.updateOne).not.toHaveBeenCalled();
    });

    it('treats a blank key as no key', async () => {
      process.env[KEY_ENV] = '   ';
      const { rawDb } = fakeRawDb();

      await expect(databaseService.wrapForEncryption(rawDb)).resolves.toBe(rawDb);
      expect(createEncryptedDb).not.toHaveBeenCalled();
    });

    it('refuses a database that already holds encrypted data', async () => {
      const { rawDb } = fakeRawDb({
        marker: { _id: 'field-encryption', enabledAt: new Date('2026-10-27T18:00:00.000Z') },
      });

      await expect(databaseService.wrapForEncryption(rawDb)).rejects.toThrow(
        'GRASP_DATA_ENCRYPTION_KEY is not set, but this database has held field-encrypted data since 2026-10-27T18:00:00.000Z'
      );
    });

    it('logs that encryption is off at boot, and lets the server start', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(databaseService.checkEncryptionKey()).resolves.toBe(false);

      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/GRASP_DATA_ENCRYPTION_KEY is not set: field-level encryption is off/));
      warn.mockRestore();
    });
  });

  describe('with the key', () => {
    beforeEach(() => {
      process.env[KEY_ENV] = randomBytes(32).toString('base64');
    });

    it('wraps the Db and records that this database now holds encrypted data', async () => {
      const { rawDb, markers } = fakeRawDb();

      await expect(databaseService.wrapForEncryption(rawDb)).resolves.toBe('protected-db');

      expect(createEncryptedDb).toHaveBeenCalledWith(rawDb, expect.objectContaining({ namespace: 'tlef-grasp' }));
      expect(markers.updateOne).toHaveBeenCalledWith(
        { _id: 'field-encryption' },
        { $setOnInsert: { enabledAt: expect.any(Date) } },
        { upsert: true }
      );
    });

    it('does not record anything when the toolkit rejects the key', async () => {
      createEncryptedDb.mockRejectedValue(new Error('invalid key'));
      const { rawDb, markers } = fakeRawDb();

      await expect(databaseService.wrapForEncryption(rawDb)).rejects.toThrow('invalid key');
      expect(markers.updateOne).not.toHaveBeenCalled();
    });

    it('tolerates another worker recording it at the same moment', async () => {
      const { rawDb } = fakeRawDb({ upsertError: Object.assign(new Error('dup'), { code: 11000 }) });

      await expect(databaseService.wrapForEncryption(rawDb)).resolves.toBe('protected-db');
    });

    it('accepts a valid key at boot', async () => {
      await expect(databaseService.checkEncryptionKey()).resolves.toBe(true);
    });

    it('rejects a malformed key at boot', async () => {
      process.env[KEY_ENV] = randomBytes(16).toString('base64');
      // The key provider caches the key it read first, so use a fresh copy.
      let freshService;
      jest.isolateModules(() => {
        freshService = require('../../src/services/database');
      });

      await expect(freshService.checkEncryptionKey()).rejects.toThrow();
    });
  });
});
