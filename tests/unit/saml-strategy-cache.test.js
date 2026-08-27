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

const { samlRequestCache } = require('../../src/services/samlRequestCache');

describe('ubcshib strategy request-ID cache', () => {
  let strategy;

  beforeAll(() => {
    process.env.SAML_ISSUER = 'https://grasp.example.ubc.ca';
    process.env.SAML_CALLBACK_URL = 'https://grasp.example.ubc.ca/Shibboleth.sso/SAML2/POST';
    process.env.SAML_PRIVATE_KEY_PATH = '/stub/key.pem';
    process.env.SAML_CERT_PATH = '/stub/cert.crt';
    ({ strategy } = require('../../src/middleware/passport'));
  });

  it('validates InResponseTo — the check that makes a shared cache necessary', () => {
    expect(strategy._saml.options.validateInResponseTo).toBe(true);
  });

  it('uses the shared MongoDB cache, not node-saml per-process memory', () => {
    expect(strategy._saml.cacheProvider).toBe(samlRequestCache);
  });

  it('stores request ids where another worker can read them back', async () => {
    const store = new Map();
    const collection = {
      insertOne: jest.fn(async (doc) => { store.set(doc._id, doc); }),
      findOne: jest.fn(async ({ _id }) => store.get(_id) || null),
      deleteOne: jest.fn(async ({ _id }) => ({ deletedCount: store.delete(_id) ? 1 : 0 })),
    };
    require('../../src/services/database').connect.mockResolvedValue({
      collection: () => collection,
    });

    // Worker A issues the AuthnRequest.
    await strategy._saml.cacheProvider.saveAsync('_worker_a_id', 'instant');
    // Worker B receives the IdP POST and looks the id up.
    await expect(strategy._saml.cacheProvider.getAsync('_worker_a_id')).resolves.toBe('instant');
  });

  it('binds assertions to this service provider via AudienceRestriction', () => {
    expect(strategy._saml.options.audience).toBe('https://grasp.example.ubc.ca');
  });
});
