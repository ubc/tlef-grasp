// GRASP's Panopto routes (src/routes/panopto.js): sign-in with the account
// check, disconnect, and importing a video's captions into Course Materials,
// with Panopto itself replaced by a fake fetch.

const express = require('express');
const request = require('supertest');

jest.mock('../../src/middleware/course-materials-access', () => ({
  requireCourseMaterialsAccess: jest.fn((_req, _res, next) => next()),
}));

jest.mock('../../src/middleware/course-archive', () => ({
  requireActiveCourse: () => (_req, _res, next) => next(),
}));

jest.mock('../../src/services/material', () => ({
  findLmsImportedMaterials: jest.fn(),
}));

jest.mock('../../src/services/material-ingest', () => ({
  ingestMaterialFile: jest.fn(),
}));

const { requireCourseMaterialsAccess } = require('../../src/middleware/course-materials-access');
const { findLmsImportedMaterials } = require('../../src/services/material');
const { ingestMaterialFile } = require('../../src/services/material-ingest');
const { MaterialIngestError } = require('../../src/utils/material-file-types');
const { createPanoptoRouter, safeReturnTo } = require('../../src/routes/panopto');

const USER_KEY = '507f1f77bcf86cd799439011';
const USER = { _id: USER_KEY, puid: 'ABC123XYZ456', email: 'Prof.Example@ubc.ca' };
const PANOPTO_USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SESSION_ID = '11111111-2222-3333-4444-555555555555';
const FOLDER_ID = '99999999-8888-7777-6666-555555555555';
const COURSE_ID = 'course-1';
const IMPORT_BASE = `/api/panopto/courses/${COURSE_ID}/materials`;
const CONFIG = {
  host: 'ubc.example.panopto.com',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'http://localhost:8070/api/panopto/auth/callback',
};
const CAPTION_URL = `https://${CONFIG.host}/Panopto/Pages/Transcription/GenerateSRT.ashx?id=${SESSION_ID}&language=0`;
const FUTURE = () => Date.now() + 3_600_000;

// An access token shaped like Panopto's: a JWT whose `sub` is the user id.
function accessToken(sub = PANOPTO_USER_ID) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256' })}.${encode({ sub, scope: ['api', 'offline_access'] })}.signature`;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function legacyLoginResponse() {
  const response = new Response(null, { status: 200 });
  response.headers.append('Set-Cookie', '.ASPXAUTH=abc; path=/; secure; HttpOnly');
  response.headers.append('Set-Cookie', 'csrfToken=xyz; path=/');
  return response;
}

function setup({ tokens = null, session = {}, user = USER } = {}) {
  const stored = new Map(tokens ? [[USER_KEY, tokens]] : []);
  const tokenStore = {
    stored,
    get: jest.fn(async (key) => stored.get(key) ?? null),
    set: jest.fn(async (key, value) => { stored.set(key, value); }),
    delete: jest.fn(async (key) => { stored.delete(key); }),
  };
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    req.session = session;
    next();
  });
  app.use('/api/panopto', createPanoptoRouter({ configured: true, config: CONFIG, tokenStore }));
  return { app, tokenStore, session };
}

const connectedSetup = () => setup({ tokens: { accessToken: accessToken(), refreshToken: 'refresh', expiresAt: FUTURE() } });

function callsTo(path) {
  return global.fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname === path);
}

