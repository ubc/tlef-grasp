const crypto = require('crypto');
const express = require('express');
const { createLmsTokenStore } = require('../lms/token-store');
const { requireCourseMaterialsAccess } = require('../middleware/course-materials-access');
const { requireActiveCourse } = require('../middleware/course-archive');
const { findLmsImportedMaterials } = require('../services/material');
const { MaterialIngestError } = require('../utils/material-file-types');
const { captionsToText } = require('../utils/caption-text');
const {
  CONNECT_RESULTS,
  GUID,
  PanoptoError,
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
  revokeToken,
} = require('../services/panopto');

const PANOPTO_PROVIDER = 'panopto';
const CONNECT_URL = '/api/panopto/auth/login';
const MONGO_DUPLICATE_KEY = 11000;

const NO_CAPTIONS_ERROR =
  'This video has no captions in Panopto yet. Captions can take a while after a recording is uploaded.';
const TOO_LARGE_ERROR = 'This video\'s captions are too large to import.';
const NOT_FOUND_ERROR = 'Panopto did not let GRASP read this video. It may have been deleted or moved.';
const ALREADY_IMPORTED_ERROR = 'This video\'s captions are already a material in this course.';
const PANOPTO_FAILED_ERROR = 'Panopto could not complete this request. Please try again.';

const settingsUrl = (result) => `/settings?panopto=${result}`;

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

// Where to send the browser after signing in: a path on GRASP itself, never
// another site ("//host" and "/\host" are other sites to a browser).
function safeReturnTo(value) {
  if (typeof value !== 'string' || value.length > 300) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  if (/[\u0000-\u001f\\]/.test(value)) return null;
  return value;
}

/**
 * One Panopto session (video), reduced to what the import picker shows.
 * `captions` is false only when Panopto offers no caption link at all; a link
 * is no promise of captions, so the import reports a video that has none.
 */
function summarizeSession(session) {
  return {
    id: String(session.Id).toLowerCase(),
    name: String(session.Name || ''),
    startTime: session.StartTime || null,
    durationSeconds: typeof session.Duration === 'number' ? session.Duration : null,
    viewerUrl: session.Urls?.ViewerUrl || null,
    captions: Boolean(session.Urls?.CaptionDownloadUrl),
  };
}

function publicFolder(folder) {
  return {
    id: String(folder.Id).toLowerCase(),
    name: String(folder.Name || ''),
    parentName: String(folder.ParentFolder?.Name || ''),
  };
}

