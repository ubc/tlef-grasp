const databaseService = require('./database');

async function createOrUpdateUser(userData) {
    try {
        if (!userData.puid) {
            throw new Error("Puid is required");
        }

        const db = await databaseService.connect();

        const collection = db.collection("grasp_user");
        const user = {
            username: userData.username,
            puid: userData.puid,
            displayName: userData.displayName,
            email: userData.email,
            affiliation: userData.affiliation,
            updatedAt: new Date(),
        };

        // Use upsert to update existing user or create new one
        const result = await collection.updateOne(
            { puid: userData.puid },
            {
                $set: user,
                $setOnInsert: { registeredAt: new Date() }
            },
            { upsert: true }
        );
        return result;
    } catch (error) {
        console.error("Error saving user:", error);
        throw error;
    }
}

async function getUserByPuid(puid) {
    try {
        const db = await databaseService.connect();

        const collection = db.collection("grasp_user");
        const user = await collection.findOne({ puid: puid });
        return user;
    } catch (error) {
        console.error("Error getting user by PUID:", error);
        throw error;
    }
}

/**
 * Get all staff users (non-faculty) that are not in a specific course
 * @param {string|ObjectId} courseId - Course ID
 * @returns {Promise<Array>} Array of staff users not in the course
 */
async function getStaffUsersNotInCourse(courseId) {
    try {
        const db = await databaseService.connect();
        const userCollection = db.collection("grasp_user");
        const userCourseCollection = db.collection("grasp_user_course");
        
        // Convert courseId to ObjectId if it's a string
        const { ObjectId } = require('mongodb');
        const courseIdObj = typeof courseId === 'string' ? new ObjectId(courseId) : courseId;
        
        // Get all user IDs that are in this course
        const courseUserIds = await userCourseCollection.find({
            $or: [
                { courseId: courseIdObj },
                { courseId: courseId }
            ]
        }).toArray();
        
        const userIdsInCourse = courseUserIds.map(uc => uc.userId);
        
        // Get all staff users (non-faculty)
        // affiliation can be a string (comma-separated) or an array
        // We want users who have 'staff' but NOT 'faculty'
        const allUsers = await userCollection.find({}).toArray();
        
        // Filter to get staff users (have staff affiliation but not faculty)
        const staffUsers = allUsers.filter(user => {
            if (!user.affiliation) return false;
            
            const affiliations = Array.isArray(user.affiliation)
                ? user.affiliation
                : String(user.affiliation).split(',').map(a => a.trim());
            
            const hasStaff = affiliations.includes('staff');
            const hasFaculty = affiliations.includes('faculty');
            
            return hasStaff && !hasFaculty;
        });
        
        // Filter out users that are already in the course
        const staffNotInCourse = staffUsers.filter(user => {
            // Convert user._id to string for comparison
            const userIdStr = user._id.toString();
            return !userIdsInCourse.some(id => {
                const idStr = id.toString ? id.toString() : String(id);
                return idStr === userIdStr;
            });
        });
        
        return staffNotInCourse;
    } catch (error) {
        console.error("Error getting staff users not in course:", error);
        throw error;
    }
}

module.exports = {
    createOrUpdateUser,
    getUserByPuid,
    getStaffUsersNotInCourse,
};