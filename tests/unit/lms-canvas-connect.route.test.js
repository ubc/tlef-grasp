// GRASP's Canvas OAuth callback (src/controllers/lms-canvas-connect.js): the
// tokens of a Canvas authorization are kept only when the Canvas account's own
// integration_id (at UBC, the PUID) is the signed-in GRASP user's PUID.
// Anything else revokes them at Canvas and stores nothing.

const express = require('express');
const request = require('supertest');
const { createCanvasOAuthCallback } = require('../../src/controllers/lms-canvas-connect');

class FakeCanvasOAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CanvasOAuthError';
  }
}

class FakeCanvasApiError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

const USER = { _id: '507f1f77bcf86cd799439011', puid: 'PUID-PROF-1' };
const STATE = 'state-123';
const RETURN_TO = '/settings?canvas=connected';
const EXCHANGED = {
  accessToken: 'new-access',
  refreshToken: 'new-refresh',
  expiresAt: 1_900_000_000_000,
  canvasUserId: '42',
};

function memoryTokenStore(initial = {}) {
  const tokens = new Map(Object.entries(initial));
  return {
    tokens,
    get: jest.fn(async (key) => tokens.get(key) ?? null),
    set: jest.fn(async (key, value) => { tokens.set(key, value); }),
    delete: jest.fn(async (key) => { tokens.delete(key); }),
  };
}

function setup({ profile = { id: 42, integration_id: USER.puid }, user = USER, storedTokens = {} } = {}) {
  const profileGet = jest.fn(async () => {
    if (profile instanceof Error) throw profile;
    return profile;
  });
  const canvas = {
    CanvasOAuthError: FakeCanvasOAuthError,
    exchangeCodeForTokens: jest.fn(async () => ({ ...EXCHANGED })),
    createApiClient: jest.fn(() => ({ get: profileGet })),
    revokeToken: jest.fn(async () => {}),
  };
  const tokenStore = memoryTokenStore(storedTokens);
  const config = {
    canvasDomain: 'https://canvas.example.test',
    tokenStore,
    getUserKey: (req) => String(req.user._id),
  };
  const session = { canvasOAuthState: STATE, canvasOAuthReturnTo: RETURN_TO };

  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    req.session = session;
    next();
  });
  app.get('/api/lms/canvas/auth/callback', createCanvasOAuthCallback(canvas, config));
  app.use((error, _req, res, _next) => {
    res.status(500).json({ name: error.name, message: error.message });
  });

  const callback = (query = { code: 'auth-code', state: STATE }) =>
    request(app).get('/api/lms/canvas/auth/callback').query(query);

  return { callback, canvas, config, tokenStore, session, profileGet };
}

