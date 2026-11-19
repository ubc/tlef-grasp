// The Panopto account check (services/panopto.js identityProblem) and reading
// the user id from an access token.

const { identityProblem, panoptoUserIdFromToken } = require('../../src/services/panopto');

const USER = { puid: 'ABC123XYZ456', email: 'prof.example@ubc.ca' };
const PANOPTO_USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('identityProblem', () => {
  it.each([
    ['the PUID as the username of an identity-provider account', { username: 'UBC\\abc123xyz456', email: '' }, 'puid'],
    ['a bare username equal to the PUID', { username: 'ABC123XYZ456', email: '' }, 'puid'],
    ['the CWL email in another case', { username: 'pexample', email: ' Prof.Example@UBC.CA' }, 'email'],
  ])('accepts %s', (_label, account, matchedOn) => {
    expect(identityProblem(account, USER)).toEqual({ problem: null, matchedOn });
  });

  it('refuses another person\'s account', () => {
    expect(identityProblem({ username: 'UBC\\OTHER', email: 'other@ubc.ca' }, USER)).toEqual({
      problem: 'account-mismatch',
      matchedOn: null,
    });
  });

  it('does not match a PUID inside a longer key', () => {
    expect(identityProblem({ username: 'UBC\\XABC123XYZ456', email: '' }, USER).problem).toBe('account-mismatch');
  });

  it('cannot confirm anyone when the GRASP user has neither a PUID nor an email', () => {
    expect(identityProblem({ username: 'pexample', email: 'prof.example@ubc.ca' }, {}).problem).toBe(
      'identity-unavailable'
    );
  });

  it('cannot confirm an account with neither a username nor an email', () => {
    expect(identityProblem({ username: '', email: '' }, USER).problem).toBe('identity-unavailable');
  });

  it('never matches two blank emails', () => {
    expect(identityProblem({ username: 'pexample', email: '' }, { puid: 'X', email: '' }).problem).toBe(
      'account-mismatch'
    );
  });
});

describe('panoptoUserIdFromToken', () => {
  const token = (payload) =>
    `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;

  it('reads the sub claim', () => {
    expect(panoptoUserIdFromToken(token({ sub: PANOPTO_USER_ID }))).toBe(PANOPTO_USER_ID);
  });

  it.each([
    ['an opaque token', 'opaque'],
    ['a sub that is not a Panopto id', token({ sub: '../users/other' })],
    ['a payload that is not JSON', 'header.bm90IGpzb24.signature'],
    ['no token', undefined],
  ])('returns null for %s', (_label, value) => {
    expect(panoptoUserIdFromToken(value)).toBeNull();
  });
});
