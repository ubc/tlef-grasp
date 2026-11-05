const crypto = require('crypto');
const express = require('express');
const { createLmsTokenStore } = require('../lms/token-store');
const {
  PanoptoError,
  authorizeUrl,
  exchangeCode,
  fetchCaptions,
  getAccessToken,
  isPanoptoConfigured,
  panoptoConfigFromEnv,
  panoptoGet,
} = require('../services/panopto');

const CONNECT_URL = '/api/panopto/auth/login';
const CAPTION_PREVIEW_CHARS = 2000;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createPanoptoIntegration() {
  if (!isPanoptoConfigured()) return { configured: false };
  return {
    configured: true,
    config: panoptoConfigFromEnv(),
    tokenStore: createLmsTokenStore('grasp_panopto_tokens'),
  };
}

function userKey(req) {
  const key = req.user?._id || req.user?.id;
  if (!key) throw new Error('Application authentication required');
  return String(key);
}

function summarizeSession(session) {
  return {
    id: session.Id,
    name: session.Name,
    startTime: session.StartTime,
    durationSeconds: session.Duration,
    viewerUrl: session.Urls?.ViewerUrl,
    hasCaptions: Boolean(session.Urls?.CaptionDownloadUrl),
  };
}

function createPanoptoRouter(integration = createPanoptoIntegration()) {
  const router = express.Router();

  if (!integration.configured) {
    router.use((_req, res) => {
      res.status(404).json({
        success: false,
        configured: false,
        error: 'Panopto integration is not configured',
      });
    });
    return router;
  }

  const { config, tokenStore } = integration;

  const sendFailure = (error, res, next) => {
    if (!(error instanceof PanoptoError)) return next(error);
    console.warn(`[panopto] ${error.message}${error.code ? ` (${error.code})` : ''}`);
    return res.status(502).json({
      success: false,
      error: error.message,
      panoptoStatus: error.status,
      panoptoError: error.code,
    });
  };

  const handle = (handler) => async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      sendFailure(error, res, next);
    }
  };

  // Attaches req.panoptoToken, or answers that this user has not connected.
  const connected = async (req, res, next) => {
    try {
      const accessToken = await getAccessToken(config, tokenStore, userKey(req));
      if (!accessToken) {
        return res.status(409).json({ success: false, connected: false, connectUrl: CONNECT_URL });
      }
      req.panoptoToken = accessToken;
      next();
    } catch (error) {
      sendFailure(error, res, next);
    }
  };

  router.get('/auth/login', (req, res) => {
    const state = crypto.randomBytes(32).toString('hex');
    req.session.panoptoOAuthState = state;
    res.redirect(authorizeUrl(config, state));
  });

  router.get('/auth/callback', handle(async (req, res) => {
    const { code, state, error } = req.query;
    // Set by /auth/login, and single-use whatever happens next.
    const expectedState = req.session?.panoptoOAuthState;
    if (req.session) delete req.session.panoptoOAuthState;

    if (!expectedState || state !== expectedState) {
      return res.status(400).json({ success: false, error: 'Invalid or expired Panopto sign-in state.' });
    }
    if (error) {
      return res.status(400).json({ success: false, error: 'Panopto refused the sign-in.', panoptoError: String(error) });
    }
    if (typeof code !== 'string') {
      return res.status(400).json({ success: false, error: 'Panopto did not return an authorization code.' });
    }

    await tokenStore.set(userKey(req), await exchangeCode(config, code));
    res.redirect('/api/panopto/status');
  }));

  // Whether this user is connected, plus the folders they can create in, which
  // proves the token works against the API.
  router.get('/status', handle(async (req, res) => {
    const accessToken = await getAccessToken(config, tokenStore, userKey(req));
    if (!accessToken) {
      return res.json({ success: true, connected: false, connectUrl: CONNECT_URL });
    }
    const folders = await panoptoGet(config, accessToken, '/folders/creator');
    res.json({
      success: true,
      connected: true,
      host: config.host,
      folders: (folders.Results || []).map(({ Id, Name }) => ({ id: Id, name: Name })),
    });
  }));

  router.get('/sessions', connected, handle(async (req, res) => {
    const { q } = req.query;
    if (typeof q !== 'string' || !q.trim()) {
      return res.status(400).json({ success: false, error: 'Add a search term: ?q=...' });
    }
    const found = await panoptoGet(config, req.panoptoToken, '/sessions/search', { searchQuery: q });
    res.json({ success: true, sessions: (found.Results || []).map(summarizeSession) });
  }));

  router.get('/folders/:id/sessions', connected, handle(async (req, res) => {
    if (!GUID.test(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid Panopto folder id.' });
    }
    const found = await panoptoGet(config, req.panoptoToken, `/folders/${req.params.id}/sessions`);
    res.json({ success: true, sessions: (found.Results || []).map(summarizeSession) });
  }));

  // A preview, not the whole file. Reports the content type because the caption
  // URL may answer with something other than captions (a sign-in page, say).
  router.get('/sessions/:id/captions', connected, handle(async (req, res) => {
    if (!GUID.test(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid Panopto session id.' });
    }
    const session = await panoptoGet(config, req.panoptoToken, `/sessions/${req.params.id}`);
    const captionUrl = session.Urls?.CaptionDownloadUrl;
    if (!captionUrl) {
      return res.json({ success: true, name: session.Name, hasCaptions: false });
    }
    const { contentType, text } = await fetchCaptions(config, req.panoptoToken, captionUrl);
    res.json({
      success: true,
      name: session.Name,
      hasCaptions: true,
      contentType,
      characters: text.length,
      preview: text.slice(0, CAPTION_PREVIEW_CHARS),
    });
  }));

  return router;
}

module.exports = { createPanoptoIntegration, createPanoptoRouter };