// What the browser may know about the material a video was imported as.
function publicImport(material) {
  if (!material) return null;
  return {
    sourceId: String(material.sourceId),
    documentTitle: String(material.documentTitle || ''),
    importedAt: material.lms?.importedAt || null,
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

  // How GRASP identifies this Panopto site as the source of an imported video.
  const importSource = (sessionId) => ({
    provider: PANOPTO_PROVIDER,
    instance: config.host,
    ...(sessionId ? { externalFileId: sessionId } : {}),
  });

  const sendFailure = (error, res, next) => {
    if (!(error instanceof PanoptoError)) return next(error);
    console.warn(`[panopto] ${error.message}${error.code ? ` (${error.code})` : ''}`);
    return res.status(502).json({
      success: false,
      error: PANOPTO_FAILED_ERROR,
      panoptoStatus: error.status,
    });
  };

  const handle = (handler) => async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      sendFailure(error, res, next);
    }
  };

  const revokeQuietly = async (refreshToken) => {
    if (!refreshToken) return;
    try {
      await revokeToken(config, refreshToken);
    } catch (error) {
      console.warn(`[panopto] Could not revoke a Panopto refresh token: ${error.message}`);
    }
  };

  // Attaches req.panoptoToken, or answers that this user has not connected.
  const connected = async (req, res, next) => {
    try {
      const accessToken = await getAccessToken(config, tokenStore, userKey(req));
      if (!accessToken) {
        return res.status(409).json({
          success: false,
          connected: false,
          connectUrl: CONNECT_URL,
          error: 'Connect your Panopto account first.',
        });
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
    const returnTo = safeReturnTo(req.query.returnTo);
    if (returnTo) req.session.panoptoOAuthReturnTo = returnTo;
    else delete req.session.panoptoOAuthReturnTo;
    res.redirect(authorizeUrl(config, state));
  });

  // Panopto signs in whoever is signed in to Panopto in this browser, who need
  // not be this GRASP user (a shared computer, someone else's open session).
  // So the tokens are kept only when the Panopto account is this user's own
  // (services/panopto.js identityProblem); otherwise they are revoked and
  // nothing is stored, which leaves a connection already on file as it was.
  router.get('/auth/callback', async (req, res, next) => {
    const { code, state, error } = req.query;
    // Set by /auth/login, and single-use whatever happens next.
    const expectedState = req.session?.panoptoOAuthState;
    const returnTo = req.session?.panoptoOAuthReturnTo || settingsUrl('connected');
    if (req.session) {
      delete req.session.panoptoOAuthState;
      delete req.session.panoptoOAuthReturnTo;
    }

    // A denial (Cancel on Panopto's consent page) comes back as ?error=.
    if (error) return res.redirect(settingsUrl(CONNECT_RESULTS.ERROR));
    if (!expectedState || state !== expectedState) {
      return res.status(400).send('Invalid or expired Panopto sign-in state.');
    }
    if (typeof code !== 'string') {
      return res.status(400).send('Panopto did not return an authorization code.');
    }

    try {
      const key = userKey(req);
      const exchanged = await exchangeCode(config, code);

      let account = null;
      try {
        account = await getPanoptoAccount(config, exchanged.accessToken);
      } catch (accountError) {
        console.warn(`[panopto] Could not read the Panopto account for GRASP user ${key}: ${accountError.message}`);
      }
      const { problem, matchedOn } = account
        ? identityProblem(account, req.user)
        : { problem: CONNECT_RESULTS.IDENTITY_UNAVAILABLE, matchedOn: null };

      if (problem) {
        console.warn(
          `[panopto] GRASP user ${key} signed in as Panopto user ${account?.id || 'unknown'}, ` +
          `which could not be confirmed as theirs (${problem}); not connecting`
        );
        await revokeQuietly(exchanged.refreshToken);
        return res.redirect(settingsUrl(problem));
      }

      console.log(`[panopto] GRASP user ${key} connected Panopto user ${account.id} (matched on ${matchedOn})`);
      await tokenStore.set(key, exchanged);
      return res.redirect(returnTo);
    } catch (err) {
      if (err instanceof PanoptoError) {
        console.warn(`[panopto] Sign-in failed: ${err.message}${err.code ? ` (${err.code})` : ''}`);
        return res.redirect(settingsUrl(CONNECT_RESULTS.ERROR));
      }
      return next(err);
    }
  });

  // Removes this user's connection: revokes the refresh token at Panopto, then
  // forgets the tokens. A revocation failure does not keep the connection.
  router.post('/auth/disconnect', handle(async (req, res) => {
    const key = userKey(req);
    const tokens = await tokenStore.get(key);
    await revokeQuietly(tokens?.refreshToken);
    await tokenStore.delete(key);
    res.json({ success: true, connected: false });
  }));

  router.get('/status', handle(async (req, res) => {
    const accessToken = await getAccessToken(config, tokenStore, userKey(req));
    res.json({
      success: true,
      configured: true,
      connected: Boolean(accessToken),
      host: config.host,
      ...(accessToken ? {} : { connectUrl: CONNECT_URL }),
    });
  }));

  // The folders this user can add videos to, which are where their own
  // lectures live. Panopto decides what each user sees.
  router.get('/folders', connected, handle(async (req, res) => {
    const folders = await panoptoGetAllPages(config, req.panoptoToken, '/folders/creator', {
      sortField: 'Name',
      sortOrder: 'Asc',
    });
    res.json({ success: true, folders: folders.map(publicFolder) });
  }));

  // Importing a video's captions into Course Materials. Open to whoever may
  // upload materials to the course, with their own Panopto account.
  router.use('/courses/:courseId', requireActiveCourse());
  const materialsBase = '/courses/:courseId/materials';

  // A folder's videos, newest first, each marked when it is already a material
  // in this course.
  router.get(
    `${materialsBase}/folders/:folderId/sessions`,
    requireCourseMaterialsAccess,
    connected,
    handle(async (req, res) => {
      const { courseId, folderId } = req.params;
      if (!GUID.test(folderId)) {
        return res.status(400).json({ success: false, error: 'Invalid Panopto folder id.' });
      }
      const [sessions, imported] = await Promise.all([
        panoptoGetAllPages(config, req.panoptoToken, `/folders/${folderId}/sessions`, {
          sortField: 'CreatedDate',
          sortOrder: 'Desc',
        }),
        findLmsImportedMaterials(courseId, importSource()),
      ]);
      const importedBySession = new Map(
        imported.map((material) => [String(material.lms.externalFileId).toLowerCase(), material])
      );
      res.json({
        success: true,
        sessions: sessions.map((session) => {
          const summary = summarizeSession(session);
          return { ...summary, imported: publicImport(importedBySession.get(summary.id)) };
        }),
      });
    })
  );

  // Download one video's captions with the user's own Panopto sign-in, turn
  // them into plain text, and add that to Course Materials through the same
  // step as an uploaded text file.
  router.post(
    `${materialsBase}/sessions/:sessionId/import`,
    requireCourseMaterialsAccess,
    connected,
    async (req, res, next) => {
      const { courseId } = req.params;
      if (!GUID.test(req.params.sessionId)) {
        return res.status(400).json({ success: false, error: 'Invalid Panopto session id.' });
      }
      const sessionId = req.params.sessionId.toLowerCase();
      try {
        const [existing] = await findLmsImportedMaterials(courseId, importSource(sessionId));
        if (existing) return sendAlreadyImported(res, existing);

        const session = await panoptoGet(config, req.panoptoToken, `/sessions/${sessionId}`);
        const name = String(session?.Name || '').trim() || 'Panopto video';
        const captionUrl = session?.Urls?.CaptionDownloadUrl;
        const text = captionUrl
          ? captionsToText(await fetchCaptions(config, req.panoptoToken, captionUrl))
          : '';
        if (!text) {
          return res.status(400).json({ success: false, code: 'no-captions', error: NO_CAPTIONS_ERROR });
        }

        // Required here rather than at the top: it loads the parsers, the
        // vector store and the LLM client, which no other Panopto route needs.
        const { ingestMaterialFile } = require('../services/material-ingest');
        const buffer = Buffer.from(text, 'utf8');
        const material = await ingestMaterialFile({
          courseId,
          buffer,
          fileName: `${name}.txt`,
          mimeType: 'text/plain',
          size: buffer.length,
          documentTitle: name,
          lms: {
            ...importSource(sessionId),
            externalCourseId: String(session?.Folder || '').toLowerCase(),
            externalFileName: name,
            importedAt: new Date(),
          },
        });

        res.status(201).json({
          success: true,
          material: { sourceId: material.sourceId, documentTitle: material.documentTitle },
        });
      } catch (error) {
        if (error instanceof MaterialIngestError) {
          return res.status(400).json({ success: false, code: error.code, error: error.message });
        }
        // Two imports of the same video raced; the unique index kept one.
        if (error?.code === MONGO_DUPLICATE_KEY) return sendAlreadyImported(res, null);
        if (error instanceof PanoptoError) {
          if (error.code === 'too-large') {
            return res.status(400).json({ success: false, code: 'too-large', error: TOO_LARGE_ERROR });
          }
          // The video was found, but its caption page answered with an error
          // or a redirect: most likely it has no captions (yet). The status is
          // logged to learn what Panopto really sends.
          if (error.code === 'caption-download') {
            console.warn(`[panopto] ${error.message}; reporting no captions for session ${sessionId}`);
            return res.status(400).json({ success: false, code: 'no-captions', error: NO_CAPTIONS_ERROR });
          }
          // The video itself could not be read.
          if (error.status === 403 || error.status === 404) {
            console.warn(`[panopto] ${error.message}`);
            return res.status(404).json({ success: false, code: 'not-found', error: NOT_FOUND_ERROR });
          }
          return sendFailure(error, res, next);
        }
        console.error('Error importing Panopto captions as course material:', error);
        res.status(500).json({
          success: false,
          error: 'GRASP could not process these captions. Please try again.',
        });
      }
    }
  );

  function sendAlreadyImported(res, material) {
    return res.status(409).json({
      success: false,
      code: 'already-imported',
      error: ALREADY_IMPORTED_ERROR,
      ...(material ? { material: publicImport(material) } : {}),
    });
  }

  return router;
}

module.exports = { createPanoptoIntegration, createPanoptoRouter, safeReturnTo };
