// Panopto's OAuth2 sign-in and public REST API, for a Server-side Web
// Application client: each user signs in to Panopto and GRASP acts as them, so
// they reach only the folders and videos Panopto already lets them see.
//
// Endpoints and scopes come from https://<host>/Panopto/oauth2/.well-known/openid-configuration
// and the API from https://<host>/Panopto/api/v1/panoptoApi.json.

const REQUIRED_PANOPTO_ENV_VARS = [
  'PANOPTO_HOST',
  'PANOPTO_CLIENT_ID',
  'PANOPTO_CLIENT_SECRET',
  'PANOPTO_REDIRECT_URI',
];

// offline_access is what makes Panopto issue a refresh token.
const PANOPTO_SCOPES = 'api offline_access';
const REQUEST_TIMEOUT_MS = 15_000;
const EXPIRY_MARGIN_MS = 60_000;

class PanoptoError extends Error {
  /** @param {string} message @param {{status?: number, code?: string}} [details] */
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'PanoptoError';
    this.status = status;
    this.code = code;
  }
}

function isPanoptoConfigured(env = process.env) {
  return REQUIRED_PANOPTO_ENV_VARS.every(
    (name) => typeof env[name] === 'string' && env[name].trim().length > 0
  );
}

function panoptoConfigFromEnv(env = process.env) {
  return {
    host: env.PANOPTO_HOST.trim(),
    clientId: env.PANOPTO_CLIENT_ID.trim(),
    clientSecret: env.PANOPTO_CLIENT_SECRET.trim(),
    redirectUri: env.PANOPTO_REDIRECT_URI.trim(),
  };
}

function authorizeUrl(config, state) {
  const url = new URL(`https://${config.host}/Panopto/oauth2/connect/authorize`);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    scope: PANOPTO_SCOPES,
    state,
  }).toString();
  return url.toString();
}

async function requestTokens(config, params) {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const response = await fetch(`https://${config.host}/Panopto/oauth2/connect/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new PanoptoError(`Panopto token request failed (${response.status})`, {
      status: response.status,
      code: body.error,
    });
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

function exchangeCode(config, code) {
  return requestTokens(config, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
  });
}

/**
 * A usable access token for this user, refreshing it when it is about to expire.
 * @returns {Promise<string|null>} null when the user is not connected, or their
 *   connection can no longer be refreshed (the stored tokens are then removed)
 */
async function getAccessToken(config, tokenStore, userKey) {
  const tokens = await tokenStore.get(userKey);
  if (!tokens) return null;
  if (tokens.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return tokens.accessToken;

  if (!tokens.refreshToken) {
    await tokenStore.delete(userKey);
    return null;
  }
  let refreshed;
  try {
    refreshed = await requestTokens(config, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    });
  } catch (error) {
    // 400/401 mean Panopto refused this refresh token. Anything else (an outage)
    // says nothing about it, so the connection stays on file.
    if (error instanceof PanoptoError && (error.status === 400 || error.status === 401)) {
      await tokenStore.delete(userKey);
      return null;
    }
    throw error;
  }
  await tokenStore.set(userKey, {
    ...refreshed,
    refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
  });
  return refreshed.accessToken;
}

/** GET a path under Panopto's /api/v1. */
async function panoptoGet(config, accessToken, path, query = {}) {
  const url = new URL(`https://${config.host}/Panopto/api/v1${path}`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new PanoptoError(`Panopto API returned ${response.status} for ${path}`, {
      status: response.status,
    });
  }
  return response.json();
}

/**
 * Download a session's captions from its Urls.CaptionDownloadUrl. The URL comes
 * from an API response, so the user's token goes only to the configured host.
 */
async function fetchCaptions(config, accessToken, captionUrl) {
  const url = new URL(captionUrl);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== config.host.toLowerCase()) {
    throw new PanoptoError('Panopto returned a caption URL on another host');
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new PanoptoError(`Panopto returned ${response.status} for a caption download`, {
      status: response.status,
    });
  }
  return { contentType: response.headers.get('content-type'), text: await response.text() };
}

module.exports = {
  PANOPTO_SCOPES,
  PanoptoError,
  REQUIRED_PANOPTO_ENV_VARS,
  authorizeUrl,
  exchangeCode,
  fetchCaptions,
  getAccessToken,
  isPanoptoConfigured,
  panoptoConfigFromEnv,
  panoptoGet,
};
