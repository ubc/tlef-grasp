/**
 * What Passport keeps in the session for a signed-in user, and how req.user
 * is rebuilt from it.
 *
 * The session holds the user's id and the SAML fields single logout needs
 * (strategy.logout reads them off req.user), nothing else. The user document
 * is loaded on every request, so the session store never holds a copy of
 * names, email, PUID or LMS accounts, and a role, affiliation or profile
 * change applies on the user's next request instead of their next login.
 */
const { getUserById } = require('../services/user');

const SAML_LOGOUT_FIELDS = ['nameID', 'nameIDFormat', 'nameIDNameQualifier', 'nameIDSPNameQualifier'];

function idOf(user) {
  const id = user?._id ?? user?.id;
  return id ? String(id) : null;
}

/**
 * @param {Object} user - The user Passport just authenticated
 * @returns {{ id: string, nameID?: string, nameIDFormat?: string,
 *   nameIDNameQualifier?: string, nameIDSPNameQualifier?: string }}
 */
function serializeSessionUser(user) {
  const id = idOf(user);
  if (!id) throw new Error('Cannot start a session for a user without an id');
  const stored = { id };
  for (const field of SAML_LOGOUT_FIELDS) {
    if (user[field] !== undefined) stored[field] = user[field];
  }
  return stored;
}

/**
 * Sessions written before only the id was stored hold the whole user
 * document; they are read the same way, by its id.
 *
 * @param {Object} stored - The session's passport.user
 * @returns {Promise<Object|false>} req.user, or false when the user is gone
 *   (Passport then treats the request as signed out)
 */
async function deserializeSessionUser(stored) {
  const id = idOf(stored);
  if (!id) return false;
  const user = await getUserById(id);
  if (!user) return false;
  const userId = String(user._id);
  // Controllers use either req.user.id or req.user._id, as strings.
  const sessionUser = { ...user, _id: userId, id: userId };
  for (const field of SAML_LOGOUT_FIELDS) {
    if (stored[field] !== undefined) sessionUser[field] = stored[field];
  }
  return sessionUser;
}

module.exports = { SAML_LOGOUT_FIELDS, serializeSessionUser, deserializeSessionUser };
