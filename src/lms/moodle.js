const databaseService = require('../services/database');
const {
  moodle,
  createMongoTokenStore,
} = require('@ubc/ubc-genai-toolkit-lms-integration');

const REQUIRED_MOODLE_ENV_VARS = ['MOODLE_DOMAIN'];
const MOODLE_AUTH_BASE_PATH = '/api/lms/moodle/auth';

function isMoodleConfigured(env = process.env) {
  return REQUIRED_MOODLE_ENV_VARS.every(
    (name) => typeof env[name] === 'string' && env[name].trim().length > 0
  );
}

function createMoodleIntegration() {
  if (!isMoodleConfigured()) {
    return { configured: false, moodle, config: null };
  }

  const tokenStore = createMongoTokenStore(() => databaseService.connect(), {
    collectionName: 'grasp_lms_moodle_tokens',
  });

  const config = moodle.loadConfigFromEnv({
    tokenStore,
    getUserKey: (req) => {
      const userKey = req.user?._id || req.user?.id;
      if (!userKey) throw new Error('Application authentication required');
      return String(userKey);
    },
    basePath: MOODLE_AUTH_BASE_PATH,
  });

  return { configured: true, moodle, config };
}

module.exports = {
  MOODLE_AUTH_BASE_PATH,
  REQUIRED_MOODLE_ENV_VARS,
  createMoodleIntegration,
  isMoodleConfigured,
};
