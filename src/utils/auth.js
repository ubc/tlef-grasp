/**
 * Authentication and authorization utilities
 */

/**
 * Check if user is faculty or an administrator
 * Administrators are defined in APP_ADMINISTRATOR env variable (comma-separated PUIDs)
 * @param {Object} user - User object with affiliation and puid
 * @returns {boolean} True if user is faculty or administrator
 */
const isFaculty = (user) => {
  if (!user) return false;
  
  // Check if user is an administrator (staff with PUID in APP_ADMINISTRATOR)
  if (user.puid) {
    const administratorPUIDs = process.env.APP_ADMINISTRATOR 
      ? process.env.APP_ADMINISTRATOR.split(',').map(puid => puid.trim())
      : [];
    
    if (administratorPUIDs.includes(user.puid)) {
      return true;
    }
  }
  
  // Check if user has faculty affiliation
  if (!user.affiliation) return false;
  
  // affiliation can be a string (comma-separated) or an array
  const affiliations = Array.isArray(user.affiliation) 
    ? user.affiliation 
    : String(user.affiliation).split(',').map(a => a.trim());
  
  return affiliations.includes('faculty');
};

module.exports = {
  isFaculty,
};

