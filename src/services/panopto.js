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
// A caption file of a three-hour lecture is a few hundred KB.
const MAX_CAPTION_BYTES = 5 * 1024 * 1024;
// Panopto's list endpoints are paged; this bounds a folder listing.
const MAX_LIST_PAGES = 20;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Why a sign-in was not kept: the `panopto` query parameter Settings explains
// (client/src/components/lms/LmsConnectionPanels.jsx).
const CONNECT_RESULTS = Object.freeze({
  ERROR: 'error',
  ACCOUNT_MISMATCH: 'account-mismatch',
  IDENTITY_UNAVAILABLE: 'identity-unavailable',
});

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

/**
 * Revoke a token at Panopto (RFC 7009). Revoking the refresh token ends the
 * grant; an access token is a signed JWT that simply runs out within the hour.
 */
async function revokeToken(config, token, tokenTypeHint = 'refresh_token') {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const response = await fetch(`https://${config.host}/Panopto/oauth2/connect/revocation`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ token, token_type_hint: tokenTypeHint }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new PanoptoError(`Panopto token revocation failed (${response.status})`, {
      status: response.status,
    });
  }
}

/**
 * The Panopto user id an access token was issued to: its `sub` claim. The token
 * came straight from Panopto's token endpoint, so its claims are read, not
 * verified.
 * @returns {string|null}
 */
function panoptoUserIdFromToken(accessToken) {
  const payload = String(accessToken || '').split('.')[1];
  if (!payload) return null;
  try {
    const { sub } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof sub === 'string' && GUID.test(sub) ? sub : null;
  } catch {
    return null;
  }
}

/**
 * The Panopto account an access token acts as.
 * @returns {Promise<{ id: string, username: string, email: string }>}
 */
async function getPanoptoAccount(config, accessToken) {
  const id = panoptoUserIdFromToken(accessToken);
  if (!id) throw new PanoptoError('Panopto access token names no user');
  const user = await panoptoGet(config, accessToken, `/users/${id}`);
  return {
    id,
    username: typeof user?.Username === 'string' ? user.Username : '',
    email: typeof user?.Email === 'string' ? user.Email : '',
  };
}

const foldPuid = (value) => (value == null ? '' : String(value).trim().toUpperCase());
const foldEmail = (value) => (value == null ? '' : String(value).trim().toLowerCase());

// A Panopto username is "<identity provider>\<user key>" for an account from
// an identity provider such as Canvas or CWL, and a bare name for an account
// made in Panopto itself.
function usernameKey(username) {
  return String(username || '').split('\\').pop().trim();
}

/**
 * Whether a Panopto account is the GRASP user's own, as the Canvas callback
 * checks (controllers/lms-canvas-connect.js). Panopto acts for whoever is signed
 * in to Panopto in that browser, which need not be this GRASP user, and keeping
 * that person's tokens would let this user read their recordings.
 *
 * The account counts as theirs when its username's user key is their PUID, or
 * its email is their CWL email. The PUID match is the strong one; the email
 * match covers accounts keyed on something else.
 *
 * @returns {{ problem: string|null, matchedOn: 'puid'|'email'|null }}
 */
function identityProblem(account, user) {
  const puid = foldPuid(user?.puid);
  const email = foldEmail(user?.email);
  const key = foldPuid(usernameKey(account?.username));
  const accountEmail = foldEmail(account?.email);

  if (puid && key && key === puid) return { problem: null, matchedOn: 'puid' };
  if (email && accountEmail && accountEmail === email) return { problem: null, matchedOn: 'email' };
  if ((!puid && !email) || (!key && !accountEmail)) {
    return { problem: CONNECT_RESULTS.IDENTITY_UNAVAILABLE, matchedOn: null };
  }
  return { problem: CONNECT_RESULTS.ACCOUNT_MISMATCH, matchedOn: null };
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
 * Every page of a paged list endpoint's Results, up to MAX_LIST_PAGES. Panopto
 * does not report a page size, so a page shorter than the first one, or an
 * empty one, is the last.
 */
async function panoptoGetAllPages(config, accessToken, path, query = {}) {
  const results = [];
  let firstPageSize = null;
  for (let pageNumber = 0; pageNumber < MAX_LIST_PAGES; pageNumber += 1) {
    const page = await panoptoGet(config, accessToken, path, { ...query, pageNumber });
    const items = Array.isArray(page?.Results) ? page.Results : [];
    // An endpoint that ignores pageNumber would repeat its first page forever.
    if (items.length === 0 || (results.length > 0 && items[0]?.Id === results[0]?.Id)) break;
    results.push(...items);
    if (firstPageSize === null) firstPageSize = items.length;
    else if (items.length < firstPageSize) break;
  }
  return results;
}

/**
 * The cookies Panopto's legacy pages accept, from GET /api/v1/auth/legacyLogin.
 * Legacy pages such as the caption download ignore a Bearer token and answer an
 * unauthenticated request with an empty 200.
 * @returns {Promise<string>} A Cookie header
 */
async function legacyCookies(config, accessToken) {
  const response = await fetch(`https://${config.host}/Panopto/api/v1/auth/legacyLogin`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status >= 400) {
    throw new PanoptoError(`Panopto legacy sign-in returned ${response.status}`, {
      status: response.status,
    });
  }
  const pairs = response.headers.getSetCookie()
    .map((cookie) => cookie.split(';')[0].trim())
    .filter((pair) => pair.includes('='));
  if (pairs.length === 0) {
    throw new PanoptoError('Panopto legacy sign-in set no cookie', { status: response.status });
  }
  return pairs.join('; ');
}

/**
 * Download a session's caption file from its Urls.CaptionDownloadUrl, signed in
 * with the user's legacy cookie. The URL comes from an API response, so the
 * user's credentials go only to the configured host, and a redirect (to a
 * sign-in page, say) is refused rather than followed.
 * @returns {Promise<string>} The file's text; empty when the video has none
 */
async function fetchCaptions(config, accessToken, captionUrl) {
  const url = new URL(captionUrl);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== config.host.toLowerCase()) {
    throw new PanoptoError('Panopto returned a caption URL on another host');
  }
  const cookies = await legacyCookies(config, accessToken);
  const response = await fetch(url, {
    headers: { Cookie: cookies },
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status !== 200) {
    throw new PanoptoError(`Panopto returned ${response.status} for a caption download`, {
      status: response.status,
    });
  }
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_CAPTION_BYTES) {
    throw new PanoptoError('Panopto caption file is too large', { code: 'too-large' });
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_CAPTION_BYTES) {
    throw new PanoptoError('Panopto caption file is too large', { code: 'too-large' });
  }
  return text;
}

module.exports = {
  CONNECT_RESULTS,
  GUID,
  PANOPTO_SCOPES,
  PanoptoError,
  REQUIRED_PANOPTO_ENV_VARS,
  authorizeUrl,
  exchangeCode,
  fetchCaptions,
  getAccessToken,
  getPanoptoAccount,
  identityProblem,
  isPanoptoConfigured,
  panoptoConfigFromEnv,
  panoptoGet,
  panoptoGetAllPages,
  panoptoUserIdFromToken,
  revokeToken,
};
