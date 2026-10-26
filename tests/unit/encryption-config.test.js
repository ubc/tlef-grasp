const { randomBytes } = require('node:crypto');
const {
  assertKeysAvailable,
  validateEncryptionConfig,
} = require('@ubc/genai-toolkit-encryption');

const CONFIG_PATH = '../../src/services/encryption.config.cjs';

function loadConfig(rollout) {
  let config;
  const previous = process.env.GRASP_ENCRYPTION_ROLLOUT;
  if (rollout === undefined) delete process.env.GRASP_ENCRYPTION_ROLLOUT;
  else process.env.GRASP_ENCRYPTION_ROLLOUT = rollout;
  try {
    jest.isolateModules(() => {
      config = require(CONFIG_PATH);
    });
  } finally {
    if (previous === undefined) delete process.env.GRASP_ENCRYPTION_ROLLOUT;
    else process.env.GRASP_ENCRYPTION_ROLLOUT = previous;
  }
  return config;
}

describe('field-encryption config', () => {
  it('passes the toolkit\'s validation without reading the key', () => {
    const config = loadConfig();
    expect(() => validateEncryptionConfig(config, { requireCollections: true })).not.toThrow();
  });

  describe('key lookup (what the server checks at boot)', () => {
    const previousKey = process.env.GRASP_DATA_ENCRYPTION_KEY;
    afterEach(() => {
      if (previousKey === undefined) delete process.env.GRASP_DATA_ENCRYPTION_KEY;
      else process.env.GRASP_DATA_ENCRYPTION_KEY = previousKey;
    });

    it('names the variable when the key is missing', async () => {
      delete process.env.GRASP_DATA_ENCRYPTION_KEY;
      const compiled = validateEncryptionConfig(loadConfig());
      await expect(assertKeysAvailable(compiled)).rejects.toThrow(/GRASP_DATA_ENCRYPTION_KEY/);
    });

    it('rejects a key that is not 32 bytes', async () => {
      process.env.GRASP_DATA_ENCRYPTION_KEY = randomBytes(16).toString('base64');
      const compiled = validateEncryptionConfig(loadConfig());
      await expect(assertKeysAvailable(compiled)).rejects.toThrow();
    });

    it('accepts a 32-byte base64 key', async () => {
      process.env.GRASP_DATA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
      const compiled = validateEncryptionConfig(loadConfig());
      await expect(assertKeysAvailable(compiled)).resolves.toBeUndefined();
    });
  });

  it('keeps the namespace every stored value is bound to', () => {
    // Changing it makes everything already encrypted unreadable.
    expect(loadConfig().namespace).toBe('tlef-grasp');
  });

  it('encrypts the LMS token rows', () => {
    const { collections } = loadConfig();
    expect(collections.grasp_lms_canvas_tokens.fields).toEqual({ tokens: { encrypt: true } });
    expect(collections.grasp_lms_moodle_tokens.fields).toEqual({ tokens: { encrypt: true } });
  });

  it('starts in mixed mode so data stored before the migration stays readable', () => {
    const config = loadConfig();
    expect(config.readPolicy).toBe('mixed');
    expect(config.queryPolicy).toBe('mixed');
    expect(config.writePolicy).toBe('encrypted');
  });

  it('switches reads and queries together in strict mode', () => {
    const config = loadConfig('strict');
    expect(config.readPolicy).toBe('strict');
    expect(config.queryPolicy).toBe('encrypted');
  });

  it('rejects an unknown rollout stage', () => {
    expect(() => loadConfig('off')).toThrow(/GRASP_ENCRYPTION_ROLLOUT/);
  });
});