describe('Panopto routes', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    findLmsImportedMaterials.mockResolvedValue([]);
    ingestMaterialFile.mockResolvedValue({ sourceId: 'source-1', documentTitle: 'Lecture 1' });
    requireCourseMaterialsAccess.mockImplementation((_req, _res, next) => next());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('answers 404 on every endpoint when not configured', async () => {
    const app = express();
    app.use('/api/panopto', createPanoptoRouter({ configured: false }));
    const res = await request(app).get('/api/panopto/auth/login');
    expect(res.status).toBe(404);
    expect(res.body.configured).toBe(false);
  });

  describe('sign-in', () => {
    it('sends the user to Panopto with a state it remembers', async () => {
      const { app, session } = setup();
      const res = await request(app).get('/api/panopto/auth/login');
      expect(res.status).toBe(302);
      const location = new URL(res.headers.location);
      expect(location.origin + location.pathname).toBe(
        `https://${CONFIG.host}/Panopto/oauth2/connect/authorize`
      );
      expect(location.searchParams.get('client_id')).toBe(CONFIG.clientId);
      expect(location.searchParams.get('response_type')).toBe('code');
      expect(location.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri);
      expect(location.searchParams.get('scope')).toBe('api offline_access');
      expect(location.searchParams.get('state')).toBe(session.panoptoOAuthState);
      expect(session.panoptoOAuthState).toHaveLength(64);
      expect(session.panoptoOAuthReturnTo).toBeUndefined();
    });

    it('remembers a return path on GRASP itself', async () => {
      const { app, session } = setup();
      await request(app).get('/api/panopto/auth/login').query({ returnTo: '/course-materials?panopto=import' });
      expect(session.panoptoOAuthReturnTo).toBe('/course-materials?panopto=import');
    });

    it.each(['https://evil.example/', '//evil.example/', '/\\evil.example', 'course-materials', '/a\nb'])(
      'ignores the return path %p',
      (value) => {
        expect(safeReturnTo(value)).toBeNull();
      }
    );

    it('refuses a callback whose state does not match, without calling Panopto', async () => {
      const { app, tokenStore, session } = setup({ session: { panoptoOAuthState: 'expected' } });
      const res = await request(app).get('/api/panopto/auth/callback?code=abc&state=other');
      expect(res.status).toBe(400);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(tokenStore.set).not.toHaveBeenCalled();
      expect(session.panoptoOAuthState).toBeUndefined();
    });

    it('returns to Settings when the user cancels at Panopto', async () => {
      const { app, tokenStore } = setup({ session: { panoptoOAuthState: 'expected' } });
      const res = await request(app).get('/api/panopto/auth/callback?error=access_denied&state=expected');
      expect(res.headers.location).toBe('/settings?panopto=error');
      expect(global.fetch).not.toHaveBeenCalled();
      expect(tokenStore.set).not.toHaveBeenCalled();
    });

    it('keeps the tokens of the user\'s own Panopto account, matched on email', async () => {
      const { app, tokenStore } = setup({
        session: { panoptoOAuthState: 'expected', panoptoOAuthReturnTo: '/course-materials?panopto=import' },
      });
      global.fetch
        .mockResolvedValueOnce(jsonResponse({ access_token: accessToken(), refresh_token: 'refresh', expires_in: 3600 }))
        .mockResolvedValueOnce(jsonResponse({ Id: PANOPTO_USER_ID, Username: 'pexample', Email: ' prof.example@UBC.ca ' }));

      const res = await request(app).get('/api/panopto/auth/callback?code=abc&state=expected');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/course-materials?panopto=import');
      const [tokenUrl, tokenInit] = global.fetch.mock.calls[0];
      expect(tokenUrl).toBe(`https://${CONFIG.host}/Panopto/oauth2/connect/token`);
      expect(tokenInit.headers.Authorization).toBe(
        `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`
      );
      const body = new URLSearchParams(tokenInit.body);
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('abc');
      expect(body.get('redirect_uri')).toBe(CONFIG.redirectUri);
      const [userUrl, userInit] = global.fetch.mock.calls[1];
      expect(String(userUrl)).toBe(`https://${CONFIG.host}/Panopto/api/v1/users/${PANOPTO_USER_ID}`);
      expect(userInit.headers.Authorization).toBe(`Bearer ${accessToken()}`);
      expect(tokenStore.stored.get(USER_KEY)).toMatchObject({ refreshToken: 'refresh' });
    });

    it('matches an identity-provider account on the PUID in its username', async () => {
      const { app, tokenStore } = setup({ session: { panoptoOAuthState: 'expected' } });
      global.fetch
        .mockResolvedValueOnce(jsonResponse({ access_token: accessToken(), refresh_token: 'refresh', expires_in: 3600 }))
        .mockResolvedValueOnce(jsonResponse({ Username: 'UBC Canvas\\abc123xyz456', Email: 'someone.else@example.com' }));

      const res = await request(app).get('/api/panopto/auth/callback?code=abc&state=expected');

      expect(res.headers.location).toBe('/settings?panopto=connected');
      expect(tokenStore.stored.has(USER_KEY)).toBe(true);
    });

    it('refuses someone else\'s Panopto account, revokes it and keeps the existing connection', async () => {
      const existing = { accessToken: 'mine', refreshToken: 'my-refresh', expiresAt: FUTURE() };
      const { app, tokenStore } = setup({ tokens: existing, session: { panoptoOAuthState: 'expected' } });
      global.fetch
        .mockResolvedValueOnce(jsonResponse({ access_token: accessToken(), refresh_token: 'their-refresh', expires_in: 3600 }))
        .mockResolvedValueOnce(jsonResponse({ Username: 'UBC Canvas\\OTHERPUID', Email: 'other@ubc.ca' }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));

      const res = await request(app).get('/api/panopto/auth/callback?code=abc&state=expected');

      expect(res.headers.location).toBe('/settings?panopto=account-mismatch');
      expect(tokenStore.set).not.toHaveBeenCalled();
      expect(tokenStore.stored.get(USER_KEY)).toBe(existing);
      const [revokeUrl, revokeInit] = global.fetch.mock.calls[2];
      expect(revokeUrl).toBe(`https://${CONFIG.host}/Panopto/oauth2/connect/revocation`);
      expect(revokeInit.method).toBe('POST');
      expect(revokeInit.headers.Authorization).toBe(
        `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`
      );
      expect(Object.fromEntries(new URLSearchParams(revokeInit.body))).toEqual({
        token: 'their-refresh',
        token_type_hint: 'refresh_token',
      });
    });

    it('refuses when the account cannot be read, even if the revocation fails too', async () => {
      const { app, tokenStore } = setup({ session: { panoptoOAuthState: 'expected' } });
      global.fetch
        .mockResolvedValueOnce(jsonResponse({ access_token: accessToken(), refresh_token: 'refresh', expires_in: 3600 }))
        .mockResolvedValueOnce(jsonResponse({}, 403))
        .mockResolvedValueOnce(jsonResponse({}, 500));

      const res = await request(app).get('/api/panopto/auth/callback?code=abc&state=expected');

      expect(res.headers.location).toBe('/settings?panopto=identity-unavailable');
      expect(tokenStore.set).not.toHaveBeenCalled();
    });

    it('refuses an access token that names no user, without asking Panopto who it is', async () => {
      const { app, tokenStore } = setup({ session: { panoptoOAuthState: 'expected' } });
      global.fetch
        .mockResolvedValueOnce(jsonResponse({ access_token: 'opaque', refresh_token: 'refresh', expires_in: 3600 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));

      const res = await request(app).get('/api/panopto/auth/callback?code=abc&state=expected');

      expect(res.headers.location).toBe('/settings?panopto=identity-unavailable');
      expect(callsTo(`/Panopto/oauth2/connect/revocation`)).toHaveLength(1);
      expect(tokenStore.set).not.toHaveBeenCalled();
    });

    it('cannot confirm a GRASP user with neither a PUID nor an email', async () => {
      const { app, tokenStore } = setup({
        user: { _id: USER_KEY },
        session: { panoptoOAuthState: 'expected' },
      });
      global.fetch
        .mockResolvedValueOnce(jsonResponse({ access_token: accessToken(), refresh_token: 'refresh', expires_in: 3600 }))
        .mockResolvedValueOnce(jsonResponse({ Username: 'pexample', Email: 'prof.example@ubc.ca' }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));

      const res = await request(app).get('/api/panopto/auth/callback?code=abc&state=expected');

      expect(res.headers.location).toBe('/settings?panopto=identity-unavailable');
      expect(tokenStore.set).not.toHaveBeenCalled();
    });

    it('returns to Settings when the code exchange fails, storing nothing', async () => {
      const { app, tokenStore } = setup({ session: { panoptoOAuthState: 'expected' } });
      global.fetch.mockResolvedValueOnce(jsonResponse({ error: 'invalid_client' }, 400));

      const res = await request(app).get('/api/panopto/auth/callback?code=abc&state=expected');

      expect(res.headers.location).toBe('/settings?panopto=error');
      expect(tokenStore.set).not.toHaveBeenCalled();
    });
  });

  describe('connection', () => {
    it('says so when the user has not connected', async () => {
      const { app } = setup();
      const status = await request(app).get('/api/panopto/status');
      expect(status.body).toMatchObject({
        configured: true,
        connected: false,
        host: CONFIG.host,
        connectUrl: '/api/panopto/auth/login',
      });
      const folders = await request(app).get('/api/panopto/folders');
      expect(folders.status).toBe(409);
      expect(folders.body.connected).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('refreshes an expired token and keeps the old refresh token if none is issued', async () => {
      const { app, tokenStore } = setup({
        tokens: { accessToken: 'old', refreshToken: 'keep-me', expiresAt: Date.now() - 1000 },
      });
      global.fetch.mockResolvedValueOnce(jsonResponse({ access_token: 'new', expires_in: 3600 }));

      const res = await request(app).get('/api/panopto/status');

      expect(res.body).toMatchObject({ connected: true });
      expect(new URLSearchParams(global.fetch.mock.calls[0][1].body).get('refresh_token')).toBe('keep-me');
      expect(tokenStore.stored.get(USER_KEY)).toMatchObject({ accessToken: 'new', refreshToken: 'keep-me' });
    });

    it('drops the connection when Panopto refuses the refresh token', async () => {
      const { app, tokenStore } = setup({
        tokens: { accessToken: 'old', refreshToken: 'dead', expiresAt: Date.now() - 1000 },
      });
      global.fetch.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 400));

      const res = await request(app).get('/api/panopto/status');

      expect(res.body.connected).toBe(false);
      expect(tokenStore.stored.has(USER_KEY)).toBe(false);
    });

    it('keeps the connection when Panopto is down during a refresh', async () => {
      const { app, tokenStore } = setup({
        tokens: { accessToken: 'old', refreshToken: 'fine', expiresAt: Date.now() - 1000 },
      });
      global.fetch.mockResolvedValueOnce(jsonResponse({}, 503));

      const res = await request(app).get('/api/panopto/status');

      expect(res.status).toBe(502);
      expect(tokenStore.stored.has(USER_KEY)).toBe(true);
    });

    it('disconnects: revokes the refresh token at Panopto and forgets the tokens', async () => {
      const { app, tokenStore } = connectedSetup();
      global.fetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

      const res = await request(app).post('/api/panopto/auth/disconnect');

      expect(res.body).toEqual({ success: true, connected: false });
      expect(tokenStore.stored.has(USER_KEY)).toBe(false);
      expect(new URLSearchParams(callsTo('/Panopto/oauth2/connect/revocation')[0][1].body).get('token')).toBe('refresh');
    });

    it('disconnects even when Panopto cannot revoke the token', async () => {
      const { app, tokenStore } = connectedSetup();
      global.fetch.mockResolvedValueOnce(jsonResponse({}, 503));

      const res = await request(app).post('/api/panopto/auth/disconnect');

      expect(res.status).toBe(200);
      expect(tokenStore.stored.has(USER_KEY)).toBe(false);
    });

    it('disconnects a user who was not connected without calling Panopto', async () => {
      const { app } = setup();
      const res = await request(app).post('/api/panopto/auth/disconnect');
      expect(res.status).toBe(200);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('browsing', () => {
    it('lists every page of the user\'s creator folders', async () => {
      const { app } = connectedSetup();
      global.fetch
        .mockResolvedValueOnce(jsonResponse({
          Results: [
            { Id: 'F1', Name: 'BIOL 101', ParentFolder: { Name: 'Biology' } },
            { Id: 'f2', Name: 'My Folder' },
          ],
        }))
        .mockResolvedValueOnce(jsonResponse({ Results: [{ Id: 'f3', Name: 'CHEM 123' }] }));

      const res = await request(app).get('/api/panopto/folders');

      expect(res.body.folders).toEqual([
        { id: 'f1', name: 'BIOL 101', parentName: 'Biology' },
        { id: 'f2', name: 'My Folder', parentName: '' },
        { id: 'f3', name: 'CHEM 123', parentName: '' },
      ]);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      const firstPage = new URL(String(global.fetch.mock.calls[0][0]));
      expect(firstPage.pathname).toBe('/Panopto/api/v1/folders/creator');
      expect(Object.fromEntries(firstPage.searchParams)).toEqual({ sortField: 'Name', sortOrder: 'Asc', pageNumber: '0' });
      expect(new URL(String(global.fetch.mock.calls[1][0])).searchParams.get('pageNumber')).toBe('1');
    });

    it('stops paging when Panopto repeats its first page', async () => {
      const { app } = connectedSetup();
      global.fetch.mockImplementation(async () => jsonResponse({ Results: [{ Id: 'f1', Name: 'Only' }] }));

      const res = await request(app).get('/api/panopto/folders');

      expect(res.body.folders).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('lists a folder\'s videos newest first, marking those already imported', async () => {
      const { app } = connectedSetup();
      findLmsImportedMaterials.mockResolvedValue([{
        sourceId: 'source-1',
        documentTitle: 'Lecture 1',
        lms: { externalFileId: SESSION_ID, importedAt: '2026-11-13T00:00:00.000Z' },
      }]);
      global.fetch
        .mockResolvedValueOnce(jsonResponse({
          Results: [
            {
              Id: SESSION_ID.toUpperCase(),
              Name: 'Lecture 1',
              StartTime: '2026-11-12T17:00:00Z',
              Duration: 3000,
              Urls: { ViewerUrl: 'https://x/view', CaptionDownloadUrl: CAPTION_URL },
            },
            { Id: 'other', Name: 'Scheduled lecture', Urls: {} },
          ],
        }))
        .mockResolvedValueOnce(jsonResponse({ Results: [] }));

      const res = await request(app).get(`${IMPORT_BASE}/folders/${FOLDER_ID}/sessions`);

      expect(res.body.sessions).toEqual([
        {
          id: SESSION_ID,
          name: 'Lecture 1',
          startTime: '2026-11-12T17:00:00Z',
          durationSeconds: 3000,
          viewerUrl: 'https://x/view',
          captions: true,
          imported: { sourceId: 'source-1', documentTitle: 'Lecture 1', importedAt: '2026-11-13T00:00:00.000Z' },
        },
        {
          id: 'other',
          name: 'Scheduled lecture',
          startTime: null,
          durationSeconds: null,
          viewerUrl: null,
          captions: false,
          imported: null,
        },
      ]);
      const listUrl = new URL(String(global.fetch.mock.calls[0][0]));
      expect(listUrl.pathname).toBe(`/Panopto/api/v1/folders/${FOLDER_ID}/sessions`);
      expect(listUrl.searchParams.get('sortField')).toBe('CreatedDate');
      expect(listUrl.searchParams.get('sortOrder')).toBe('Desc');
      expect(findLmsImportedMaterials).toHaveBeenCalledWith(COURSE_ID, {
        provider: 'panopto',
        instance: CONFIG.host,
      });
    });

    it('refuses a user without course-materials access before calling Panopto', async () => {
      requireCourseMaterialsAccess.mockImplementation((_req, res) =>
        res.status(403).json({ success: false, error: 'Staff access is not granted in this course' })
      );
      const { app } = connectedSetup();

      const list = await request(app).get(`${IMPORT_BASE}/folders/${FOLDER_ID}/sessions`);
      const imported = await request(app).post(`${IMPORT_BASE}/sessions/${SESSION_ID}/import`);

      expect(list.status).toBe(403);
      expect(imported.status).toBe(403);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(ingestMaterialFile).not.toHaveBeenCalled();
    });

    it.each([
      ['get', `${IMPORT_BASE}/folders/not-a-guid/sessions`],
      ['post', `${IMPORT_BASE}/sessions/not-a-guid/import`],
    ])('refuses a malformed id on %s %s', async (method, path) => {
      const { app } = connectedSetup();
      const res = await request(app)[method](path);
      expect(res.status).toBe(400);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('importing captions', () => {
    const SRT = [
      '1',
      '00:00:00,000 --> 00:00:04,000',
      '[Auto-generated transcript. Edits may have been applied for clarity.]',
      'Welcome back.',
      '',
      '2',
      '00:00:04,100 --> 00:00:06,000',
      'Today: carbon carbon bonds.',
      '',
    ].join('\n');

    function mockPanopto({ session, captions = SRT, captionStatus = 200, captionHeaders = {} } = {}) {
      global.fetch
        .mockResolvedValueOnce(jsonResponse(session ?? {
          Id: SESSION_ID,
          Name: ' Lecture 1 ',
          Folder: FOLDER_ID.toUpperCase(),
          Urls: { CaptionDownloadUrl: CAPTION_URL },
        }))
        .mockResolvedValueOnce(legacyLoginResponse())
        .mockResolvedValueOnce(new Response(captions, { status: captionStatus, headers: captionHeaders }));
    }

    it('adds the captions as plain text through the shared ingest step', async () => {
      const { app } = connectedSetup();
      mockPanopto();

      const res = await request(app).post(`${IMPORT_BASE}/sessions/${SESSION_ID.toUpperCase()}/import`);

      expect(res.status).toBe(201);
      expect(res.body.material).toEqual({ sourceId: 'source-1', documentTitle: 'Lecture 1' });
      expect(findLmsImportedMaterials).toHaveBeenCalledWith(COURSE_ID, {
        provider: 'panopto',
        instance: CONFIG.host,
        externalFileId: SESSION_ID,
      });
      const [legacyUrl, legacyInit] = global.fetch.mock.calls[1];
      expect(legacyUrl).toBe(`https://${CONFIG.host}/Panopto/api/v1/auth/legacyLogin`);
      expect(legacyInit.headers.Authorization).toBe(`Bearer ${accessToken()}`);
      const [captionUrl, captionInit] = global.fetch.mock.calls[2];
      expect(String(captionUrl)).toBe(CAPTION_URL);
      expect(captionInit.headers).toEqual({ Cookie: '.ASPXAUTH=abc; csrfToken=xyz' });
      expect(captionInit.redirect).toBe('manual');

      const ingested = ingestMaterialFile.mock.calls[0][0];
      expect(ingested.buffer.toString('utf8')).toBe('Welcome back. Today: carbon carbon bonds.');
      expect(ingested).toMatchObject({
        courseId: COURSE_ID,
        fileName: 'Lecture 1.txt',
        mimeType: 'text/plain',
        size: ingested.buffer.length,
        documentTitle: 'Lecture 1',
        lms: {
          provider: 'panopto',
          instance: CONFIG.host,
          externalCourseId: FOLDER_ID,
          externalFileId: SESSION_ID,
          externalFileName: 'Lecture 1',
        },
      });
      expect(ingested.lms.importedAt).toBeInstanceOf(Date);
    });

    it('answers no-captions for a video Panopto offers no caption link for', async () => {
      const { app } = connectedSetup();
      global.fetch.mockResolvedValueOnce(jsonResponse({ Id: SESSION_ID, Name: 'Lecture 1', Urls: {} }));

      const res = await request(app).post(`${IMPORT_BASE}/sessions/${SESSION_ID}/import`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('no-captions');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(ingestMaterialFile).not.toHaveBeenCalled();
    });

    it('answers no-captions when the caption link returns an empty file', async () => {
      const { app } = connectedSetup();
      mockPanopto({ captions: '' });

      const res = await request(app).post(`${IMPORT_BASE}/sessions/${SESSION_ID}/import`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('no-captions');
      expect(ingestMaterialFile).not.toHaveBeenCalled();
    });

    it('does not import a video that is already a material, without calling Panopto', async () => {
      const { app } = connectedSetup();
      findLmsImportedMaterials.mockResolvedValue([{ sourceId: 'source-1', documentTitle: 'Lecture 1', lms: {} }]);

      const res = await request(app).post(`${IMPORT_BASE}/sessions/${SESSION_ID}/import`);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'already-imported', material: { sourceId: 'source-1' } });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('reports a race on the same video as already imported', async () => {
      const { app } = connectedSetup();
      mockPanopto();
      ingestMaterialFile.mockRejectedValue(Object.assign(new Error('E11000'), { code: 11000 }));

      const res = await request(app).post(`${IMPORT_BASE}/sessions/${SESSION_ID}/import`);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('already-imported');
    });

    it('passes on an ingest refusal', async () => {
      const { app } = connectedSetup();
      mockPanopto();
      ingestMaterialFile.mockRejectedValue(new MaterialIngestError('Could not extract content from file', 'empty-content'));

      const res = await request(app).post(`${IMPORT_BASE}/sessions/${SESSION_ID}/import`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('empty-content');
    });

    it('never sends the user\'s sign-in to a caption URL on another host', async () => {
      const { app } = connectedSetup();
      global.fetch.mockResolvedValueOnce(
        jsonResponse({ Name: 'Lecture 1', Urls: { CaptionDownloadUrl: 'https://evil.example/caps' } })
      );

      const res = await request(app).post(`${IMPORT_BASE}/sessions/${SESSION_ID}/import`);

      expect(res.status).toBe(502);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(ingestMaterialFile).not.toHaveBeenCalled();
    });

    it('treats a caption download that redirects as no captions, without following it', async () => {
      const { app } = connectedSetup();
      mockPanopto({
        captions: null,
        captionStatus: 302,
        captionHeaders: { Location: '/Panopto/Pages/Auth/Login.aspx?ReturnUrl=x' },
      });

      const res = await request(app).post(`${IMPORT_BASE}/sessions/${SESSION_ID}/import`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('no-captions');
      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(ingestMaterialFile).not.toHaveBeenCalled();
    });

    it('treats a caption file Panopto cannot find as no captions, not a missing video', async () => {
      const { app } = connectedSetup();
      mockPanopto({ captions: 'Not Found', captionStatus: 404 });

      const res = await request(app).post(`${IMPORT_BASE}/sessions/${SESSION_ID}/import`);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'no-captions', error: expect.stringContaining('no captions') });
      expect(ingestMaterialFile).not.toHaveBeenCalled();
    });

    it('reports a failed Panopto sign-in for the download as a Panopto failure, not missing captions', async () => {
      const { app } = connectedSetup();
      global.fetch
        .mockResolvedValueOnce(jsonResponse({ Name: 'Lecture 1', Urls: { CaptionDownloadUrl: CAPTION_URL } }))
        .mockResolvedValueOnce(jsonResponse({}, 500));

      const res = await request(app).post(`${IMPORT_BASE}/sessions/${SESSION_ID}/import`);

      expect(res.status).toBe(502);
      expect(res.body.code).toBeUndefined();
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('refuses a caption file over the size limit', async () => {
      const { app } = connectedSetup();
      mockPanopto({ captionHeaders: { 'Content-Length': String(6 * 1024 * 1024) } });

      const res = await request(app).post(`${IMPORT_BASE}/sessions/${SESSION_ID}/import`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('too-large');
    });

    it('says the video cannot be read when Panopto answers 404', async () => {
      const { app } = connectedSetup();
      global.fetch.mockResolvedValueOnce(jsonResponse({}, 404));

      const res = await request(app).post(`${IMPORT_BASE}/sessions/${SESSION_ID}/import`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not-found');
    });

    it('asks a user who is not connected to connect', async () => {
      const { app } = setup();

      const res = await request(app).post(`${IMPORT_BASE}/sessions/${SESSION_ID}/import`);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ connected: false, connectUrl: '/api/panopto/auth/login' });
    });
  });
});
