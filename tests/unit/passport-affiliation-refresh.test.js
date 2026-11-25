// SAML login refreshes a returning user's stored affiliation, and the role for
// the session is derived from the refreshed value, not the stale stored one.
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn().mockReturnValue('-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----'),
}));
jest.mock('../../src/services/user', () => ({
  createOrUpdateUser: jest.fn(),
  getUserByPuid: jest.fn(),
  updateUserNames: jest.fn(),
  backfillUserEmail: jest.fn(),
  refreshLoginAffiliation: jest.fn(),
}));
jest.mock('../../src/services/ubcApiService', () => ({ getPersonByPuid: jest.fn() }));
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/utils/auth', () => ({
  ...jest.requireActual('../../src/utils/auth'),
  getUserRole: jest.fn(),
}));

const userService = require('../../src/services/user');
const { getUserRole } = require('../../src/utils/auth');

function profile(extra = {}) {
  return {
    nameID: 'ann-name-id',
    ubcEduCwlPuid: 'PUID1',
    mail: 'ann@ubc.ca',
    eduPersonAffiliation: ['student'],
    ...extra,
  };
}

// Names and email complete, so login needs no Academic API lookup or backfill.
function storedUser(extra = {}) {
  return {
    _id: 'user-1',
    puid: 'PUID1',
    email: 'ann@ubc.ca',
    displayName: 'Ann',
    legalName: 'Ann Faculty',
    affiliation: ['faculty'],
    ...extra,
  };
}

describe('SAML login affiliation refresh', () => {
  let strategy;

  beforeAll(() => {
    process.env.SAML_ISSUER = 'https://grasp.example.ubc.ca';
    process.env.SAML_CALLBACK_URL = 'https://grasp.example.ubc.ca/Shibboleth.sso/SAML2/POST';
    process.env.SAML_PRIVATE_KEY_PATH = '/stub/key.pem';
    process.env.SAML_CERT_PATH = '/stub/cert.crt';
    ({ strategy } = require('../../src/middleware/passport'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    getUserRole.mockResolvedValue('student');
  });

  function login(samlProfile = profile()) {
    return new Promise((resolve) => {
      strategy._signonVerify(samlProfile, (error, user) => resolve({ error, user }));
    });
  }

  it('refreshes a returning user and derives the role from the new value', async () => {
    userService.getUserByPuid.mockResolvedValue(storedUser());
    userService.refreshLoginAffiliation.mockResolvedValue({ affiliation: ['student'] });

    const { error, user } = await login();

    expect(error).toBeNull();
    expect(userService.refreshLoginAffiliation).toHaveBeenCalledWith(
      expect.objectContaining({ puid: 'PUID1', affiliation: ['faculty'] }),
      ['student'],
    );
    expect(getUserRole).toHaveBeenCalledWith(expect.objectContaining({ affiliation: ['student'] }));
    expect(user.affiliation).toEqual(['student']);
  });

  it('keeps the stored user as-is when nothing changed', async () => {
    userService.getUserByPuid.mockResolvedValue(storedUser({ affiliation: ['student'] }));
    userService.refreshLoginAffiliation.mockResolvedValue(null);

    const { error, user } = await login();

    expect(error).toBeNull();
    expect(user.affiliation).toEqual(['student']);
  });

  it('does not refresh a user created by this login', async () => {
    userService.getUserByPuid
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(storedUser({ affiliation: ['student'] }));

    const { error } = await login();

    expect(error).toBeNull();
    expect(userService.createOrUpdateUser).toHaveBeenCalledWith(
      expect.objectContaining({ affiliation: ['student'] }),
    );
    expect(userService.refreshLoginAffiliation).not.toHaveBeenCalled();
  });

  it('fails the login rather than grant a stale role when the refresh fails', async () => {
    userService.getUserByPuid.mockResolvedValue(storedUser());
    userService.refreshLoginAffiliation.mockRejectedValue(new Error('db down'));

    const { error, user } = await login();

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/db down/);
    expect(user).toBeUndefined();
    expect(getUserRole).not.toHaveBeenCalled();
  });

  it('never reaches the refresh when SAML releases no valid affiliation', async () => {
    userService.getUserByPuid.mockResolvedValue(storedUser());

    const { error } = await login(profile({ eduPersonAffiliation: [] }));

    expect(error.message).toMatch(/Access denied/);
    expect(userService.refreshLoginAffiliation).not.toHaveBeenCalled();
  });
});