describe('Canvas OAuth callback', () => {
  let warn;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('when the Canvas account is the signed-in user\'s', () => {
    it('keeps the tokens and returns to where the connect started', async () => {
      const { callback, canvas, config, tokenStore, session, profileGet } = setup();

      const response = await callback();

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(RETURN_TO);
      expect(canvas.exchangeCodeForTokens).toHaveBeenCalledWith(config, 'auth-code');
      // The profile is read with the token just issued, not one on file.
      expect(canvas.createApiClient).toHaveBeenCalledWith({
        canvasDomain: 'https://canvas.example.test',
        accessToken: 'new-access',
      });
      expect(profileGet).toHaveBeenCalledWith('/users/self/profile');
      expect(tokenStore.tokens.get(USER._id)).toEqual({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: 1_900_000_000_000,
        canvasUserId: '42',
      });
      expect(canvas.revokeToken).not.toHaveBeenCalled();
      expect(session).toEqual({});
    });

    it('compares the PUID the way roster sync does, ignoring case and spaces', async () => {
      const { callback, tokenStore } = setup({ profile: { id: 42, integration_id: ' puid-prof-1 ' } });

      const response = await callback();

      expect(response.headers.location).toBe(RETURN_TO);
      expect(tokenStore.tokens.has(USER._id)).toBe(true);
    });

    it('keeps the refresh token on file when Canvas issues none for the same account', async () => {
      const { callback, canvas, tokenStore } = setup({
        storedTokens: { [USER._id]: { refreshToken: 'old-refresh', canvasUserId: '42' } },
      });
      canvas.exchangeCodeForTokens.mockResolvedValue({ ...EXCHANGED, refreshToken: undefined });

      const response = await callback();

      expect(response.headers.location).toBe(RETURN_TO);
      expect(tokenStore.tokens.get(USER._id).refreshToken).toBe('old-refresh');
    });

    it('never pairs the new token with another Canvas account\'s refresh token', async () => {
      const { callback, canvas, tokenStore } = setup({
        storedTokens: { [USER._id]: { accessToken: 'old', refreshToken: 'other-refresh', canvasUserId: '7' } },
      });
      canvas.exchangeCodeForTokens.mockResolvedValue({ ...EXCHANGED, refreshToken: undefined });

      const response = await callback();

      expect(response.status).toBe(500);
      expect(response.body.name).toBe('CanvasOAuthError');
      expect(tokenStore.set).not.toHaveBeenCalled();
      expect(tokenStore.tokens.get(USER._id).refreshToken).toBe('other-refresh');
    });
  });

  describe('when the Canvas account is not the signed-in user\'s', () => {
    it('revokes the tokens, stores nothing and says why', async () => {
      const { callback, canvas, config, tokenStore } = setup({
        profile: { id: 42, integration_id: 'PUID-SOMEONE-ELSE' },
      });

      const response = await callback();

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/settings?canvas=account-mismatch');
      expect(canvas.revokeToken).toHaveBeenCalledWith(config, 'new-access');
      expect(tokenStore.set).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('whose integration_id is not their PUID'));
      // The log names the accounts by id only, never the PUIDs compared.
      expect(warn.mock.calls.flat().join(' ')).not.toMatch(/PUID-SOMEONE-ELSE|PUID-PROF-1/);
    });

    it('leaves an existing connection as it was', async () => {
      const existing = { accessToken: 'mine', refreshToken: 'mine-refresh', expiresAt: 1, canvasUserId: '9' };
      const { callback, tokenStore } = setup({
        profile: { id: 42, integration_id: 'PUID-SOMEONE-ELSE' },
        storedTokens: { [USER._id]: existing },
      });

      await callback();

      expect(tokenStore.tokens.get(USER._id)).toEqual(existing);
      expect(tokenStore.delete).not.toHaveBeenCalled();
    });

    it('still refuses when revoking at Canvas fails', async () => {
      const { callback, canvas, tokenStore } = setup({
        profile: { id: 42, integration_id: 'PUID-SOMEONE-ELSE' },
      });
      canvas.revokeToken.mockRejectedValue(new FakeCanvasOAuthError('revoke failed'));

      const response = await callback();

      expect(response.headers.location).toBe('/settings?canvas=account-mismatch');
      expect(tokenStore.set).not.toHaveBeenCalled();
    });
  });

  describe('when GRASP cannot tell whose account it is', () => {
    it.each([
      ['the Canvas account has no integration_id', { profile: { id: 42, integration_id: null } }],
      ['the profile omits integration_id', { profile: { id: 42 } }],
      [
        'Canvas refuses the profile read (a key or CANVAS_SCOPES without the scope)',
        { profile: new FakeCanvasApiError('Canvas API request to /api/v1/users/self/profile returned 401', 401) },
      ],
      ['the GRASP user has no PUID', { user: { _id: USER._id } }],
    ])('refuses when %s', async (_label, options) => {
      const { callback, canvas, config, tokenStore } = setup(options);

      const response = await callback();

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/settings?canvas=identity-unavailable');
      expect(canvas.revokeToken).toHaveBeenCalledWith(config, 'new-access');
      expect(tokenStore.set).not.toHaveBeenCalled();
    });
  });

  describe('before any token exchange', () => {
    it('returns a Canvas denial (?error=) to Settings and clears the OAuth state', async () => {
      const { callback, canvas, session } = setup();

      const response = await callback({ error: 'access_denied', state: STATE });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/settings?canvas=error');
      expect(canvas.exchangeCodeForTokens).not.toHaveBeenCalled();
      expect(session).toEqual({});
    });

    it.each([
      ['a wrong state', { code: 'auth-code', state: 'forged' }],
      ['no state', { code: 'auth-code' }],
    ])('refuses %s', async (_label, query) => {
      const { callback, canvas, tokenStore, session } = setup();

      const response = await callback(query);

      expect(response.status).toBe(400);
      expect(response.text).toBe('Invalid or expired Canvas OAuth state.');
      expect(canvas.exchangeCodeForTokens).not.toHaveBeenCalled();
      expect(tokenStore.set).not.toHaveBeenCalled();
      // A state is good for one callback only.
      expect(session).toEqual({});
    });

    it('refuses a callback without a code', async () => {
      const { callback, canvas } = setup();

      const response = await callback({ state: STATE });

      expect(response.status).toBe(400);
      expect(canvas.exchangeCodeForTokens).not.toHaveBeenCalled();
    });
  });
});
