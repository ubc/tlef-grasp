// CSRF protection (src/middleware/cross-origin.js): a state-changing request a
// browser sends for a page on another origin is refused before any route runs.
// Sec-Fetch-Site decides when present; otherwise the Origin host must be the
// request's host; with neither header the request is let through, since no
// browser page sent it on someone's behalf.

const express = require('express');
const request = require('supertest');
const { createCrossOriginProtection } = require('../../src/middleware/cross-origin');

const SAML_PATHS = ['/Shibboleth.sso/SAML2/POST', '/auth/saml/callback'];

function buildApp({ trustProxy = false } = {}) {
  const app = express();
  if (trustProxy) app.set('trust proxy', 1);
  app.use(createCrossOriginProtection({ exemptPaths: SAML_PATHS }));
  app.all('/api/lms/canvas/auth/logout', (_req, res) => res.status(204).end());
  app.all('/auth/saml/callback', (_req, res) => res.redirect('/onboarding'));
  app.all('/Shibboleth.sso/SAML2/POST', (_req, res) => res.redirect('/onboarding'));
  app.all('/auth/other', (_req, res) => res.status(204).end());
  return app;
}

const DISCONNECT = '/api/lms/canvas/auth/logout';
const HOST = 'grasp.example.test';

describe('cross-origin protection', () => {
  let warn;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('lets a cross-site %s through', async (method) => {
    const response = await request(buildApp())[method.toLowerCase()](DISCONNECT)
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Origin', 'https://evil.example');

    expect(response.status).toBe(204);
  });

  describe('when the browser sends Sec-Fetch-Site', () => {
    it.each(['same-origin', 'none'])('lets %s writes through', async (fetchSite) => {
      const response = await request(buildApp()).post(DISCONNECT)
        .set('Host', HOST)
        .set('Sec-Fetch-Site', fetchSite);

      expect(response.status).toBe(204);
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('refuses a cross-site %s', async (method) => {
      const response = await request(buildApp())[method.toLowerCase()](DISCONNECT)
        .set('Host', HOST)
        .set('Sec-Fetch-Site', 'cross-site')
        .set('Origin', 'https://evil.example');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ success: false, error: 'Cross-origin request refused' });
    });

    it('refuses a same-site page, such as another *.ubc.ca site', async () => {
      const response = await request(buildApp()).post(DISCONNECT)
        .set('Host', HOST)
        .set('Sec-Fetch-Site', 'same-site')
        .set('Origin', 'https://other.example.test');

      expect(response.status).toBe(403);
    });

    it('goes by Sec-Fetch-Site even when Origin names this host', async () => {
      const response = await request(buildApp()).post(DISCONNECT)
        .set('Host', HOST)
        .set('Sec-Fetch-Site', 'cross-site')
        .set('Origin', `https://${HOST}`);

      expect(response.status).toBe(403);
    });

    it('logs what it refused', async () => {
      await request(buildApp()).post(DISCONNECT)
        .set('Sec-Fetch-Site', 'cross-site')
        .set('Origin', 'https://evil.example');

      expect(warn).toHaveBeenCalledWith(
        '[cross-origin] Refused POST /api/lms/canvas/auth/logout ' +
        '(Sec-Fetch-Site: cross-site, Origin: https://evil.example)'
      );
    });
  });

  describe('when the browser sends only Origin', () => {
    it('lets a request from this host through', async () => {
      const response = await request(buildApp()).post(DISCONNECT)
        .set('Host', HOST)
        .set('Origin', `https://${HOST}`);

      expect(response.status).toBe(204);
    });

    it('matches the host with its port', async () => {
      const ok = await request(buildApp()).post(DISCONNECT)
        .set('Host', 'localhost:8070')
        .set('Origin', 'http://localhost:8070');
      const otherPort = await request(buildApp()).post(DISCONNECT)
        .set('Host', 'localhost:8070')
        .set('Origin', 'http://localhost:8080');

      expect(ok.status).toBe(204);
      expect(otherPort.status).toBe(403);
    });

    it.each([
      ['another site', 'https://evil.example'],
      ['a lookalike host', `https://${HOST}.evil.example`],
      ['an opaque origin', 'null'],
      ['an unparseable value', 'not a url'],
    ])('refuses %s', async (_label, origin) => {
      const response = await request(buildApp()).post(DISCONNECT)
        .set('Host', HOST)
        .set('Origin', origin);

      expect(response.status).toBe(403);
    });

    it('accepts the forwarded host behind the proxy', async () => {
      const response = await request(buildApp({ trustProxy: true })).post(DISCONNECT)
        .set('Host', 'localhost:8070')
        .set('X-Forwarded-Host', HOST)
        .set('Origin', `https://${HOST}`);

      expect(response.status).toBe(204);
    });
  });

  it('lets a request with neither header through (not sent by a browser page)', async () => {
    const response = await request(buildApp()).post(DISCONNECT);

    expect(response.status).toBe(204);
  });

  describe('SAML endpoints', () => {
    it.each(SAML_PATHS)('take the IdP\'s cross-site POST to %s', async (samlPath) => {
      const response = await request(buildApp()).post(samlPath)
        .set('Host', HOST)
        .set('Sec-Fetch-Site', 'same-site')
        .set('Origin', 'https://authentication.example.test')
        .type('form')
        .send({ SAMLResponse: 'signed' });

      expect(response.status).toBe(302);
    });

    it('are matched the way Express routes them (case, trailing slash)', async () => {
      const response = await request(buildApp()).post('/AUTH/SAML/CALLBACK/')
        .set('Sec-Fetch-Site', 'cross-site')
        .set('Origin', 'https://authentication.example.test');

      expect(response.status).toBe(302);
    });

    it('do not exempt anything else under /auth', async () => {
      const response = await request(buildApp()).post('/auth/other')
        .set('Sec-Fetch-Site', 'cross-site')
        .set('Origin', 'https://evil.example');

      expect(response.status).toBe(403);
      expect(response.text).toBe('403: Cross-origin request refused');
    });
  });
});
