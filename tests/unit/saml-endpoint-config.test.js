/**
 * passport-ubcshib hardcodes the LOCAL IdP endpoints to :8080 (see its
 * UBC_CONFIG), so a docker-simple-saml published on any other port used to be a
 * code change rather than a config change. These overrides keep the hardcoded
 * values as the default while letting a local IdP live wherever it is running.
 */

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn().mockReturnValue('-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----'),
}));
jest.mock('../../src/services/user', () => ({
  createOrUpdateUser: jest.fn(),
  getUserByPuid: jest.fn(),
  updateUserNames: jest.fn(),
}));
jest.mock('../../src/services/ubcApiService', () => ({ getPersonByPuid: jest.fn() }));
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));

const LOCAL_SSO = 'http://localhost:8080/simplesaml/saml2/idp/SSOService.php';
const LOCAL_SLO = 'http://localhost:8080/simplesaml/saml2/idp/SingleLogoutService.php';

const TLS_SSO = 'https://localhost:8443/simplesaml/saml2/idp/SSOService.php';
const TLS_SLO = 'https://localhost:8443/simplesaml/saml2/idp/SingleLogoutService.php';

/**
 * Build the strategy under a given environment. The module reads process.env at
 * require time, so each case needs a fresh module registry.
 */
function loadStrategy(overrides) {
  jest.resetModules();

  process.env.SAML_ENVIRONMENT = 'LOCAL';
  process.env.SAML_ISSUER = 'http://localhost:8070';
  process.env.SAML_CALLBACK_URL = 'http://localhost:8070/auth/saml/callback';
  process.env.SAML_PRIVATE_KEY_PATH = '/stub/key.pem';
  process.env.SAML_CERT_PATH = '/stub/cert.crt';
  delete process.env.SAML_ENTRY_POINT;
  delete process.env.SAML_LOGOUT_URL;
  Object.assign(process.env, overrides);

  return require('../../src/middleware/passport').strategy;
}

describe('SAML IdP endpoint configuration', () => {
  const savedEnv = { ...process.env };

  afterAll(() => {
    process.env = savedEnv;
  });

  it('falls back to the passport-ubcshib LOCAL endpoints when unset', () => {
    const strategy = loadStrategy({});

    expect(strategy._saml.options.entryPoint).toBe(LOCAL_SSO);
    expect(strategy._saml.options.logoutUrl).toBe(LOCAL_SLO);
  });

  it('sends login and logout to SAML_ENTRY_POINT and SAML_LOGOUT_URL when set', () => {
    const strategy = loadStrategy({ SAML_ENTRY_POINT: TLS_SSO, SAML_LOGOUT_URL: TLS_SLO });

    expect(strategy._saml.options.entryPoint).toBe(TLS_SSO);
    expect(strategy._saml.options.logoutUrl).toBe(TLS_SLO);
  });

  it('overrides login and logout independently', () => {
    const strategy = loadStrategy({ SAML_LOGOUT_URL: TLS_SLO });

    expect(strategy._saml.options.entryPoint).toBe(LOCAL_SSO);
    expect(strategy._saml.options.logoutUrl).toBe(TLS_SLO);
  });

  it('treats a blank override as unset rather than an empty endpoint', () => {
    const strategy = loadStrategy({ SAML_ENTRY_POINT: '', SAML_LOGOUT_URL: '   ' });

    expect(strategy._saml.options.entryPoint).toBe(LOCAL_SSO);
    expect(strategy._saml.options.logoutUrl).toBe(LOCAL_SLO);
  });
});
