const databaseService = require('../services/database');
const {
  canvas,
  createMongoTokenStore,
} = require('@ubc/ubc-genai-toolkit-lms-integration');
const {
  CANVAS_CAPABILITIES,
  parseCanvasScopes,
  resolveCanvasCapabilities,
} = require('./canvas-scopes');

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

/**
 * The scopes GRASP requests from Canvas (CANVAS_SCOPES, see canvas-scopes.js).
 * @returns {string[]} [] = request none (a key without Enforce Scopes)
 */
function canvasScopesFromEnv(env = process.env) {
  return parseCanvasScopes(env.CANVAS_SCOPES);
}

function createCanvasIntegration() {
  if (!isCanvasConfigured()) {
    return {
      configured: false,
      canvas,
      config: null,
      scopes: [],
      capabilities: Object.fromEntries(CANVAS_CAPABILITIES.map((name) => [name, false])),
    };
  }

  const scopes = canvasScopesFromEnv();

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
    // Sent on the OAuth authorize request; none at all when CANVAS_SCOPES is
    // unset, exactly as before scopes were configurable.
    ...(scopes.length > 0 ? { scopes } : {}),
  });

  return {
    configured: true,
    canvas,
    config,
    scopes,
    capabilities: resolveCanvasCapabilities(scopes),
  };
}

module.exports = {
  CANVAS_AUTH_BASE_PATH,
  REQUIRED_CANVAS_ENV_VARS,
  canvasScopesFromEnv,
  createCanvasIntegration,
  isCanvasConfigured,
};
