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
 * Get user IDs that are in a specific course
 * @param {Object} db - Database connection
 * @param {string|ObjectId} courseId - Course ID
 * @returns {Promise<Array>} Array of user IDs in the course
 */
async function getUserIdsInCourse(db, courseId) {
    const userCourseCollection = db.collection("grasp_user_course");
    const { ObjectId } = require('mongodb');
    const courseIdObj = typeof courseId === 'string' ? new ObjectId(courseId) : courseId;
    
    const courseUserIds = await userCourseCollection.find({
        $or: [
            { courseId: courseIdObj },
            { courseId: courseId }
        ]
    }).toArray();
    
    return courseUserIds.map(uc => uc.userId);
}

/**
 * Filter out users that are in the course
 * @param {Array} users - Array of users to filter
 * @param {Array} userIdsInCourse - Array of user IDs in the course
 * @returns {Array} Users not in the course
 */
function filterUsersNotInCourse(users, userIdsInCourse) {
    return users.filter(user => {
        const userIdStr = user._id.toString();
        return !userIdsInCourse.some(id => {
            const idStr = id.toString ? id.toString() : String(id);
            return idStr === userIdStr;
        });
    });
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
        
        const userIdsInCourse = await getUserIdsInCourse(db, courseId);
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
        
        return filterUsersNotInCourse(staffUsers, userIdsInCourse);
    } catch (error) {
        console.error("Error getting staff users not in course:", error);
        throw error;
    }
}

/**
 * Get all students (affiliation includes 'student' or 'affiliate') that are not in a specific course
 * @param {string|ObjectId} courseId - Course ID
 * @returns {Promise<Array>} Array of students not in the course
 */
async function getStudentsNotInCourse(courseId) {
    try {
        const db = await databaseService.connect();
        const userCollection = db.collection("grasp_user");
        
        const userIdsInCourse = await getUserIdsInCourse(db, courseId);
        const allUsers = await userCollection.find({}).toArray();
        
        // Filter to get students (have 'student' or 'affiliate' affiliation)
        const students = allUsers.filter(user => {
            if (!user.affiliation) return false;
            
            const affiliations = Array.isArray(user.affiliation)
                ? user.affiliation
                : String(user.affiliation).split(',').map(a => a.trim());
            
            // Student if they have student or affiliate affiliation
            // but NOT faculty or staff
            const hasStudent = affiliations.includes('student') || affiliations.includes('affiliate');
            const hasStaff = affiliations.includes('staff');
            const hasFaculty = affiliations.includes('faculty');
            
            return hasStudent && !hasStaff && !hasFaculty;
        });
        
        return filterUsersNotInCourse(students, userIdsInCourse);
    } catch (error) {
        console.error("Error getting students not in course:", error);
        throw error;
    }
}

module.exports = {
    createOrUpdateUser,
    getUserByPuid,
    getStaffUsersNotInCourse,
    getStudentsNotInCourse,
};