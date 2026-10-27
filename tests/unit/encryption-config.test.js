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
    const KEY_ENVS = ['GRASP_DATA_ENCRYPTION_KEY', 'GRASP_BLIND_INDEX_KEY'];
    const previous = Object.fromEntries(KEY_ENVS.map((name) => [name, process.env[name]]));
    const key = (bytes = 32) => randomBytes(bytes).toString('base64');
    beforeEach(() => {
      process.env.GRASP_DATA_ENCRYPTION_KEY = key();
      process.env.GRASP_BLIND_INDEX_KEY = key();
    });
    afterEach(() => {
      for (const name of KEY_ENVS) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
    });

    it.each(KEY_ENVS)('names %s when it is missing', async (name) => {
      delete process.env[name];
      const compiled = validateEncryptionConfig(loadConfig());
      await expect(assertKeysAvailable(compiled)).rejects.toThrow(new RegExp(name));
    });

    it.each(KEY_ENVS)('rejects a %s that is not 32 bytes', async (name) => {
      process.env[name] = key(16);
      const compiled = validateEncryptionConfig(loadConfig());
      await expect(assertKeysAvailable(compiled)).rejects.toThrow();
    });

    it('accepts two 32-byte base64 keys', async () => {
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

  it('encrypts what a student writes and the AI\'s judgement of it', () => {
    const { collections } = loadConfig();
    expect(collections.grasp_student_attempt.fields).toEqual({
      selectedAnswer: { encrypt: true },
      feedbackText: { encrypt: true },
      aiCriteria: { encrypt: true },
    });
    expect(collections.grasp_quiz_question_flag.fields).toEqual({ comment: { encrypt: true } });
  });

  it('encrypts who a user is, keeping PUID lookups and their uniqueness', () => {
    const { collections } = loadConfig();
    expect(collections.grasp_user.fields).toEqual({
      puid: {
        encrypt: true,
        blindIndex: { field: 'puid__bidx', keyId: 'lookup-2026-10', normalize: 'exact', unique: true },
      },
      email: { encrypt: true },
      displayName: { encrypt: true },
      legalName: { encrypt: true },
      'lmsAccounts.$[].loginId': { encrypt: true },
    });
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
