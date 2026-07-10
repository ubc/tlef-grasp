const { updateUserProfile } = require('../services/user');
const { getUserRole, isAppAdministrator, ROLES } = require('../utils/auth');

const MAX_DISPLAY_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;

function buildCurrentUser(user) {
  return Promise.all([
    getUserRole(user),
    isAppAdministrator(user),
  ]).then(([role, isAppAdministrator]) => ({
    _id: user._id,
    id: user._id,
    displayName: user.displayName,
    email: user.email,
    affiliation: user.affiliation,
    puid: user.puid,
    role,
    isFaculty: role === ROLES.FACULTY,
    isStaff: role === ROLES.STAFF,
    isStudent: role === ROLES.STUDENT,
    isAppAdministrator,
  }));
}

function normalizeProfile(body = {}) {
  const displayName = typeof body.displayName === 'string'
    ? body.displayName.trim()
    : '';
  const email = typeof body.email === 'string'
    ? body.email.trim().toLowerCase()
    : '';

  if (!displayName) {
    return { error: 'Display name is required.' };
  }
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    return { error: `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.` };
  }
  if (!email || email.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Enter a valid email address.' };
  }

  return { profile: { displayName, email } };
}

async function updateProfileHandler(req, res) {
  const normalized = normalizeProfile(req.body);
  if (normalized.error) {
    return res.status(400).json({ success: false, error: normalized.error });
  }

  try {
    const updatedUser = await updateUserProfile(req.user, normalized.profile);
    if (!updatedUser) {
      return res.status(404).json({ success: false, error: 'User profile not found.' });
    }

    // Keep the current session in sync so the header/sidebar and the current-user
    // endpoint reflect the change immediately without requiring a new login.
    req.user.displayName = updatedUser.displayName;
    req.user.email = updatedUser.email;

    const user = await buildCurrentUser(req.user);
    return res.json({ success: true, user });
  } catch (error) {
    console.error('Error updating current user profile:', error);
    return res.status(500).json({ success: false, error: 'Failed to update profile.' });
  }
}

module.exports = {
  updateProfileHandler,
  normalizeProfile,
};
