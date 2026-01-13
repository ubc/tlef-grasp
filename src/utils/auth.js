/**
 * Authentication and authorization utilities
 */

const databaseService = require('../services/database');

/**
 * Check if user is faculty or an administrator
 * Administrators are defined in APP_ADMINISTRATOR env variable (comma-separated PUIDs)
 * @param {Object} user - User object with affiliation and puid
 * @returns {Promise<boolean>} True if user is faculty or administrator
 */
const isFaculty = async (user) => {
  if (!user) return false;
  
  // Get user PUID - check if it's in the user object or fetch from DB if we have _id
  let userPuid = user.puid;
  
  // If puid is not in session, try to get it from database using _id
  if (!userPuid && user._id) {
    try {
      const db = await databaseService.connect();
      const collection = db.collection("grasp_user");
      const { ObjectId } = require('mongodb');
      const userId = ObjectId.isValid(user._id) ? new ObjectId(user._id) : user._id;
      const dbUser = await collection.findOne({ _id: userId });
      if (dbUser && dbUser.puid) {
        userPuid = dbUser.puid;
      }
    } catch (error) {
      console.error('[isFaculty] Error fetching user from DB:', error);
    }
  }
  
  // Check if user is an administrator (staff with PUID in APP_ADMINISTRATOR)
  if (userPuid) {
    const administratorPUIDs = process.env.APP_ADMINISTRATOR 
      ? process.env.APP_ADMINISTRATOR.split(',').map(puid => puid.trim()).filter(puid => puid.length > 0)
      : [];
    
    if (administratorPUIDs.includes(userPuid)) {
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

