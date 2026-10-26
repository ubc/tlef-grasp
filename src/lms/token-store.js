const databaseService = require('../services/database');
const { createMongoTokenStore } = require('@ubc/ubc-genai-toolkit-lms-integration');

/**
 * The LMS toolkit's MongoDB token store, on GRASP's database. Token rows are
 * encrypted at rest (see services/encryption.config.cjs).
 *
 * The encryption toolkit rejects `undefined` anywhere in an encrypted value,
 * and the LMS toolkit can produce one: its Canvas refresh path copies
 * `canvasUserId` from the stored row, which an older row may not have. When
 * that `set` throws, the refresh path deletes the row and the instructor is
 * silently disconnected. Storing `undefined` as `null` is what the MongoDB
 * driver did before encryption, so the stored shape does not change.
 *
 * @param {string} collectionName
 */
function createLmsTokenStore(collectionName) {
  const store = createMongoTokenStore(() => databaseService.connect(), { collectionName });
  return {
    ...store,
    set: (userKey, tokens) => store.set(userKey, undefinedAsNull(tokens)),
  };
}

function undefinedAsNull(tokens) {
  if (!tokens || typeof tokens !== 'object') return tokens;
  return Object.fromEntries(
    Object.entries(tokens).map(([key, value]) => [key, value === undefined ? null : value])
  );
}

module.exports = { createLmsTokenStore, undefinedAsNull };
