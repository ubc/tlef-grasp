/**
 * Authentication and authorization utilities
 * 
 * Role hierarchy:
 * - Faculty: users with faculty affiliation OR staff whitelisted as admin in APP_ADMINISTRATOR
 * - Staff: users with staff affiliation (but not faculty)
 * - Student: users with student or affiliate affiliation
 */

const databaseService = require('../services/database');

// Role constants
const ROLES = {
  FACULTY: 'faculty',
  STAFF: 'staff',
  STUDENT: 'student',
};

/**
 * Parse affiliations from user object
 * @param {Object} user - User object with affiliation
 * @returns {string[]} Array of affiliations
 */
function parseAffiliations(user) {
  if (!user?.affiliation) return [];
  
  return Array.isArray(user.affiliation)
    ? user.affiliation
    : String(user.affiliation).split(',').map(a => a.trim());
}

/**
 * Get user PUID, fetching from DB if needed
 * @param {Object} user - User object
 * @returns {Promise<string|null>} User PUID or null
 */
async function getUserPuid(user) {
  if (!user) return null;
  
  let userPuid = user.puid;
  
  // If puid is not in session, try to get it from database using _id
  if (!userPuid && user._id) {
    try {
      const db = await databaseService.connect();
      const collection = db.collection('grasp_user');
      const { ObjectId } = require('mongodb');
      const userId = ObjectId.isValid(user._id) ? new ObjectId(user._id) : user._id;
      const dbUser = await collection.findOne({ _id: userId });
      if (dbUser?.puid) {
        userPuid = dbUser.puid;
      }
    } catch (error) {
      console.error('[getUserPuid] Error fetching user from DB:', error);
    }
  }
  
  return userPuid;
}

/**
 * Check if user PUID is in the administrator whitelist
 * @param {string} puid - User PUID
 * @returns {boolean} True if user is an administrator
 */
function isAdministrator(puid) {
  if (!puid) return false;
  
  const administratorPUIDs = process.env.APP_ADMINISTRATOR
    ? process.env.APP_ADMINISTRATOR.split(',').map(p => p.trim()).filter(p => p.length > 0)
    : [];
  
  return administratorPUIDs.includes(puid);
}

/**
 * Check if user is faculty or an administrator
 * Administrators are defined in APP_ADMINISTRATOR env variable (comma-separated PUIDs)
 * @param {Object} user - User object with affiliation and puid
 * @returns {Promise<boolean>} True if user is faculty or administrator
 */
async function isFaculty(user) {
  if (!user) return false;
  
  // Check if user is an administrator (staff with PUID in APP_ADMINISTRATOR)
  const userPuid = await getUserPuid(user);
  if (isAdministrator(userPuid)) {
    return true;
  }
  
  // Check if user has faculty affiliation
  const affiliations = parseAffiliations(user);
  return affiliations.includes('faculty');
}

/**
 * Check if user is staff (has staff affiliation but not faculty)
 * @param {Object} user - User object with affiliation
 * @returns {Promise<boolean>} True if user is staff
 */
async function isStaff(user) {
  if (!user) return false;
  
  // If user is faculty (including admin), they're not "just staff"
  if (await isFaculty(user)) {
    return false;
  }
  
  const affiliations = parseAffiliations(user);
  return affiliations.includes('staff');
}

/**
 * Check if user is a student (has student or affiliate affiliation)
 * @param {Object} user - User object with affiliation
 * @returns {Promise<boolean>} True if user is a student
 */
async function isStudent(user) {
  if (!user) return false;
  
  // If user is faculty or staff, they're not a student
  if (await isFaculty(user) || await isStaff(user)) {
    return false;
  }
  
  const affiliations = parseAffiliations(user);
  return affiliations.includes('student') || affiliations.includes('affiliate');
}

/**
 * Get the user's role based on their affiliations
 * @param {Object} user - User object with affiliation and puid
 * @returns {Promise<string>} User role (faculty, staff, or student)
 */
async function getUserRole(user) {
  if (!user) return null;
  
  if (await isFaculty(user)) {
    return ROLES.FACULTY;
  }
  
  if (await isStaff(user)) {
    return ROLES.STAFF;
  }
  
  if (await isStudent(user)) {
    return ROLES.STUDENT;
  }
  
  // Default to student for unknown affiliations
  return ROLES.STUDENT;
}

/**
 * Check if user has at least the minimum required role
 * Role hierarchy: faculty > staff > student
 * @param {Object} user - User object
 * @param {string} minRole - Minimum required role
 * @returns {Promise<boolean>} True if user has sufficient role
 */
async function hasMinimumRole(user, minRole) {
  const userRole = await getUserRole(user);
  
  if (!userRole) return false;
  
  const roleHierarchy = {
    [ROLES.FACULTY]: 3,
    [ROLES.STAFF]: 2,
    [ROLES.STUDENT]: 1,
  };
  
  const userLevel = roleHierarchy[userRole] || 0;
  const requiredLevel = roleHierarchy[minRole] || 0;
  
  return userLevel >= requiredLevel;
}

module.exports = {
  ROLES,
  isFaculty,
  isStaff,
  isStudent,
  getUserRole,
  hasMinimumRole,
  parseAffiliations,
};

