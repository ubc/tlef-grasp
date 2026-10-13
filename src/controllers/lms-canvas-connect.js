// Canvas's OAuth callback (GET /api/lms/canvas/auth/callback). GRASP handles it
// instead of the toolkit's auth router so that it can check the authorized
// Canvas account before keeping its tokens; the toolkit's router still serves
// /login and /logout, and everything else here mirrors its callback.
//
// Canvas authorizes whoever is signed in to Canvas in that browser, and that
// need not be the GRASP user: a shared computer, a TA signed in to Canvas as
// the instructor, a session someone left open. If GRASP kept those tokens,
// this GRASP user could read rosters and write assignments as that person for
// as long as the refresh token lasts. So the callback reads the account's own
// Canvas profile, and keeps the tokens only when its integration_id (at UBC,
// the PUID, the key roster sync matches students on) is the signed-in user's
// PUID. Otherwise it revokes them at Canvas and stores nothing, which leaves a
// connection already on file as it was.

// The `canvas` query parameter Settings explains (LmsConnectionPanels.jsx).
const CONNECT_RESULTS = Object.freeze({
  ERROR: 'error',
  ACCOUNT_MISMATCH: 'account-mismatch',
  IDENTITY_UNAVAILABLE: 'identity-unavailable',
});

const settingsUrl = (result) => `/settings?canvas=${result}`;

// Roster sync matches an integration_id to a PUID regardless of case
// (services/lms-roster-sync.js), so this check does too.
function foldPuid(value) {
  return value === undefined || value === null ? '' : String(value).trim().toUpperCase();
}

/**
 * The authorized account's own integration_id, or '' when Canvas holds none.
 * Canvas's user object (/users/self) leaves integration_id out for anyone but
 * account admins; the profile always carries the caller's own.
 */
async function readCanvasPuid(canvas, config, accessToken) {
  const client = canvas.createApiClient({ canvasDomain: config.canvasDomain, accessToken });
  const profile = await client.get('/users/self/profile');
  return foldPuid(profile?.integration_id);
}

/**
 * Whether the tokens belong to the signed-in user.
 * @returns {Promise<null|string>} null when they do, else a CONNECT_RESULTS value
 */
async function identityProblem(canvas, config, exchanged, user) {
  const puid = foldPuid(user?.puid);
  let canvasPuid;
  try {
    canvasPuid = await readCanvasPuid(canvas, config, exchanged.accessToken);
  } catch (error) {
    // Most likely a key or CANVAS_SCOPES without the profile scope (401).
    console.warn(
      `[canvas] Could not read the Canvas profile of Canvas user ${exchanged.canvasUserId} ` +
      `for GRASP user ${user?._id}: ${error.message}`
    );
    return CONNECT_RESULTS.IDENTITY_UNAVAILABLE;
  }
  if (!canvasPuid || !puid) {
    console.warn(
      canvasPuid
        ? `[canvas] GRASP user ${user?._id} has no PUID to compare; not connecting`
        : `[canvas] Canvas user ${exchanged.canvasUserId} has no integration_id; not connecting ` +
          `GRASP user ${user?._id}`
    );
    return CONNECT_RESULTS.IDENTITY_UNAVAILABLE;
  }
  if (canvasPuid !== puid) {
    console.warn(
      `[canvas] GRASP user ${user?._id} authorized Canvas user ${exchanged.canvasUserId}, ` +
      'whose integration_id is not their PUID; not connecting'
    );
    return CONNECT_RESULTS.ACCOUNT_MISMATCH;
  }
  return null;
}

/**
 * @param {object} canvas - The toolkit's canvas namespace (swappable in tests)
 * @param {object} config - The toolkit config from createCanvasIntegration
 * @returns {import('express').RequestHandler}
 */
function createCanvasOAuthCallback(canvas, config) {
  return async function canvasOAuthCallback(req, res, next) {
    const { code, state, error } = req.query;
    // Set by the toolkit's /login, and single-use whatever happens next.
    const expectedState = req.session?.canvasOAuthState;
    const returnTo = req.session?.canvasOAuthReturnTo || '/';
    if (req.session) {
      delete req.session.canvasOAuthState;
      delete req.session.canvasOAuthReturnTo;
    }

    // A denial (Cancel on Canvas's consent page, a key that is off) comes back
    // as ?error= without a code; return to the connection UI.
    if (error) return res.redirect(settingsUrl(CONNECT_RESULTS.ERROR));
    if (!expectedState || state !== expectedState) {
      return res.status(400).send('Invalid or expired Canvas OAuth state.');
    }
    if (typeof code !== 'string') {
      return res.status(400).send('Canvas OAuth callback is missing an authorization code.');
    }

    try {
      const exchanged = await canvas.exchangeCodeForTokens(config, code);

      const problem = await identityProblem(canvas, config, exchanged, req.user);
      if (problem) {
        try {
          await canvas.revokeToken(config, exchanged.accessToken);
        } catch (revokeError) {
          console.warn(`[canvas] Could not revoke the refused Canvas token: ${revokeError.message}`);
        }
        return res.redirect(settingsUrl(problem));
      }

      const userKey = await config.getUserKey(req);
      // Canvas does not always issue a fresh refresh token on re-authorization;
      // the one on file may stand in only if it is the same Canvas account's.
      const existing = await config.tokenStore.get(userKey);
      const refreshToken = exchanged.refreshToken
        ?? (existing?.canvasUserId === exchanged.canvasUserId ? existing.refreshToken : undefined);
      if (!refreshToken) {
        throw new canvas.CanvasOAuthError(
          'Canvas did not issue a refresh_token and none is on file for this Canvas account'
        );
      }
      await config.tokenStore.set(userKey, {
        accessToken: exchanged.accessToken,
        refreshToken,
        expiresAt: exchanged.expiresAt,
        canvasUserId: exchanged.canvasUserId,
      });
      return res.redirect(returnTo);
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { createCanvasOAuthCallback };
