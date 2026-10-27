'use strict';

// Field-level encryption (@ubc/genai-toolkit-encryption). The fields listed
// here are encrypted before they reach MongoDB and decrypted when read back
// through databaseService.connect(); the rest of the app keeps working with
// plaintext. Every other collection is untouched.
//
// The same module is the --config for the toolkit's migration CLI
// (`npm run encryption -- <command> --config src/services/encryption.config.cjs`).
//
// Before adding a field, check every query on it against the toolkit's
// docs/supported-operations.md: an encrypted field cannot be range-queried,
// regex-searched, sorted, grouped, or matched by equality without a blind index.

const { defineEncryptionConfig, EnvironmentKeyProvider } = require('@ubc/genai-toolkit-encryption');

// Rollout stage, set per environment. 'mixed' also reads values written before
// the migration (plaintext); switch an environment to 'strict' only after the
// migration CLI has verified every configured collection there.
const ROLLOUT_STAGES = ['mixed', 'strict'];
const rollout = process.env.GRASP_ENCRYPTION_ROLLOUT || 'mixed';
if (!ROLLOUT_STAGES.includes(rollout)) {
  throw new Error(`GRASP_ENCRYPTION_ROLLOUT must be one of ${ROLLOUT_STAGES.join(', ')}`);
}

module.exports = defineEncryptionConfig({
  // Permanent: authenticated into every ciphertext, so changing it makes
  // existing data undecryptable.
  namespace: 'tlef-grasp',

  keyProvider: new EnvironmentKeyProvider({
    activeEncryptionKey: { id: 'data-2026-10', env: 'GRASP_DATA_ENCRYPTION_KEY' },
    decryptionKeys: [],
    // Keys the PUID digests below. Its own secret, never the data key.
    blindIndexKeys: [{ id: 'lookup-2026-10', env: 'GRASP_BLIND_INDEX_KEY' }],
  }),

  readPolicy: rollout,
  queryPolicy: rollout === 'strict' ? 'encrypted' : 'mixed',
  writePolicy: 'encrypted',

  collections: {
    // LMS OAuth / web-service tokens, written by the LMS toolkit's token store.
    grasp_lms_canvas_tokens: { fields: { tokens: { encrypt: true } } },
    grasp_lms_moodle_tokens: { fields: { tokens: { encrypt: true } } },

    // A student's own answer and the AI's judgement of it. The copies of the
    // question's answer key on each attempt stay plaintext, like the questions.
    grasp_student_attempt: {
      fields: {
        selectedAnswer: { encrypt: true },
        feedbackText: { encrypt: true },
        aiCriteria: { encrypt: true },
      },
    },
    // What a student wrote when flagging a question.
    grasp_quiz_question_flag: { fields: { comment: { encrypt: true } } },

    // Who a user is. Users are found by PUID (SAML login, roster syncs), so it
    // also gets a blind index: equality and $in lookups keep working, and the
    // index's uniqueness keeps one row per PUID. Names and email are only read,
    // never queried; the add-people search matches them in the app. The LMS
    // login id is the PUID again for UBC Canvas users, which is why lmsAccounts
    // entries are rewritten whole (services/user.js) instead of in place.
    grasp_user: {
      fields: {
        puid: {
          encrypt: true,
          blindIndex: { field: 'puid__bidx', keyId: 'lookup-2026-10', normalize: 'exact', unique: true },
        },
        email: { encrypt: true },
        displayName: { encrypt: true },
        legalName: { encrypt: true },
        'lmsAccounts.$[].loginId': { encrypt: true },
      },
    },
  },

  // Used only by the migration CLI.
  database: { uriEnv: 'MONGODB_URI', databaseEnv: 'MONGODB_DB_NAME' },
});
