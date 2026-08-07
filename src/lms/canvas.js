const databaseService = require('../services/database');
const {
  canvas,
  createMongoTokenStore,
} = require('@ubc/ubc-genai-toolkit-lms-integration');

const REQUIRED_CANVAS_ENV_VARS = [
  'CANVAS_DOMAIN',
  'CANVAS_CLIENT_ID',
  'CANVAS_CLIENT_SECRET',
  'CANVAS_REDIRECT_URI',
];

const CANVAS_AUTH_BASE_PATH = '/api/lms/canvas/auth';

function isCanvasConfigured(env = process.env) {
  return REQUIRED_CANVAS_ENV_VARS.every(
    (name) => typeof env[name] === 'string' && env[name].trim().length > 0
  );
}

function createCanvasIntegration() {
  if (!isCanvasConfigured()) {
    return { configured: false, canvas, config: null };
  }

  const tokenStore = createMongoTokenStore(() => databaseService.connect(), {
    collectionName: 'grasp_lms_canvas_tokens',
  });

  const config = canvas.loadConfigFromEnv({
    tokenStore,
    getUserKey: (req) => {
      const userKey = req.user?._id || req.user?.id;
      if (!userKey) throw new Error('Application authentication required');
      return String(userKey);
    },
    basePath: CANVAS_AUTH_BASE_PATH,
  });

  return { configured: true, canvas, config };
}

module.exports = {
  CANVAS_AUTH_BASE_PATH,
  REQUIRED_CANVAS_ENV_VARS,
  createCanvasIntegration,
  isCanvasConfigured,
};
