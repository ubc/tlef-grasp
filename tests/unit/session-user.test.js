// The session keeps only the user's id and the SAML logout fields; req.user
// is loaded from the database on every request.
jest.mock('../../src/services/user', () => ({
  getUserById: jest.fn(),
}));

const { ObjectId } = require('mongodb');
const { getUserById } = require('../../src/services/user');
const {
  serializeSessionUser,
  deserializeSessionUser,
} = require('../../src/middleware/session-user');

const USER_OID = new ObjectId('507f1f77bcf86cd799439011');
const USER_ID = USER_OID.toString();

const SAML = {
  nameID: 'saml-name-id',
  nameIDFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
  nameIDNameQualifier: 'idp-qualifier',
  nameIDSPNameQualifier: 'sp-qualifier',
};

const loggedInUser = () => ({
  _id: USER_OID,
  puid: 'PUID0001',
  email: 'ada@example.ubc.ca',
  displayName: 'Ada',
  legalName: 'Ada Lovelace',
  affiliation: ['student'],
  lmsAccounts: [{ provider: 'canvas', instance: 'https://canvas.test', externalUserId: '7' }],
  role: 'student',
  ...SAML,
});

const dbUser = (extra = {}) => ({
  _id: USER_OID,
  puid: 'PUID0001',
  email: 'ada@example.ubc.ca',
  displayName: 'Ada',
  legalName: 'Ada Lovelace',
  affiliation: ['student', 'staff'],
  staffViaTaPromotion: true,
  ...extra,
});

describe('serializeSessionUser', () => {
  it('keeps only the id and the SAML logout fields', () => {
    expect(serializeSessionUser(loggedInUser())).toEqual({ id: USER_ID, ...SAML });
  });

  it('leaves out SAML fields the IdP did not send', () => {
    const user = loggedInUser();
    delete user.nameIDNameQualifier;
    delete user.nameIDSPNameQualifier;

    expect(serializeSessionUser(user)).toEqual({
      id: USER_ID,
      nameID: SAML.nameID,
      nameIDFormat: SAML.nameIDFormat,
    });
  });

  it('refuses a user without an id', () => {
    expect(() => serializeSessionUser({ email: 'x@example.ubc.ca' })).toThrow(/without an id/);
  });
});

describe('deserializeSessionUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads the current user document and carries the SAML logout fields over', async () => {
    getUserById.mockResolvedValue(dbUser());

    const user = await deserializeSessionUser({ id: USER_ID, ...SAML });

    expect(getUserById).toHaveBeenCalledWith(USER_ID);
    expect(user).toEqual({ ...dbUser(), _id: USER_ID, id: USER_ID, ...SAML });
  });

  it('reflects a change made since sign-in, such as a TA promotion', async () => {
    getUserById.mockResolvedValue(dbUser({ affiliation: ['student', 'staff'] }));

    const user = await deserializeSessionUser({ id: USER_ID });

    expect(user.affiliation).toEqual(['student', 'staff']);
  });

  it('reads a session written before only the id was stored, by its id', async () => {
    getUserById.mockResolvedValue(dbUser({ displayName: 'Ada (renamed)' }));
    const oldSession = { ...loggedInUser(), _id: USER_ID, id: USER_ID, displayName: 'Ada' };

    const user = await deserializeSessionUser(oldSession);

    expect(getUserById).toHaveBeenCalledWith(USER_ID);
    expect(user.displayName).toBe('Ada (renamed)');
    expect(user.nameID).toBe(SAML.nameID);
  });

  it('accepts an old session that has only _id', async () => {
    getUserById.mockResolvedValue(dbUser());

    await deserializeSessionUser({ _id: USER_ID, email: 'ada@example.ubc.ca' });

    expect(getUserById).toHaveBeenCalledWith(USER_ID);
  });

  it('signs the request out when the user no longer exists', async () => {
    getUserById.mockResolvedValue(null);

    await expect(deserializeSessionUser({ id: USER_ID })).resolves.toBe(false);
  });

  it('signs the request out when the session has no id', async () => {
    await expect(deserializeSessionUser({})).resolves.toBe(false);
    expect(getUserById).not.toHaveBeenCalled();
  });

  it('passes a database failure on rather than signing the user out', async () => {
    getUserById.mockRejectedValue(new Error('db down'));

    await expect(deserializeSessionUser({ id: USER_ID })).rejects.toThrow('db down');
  });
});
