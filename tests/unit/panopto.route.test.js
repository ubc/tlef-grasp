// GRASP's Panopto sign-in and read-only API routes (src/routes/panopto.js), with
// Panopto itself replaced by a fake fetch.

const express = require('express');
const request = require('supertest');
const { createPanoptoRouter } = require('../../src/routes/panopto');

const USER_KEY = '507f1f77bcf86cd799439011';
const SESSION_ID = '11111111-2222-3333-4444-555555555555';
const CONFIG = {
  host: 'ubc.example.panopto.com',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'http://localhost:8070/api/panopto/auth/callback',
};
const FUTURE = () => Date.now() + 3_600_000;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup({ tokens = null, session = {} } = {}) {
  const stored = new Map(tokens ? [[USER_KEY, tokens]] : []);
  const tokenStore = {
    stored,
    get: jest.fn(async (key) => stored.get(key) ?? null),
    set: jest.fn(async (key, value) => { stored.set(key, value); }),
    delete: jest.fn(async (key) => { stored.delete(key); }),
  };
  const app = express();
  app.use((req, _res, next) => {
    req.user = { _id: USER_KEY };
    req.session = session;
    next();
  });
  app.use('/api/panopto', createPanoptoRouter({ configured: true, config: CONFIG, tokenStore }));
  return { app, tokenStore, session };
}

describe('Panopto routes', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('answers 404 on every endpoint when not configured', async () => {
    const app = express();
    app.use('/api/panopto', createPanoptoRouter({ configured: false }));
    const res = await request(app).get('/api/panopto/auth/login');
    expect(res.status).toBe(404);
    expect(res.body.configured).toBe(false);
  });

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
  });

  it('refuses a callback whose state does not match, without calling Panopto', async () => {
    const { app, tokenStore, session } = setup({ session: { panoptoOAuthState: 'expected' } });
    const res = await request(app).get('/api/panopto/auth/callback?code=abc&state=other');
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tokenStore.set).not.toHaveBeenCalled();
    expect(session.panoptoOAuthState).toBeUndefined();
  });

  it('exchanges the code using the client credentials and keeps the tokens', async () => {
    const { app, tokenStore } = setup({ session: { panoptoOAuthState: 'expected' } });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 })
    );

    const res = await request(app).get('/api/panopto/auth/callback?code=abc&state=expected');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/api/panopto/status');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://${CONFIG.host}/Panopto/oauth2/connect/token`);
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`
    );
    const body = new URLSearchParams(init.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('abc');
    expect(body.get('redirect_uri')).toBe(CONFIG.redirectUri);
    expect(tokenStore.stored.get(USER_KEY)).toMatchObject({ accessToken: 'access', refreshToken: 'refresh' });
  });

  it('reports a failed exchange without storing anything or echoing the secret', async () => {
    const { app, tokenStore } = setup({ session: { panoptoOAuthState: 'expected' } });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_client' }, 400));

    const res = await request(app).get('/api/panopto/auth/callback?code=abc&state=expected');

    expect(res.status).toBe(502);
    expect(res.body.panoptoError).toBe('invalid_client');
    expect(JSON.stringify(res.body)).not.toContain(CONFIG.clientSecret);
    expect(tokenStore.set).not.toHaveBeenCalled();
  });

  it('says so when the user has not connected', async () => {
    const { app } = setup();
    const status = await request(app).get('/api/panopto/status');
    expect(status.body).toMatchObject({ connected: false, connectUrl: '/api/panopto/auth/login' });
    const sessions = await request(app).get('/api/panopto/sessions?q=biology');
    expect(sessions.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes an expired token and keeps the old refresh token if none is issued', async () => {
    const { app, tokenStore } = setup({
      tokens: { accessToken: 'old', refreshToken: 'keep-me', expiresAt: Date.now() - 1000 },
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'new', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ Results: [{ Id: 'f1', Name: 'BIOL 101' }] }));

    const res = await request(app).get('/api/panopto/status');

    expect(res.body).toMatchObject({ connected: true, folders: [{ id: 'f1', name: 'BIOL 101' }] });
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get('refresh_token')).toBe('keep-me');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer new');
    expect(tokenStore.stored.get(USER_KEY)).toMatchObject({ accessToken: 'new', refreshToken: 'keep-me' });
  });

  it('drops the connection when Panopto refuses the refresh token', async () => {
    const { app, tokenStore } = setup({
      tokens: { accessToken: 'old', refreshToken: 'dead', expiresAt: Date.now() - 1000 },
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 400));

    const res = await request(app).get('/api/panopto/status');

    expect(res.body.connected).toBe(false);
    expect(tokenStore.stored.has(USER_KEY)).toBe(false);
  });

  it('keeps the connection when Panopto is down during a refresh', async () => {
    const { app, tokenStore } = setup({
      tokens: { accessToken: 'old', refreshToken: 'fine', expiresAt: Date.now() - 1000 },
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));

    const res = await request(app).get('/api/panopto/status');

    expect(res.status).toBe(502);
    expect(tokenStore.stored.has(USER_KEY)).toBe(true);
  });

  it('searches sessions and summarizes them', async () => {
    const { app } = setup({ tokens: { accessToken: 'token', expiresAt: FUTURE() } });
    fetchMock.mockResolvedValueOnce(jsonResponse({
      Results: [{
        Id: SESSION_ID,
        Name: 'Lecture 1',
        Duration: 60,
        Urls: { ViewerUrl: 'https://x/view', CaptionDownloadUrl: 'https://x/caps' },
      }],
    }));

    const res = await request(app).get('/api/panopto/sessions').query({ q: 'cell biology' });

    expect(res.body.sessions).toEqual([{
      id: SESSION_ID,
      name: 'Lecture 1',
      durationSeconds: 60,
      viewerUrl: 'https://x/view',
      hasCaptions: true,
    }]);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `https://${CONFIG.host}/Panopto/api/v1/sessions/search?searchQuery=cell+biology`
    );
  });

  it('previews captions from the configured host', async () => {
    const { app } = setup({ tokens: { accessToken: 'token', expiresAt: FUTURE() } });
    const captionUrl = `https://${CONFIG.host}/Panopto/Pages/Transcription/GenerateSRT.ashx?id=${SESSION_ID}`;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ Name: 'Lecture 1', Urls: { CaptionDownloadUrl: captionUrl } }))
      .mockResolvedValueOnce(new Response('1\n00:00:01 --> 00:00:02\nHello', {
        headers: { 'Content-Type': 'text/plain' },
      }));

    const res = await request(app).get(`/api/panopto/sessions/${SESSION_ID}/captions`);

    expect(res.body).toMatchObject({ hasCaptions: true, contentType: 'text/plain', characters: 29 });
    expect(res.body.preview).toContain('Hello');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer token');
  });

  it('never sends the token to a caption URL on another host', async () => {
    const { app } = setup({ tokens: { accessToken: 'token', expiresAt: FUTURE() } });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ Name: 'Lecture 1', Urls: { CaptionDownloadUrl: 'https://evil.example/caps' } })
    );

    const res = await request(app).get(`/api/panopto/sessions/${SESSION_ID}/captions`);

    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['/sessions/not-a-guid/captions', '/folders/not-a-guid/sessions'])(
    'refuses a malformed id on %s',
    async (path) => {
      const { app } = setup({ tokens: { accessToken: 'token', expiresAt: FUTURE() } });
      const res = await request(app).get(`/api/panopto${path}`);
      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );
});
