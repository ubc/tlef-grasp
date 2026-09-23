// SAML login email backfill (issue #113). A roster-sync placeholder is created
// before the student ever signs in, so it may have no email; the first SAML
// login fills it in. An email that is already stored is never overwritten, and
// a failed backfill must never fail the login.
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn().mockReturnValue('-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----'),
}));
jest.mock('../../src/services/user', () => ({
  createOrUpdateUser: jest.fn(),
  getUserByPuid: jest.fn(),
  updateUserNames: jest.fn(),
  backfillUserEmail: jest.fn(),
}));
jest.mock('../../src/services/ubcApiService', () => ({ getPersonByPuid: jest.fn() }));
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/utils/auth', () => ({
  ...jest.requireActual('../../src/utils/auth'),
  getUserRole: jest.fn(),
}));

const userService = require('../../src/services/user');
const { getUserRole } = require('../../src/utils/auth');

const SAML_EMAIL = 'ann.student@student.ubc.ca';

function profile(extra = {}) {
  return {
    nameID: 'ann-name-id',
    ubcEduCwlPuid: 'PUID1',
    mail: SAML_EMAIL,
    eduPersonAffiliation: ['student'],
    ...extra,
  };
}

// An existing user whose names are complete, so login needs no Academic API
// lookup and the email is the only thing left to fill.
function storedUser(extra = {}) {
  return {
    _id: 'user-1',
    puid: 'PUID1',
    displayName: 'Ann',
    legalName: 'Ann Student',
    affiliation: ['student'],
    ...extra,
  };
}

describe('SAML login email backfill', () => {
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
    userService.backfillUserEmail.mockResolvedValue(true);
  });

  function login(samlProfile = profile()) {
    return new Promise((resolve) => {
      strategy._verify(samlProfile, (error, user) => resolve({ error, user }));
    });
  }

  it.each([
    ['missing', storedUser()],
    ['null', storedUser({ email: null })],
    ['empty', storedUser({ email: '' })],
  ])('fills an %s stored email from SAML', async (_label, user) => {
    userService.getUserByPuid.mockResolvedValue(user);

    const { error, user: sessionUser } = await login();

    expect(error).toBeNull();
    expect(userService.backfillUserEmail).toHaveBeenCalledWith('PUID1', SAML_EMAIL);
    expect(sessionUser.email).toBe(SAML_EMAIL);
  });

  it('never overwrites an email that is already stored', async () => {
    userService.getUserByPuid.mockResolvedValue(storedUser({ email: 'preferred@ubc.ca' }));

    const { error, user } = await login();

    expect(error).toBeNull();
    expect(userService.backfillUserEmail).not.toHaveBeenCalled();
    expect(user.email).toBe('preferred@ubc.ca');
  });

  it('still logs the user in when the backfill fails', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    userService.getUserByPuid.mockResolvedValue(storedUser());
    userService.backfillUserEmail.mockRejectedValue(new Error('db down'));

    const { error, user } = await login();

    expect(error).toBeNull();
    expect(user).toEqual(expect.objectContaining({ _id: 'user-1', role: 'student' }));
    console.warn.mockRestore();
  });

  it('does nothing when SAML released no email', async () => {
    userService.getUserByPuid.mockResolvedValue(storedUser());

    const { error } = await login(profile({ mail: undefined, nameID: undefined }));

    expect(error).toBeNull();
    expect(userService.backfillUserEmail).not.toHaveBeenCalled();
  });
});
