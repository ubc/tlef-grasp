const databaseService = require('./database');
const { ObjectId } = require('mongodb');

const createUserCourse = async (userId, courseId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");
        
        // Convert userId and courseId to ObjectId if they're strings
        const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId;
        const courseIdObj = typeof courseId === 'string' ? new ObjectId(courseId) : courseId;
        
        const userCourse = await collection.insertOne({ 
            userId: userIdObj, 
            courseId: courseIdObj 
        });
        return userCourse;
    } catch (error) {
        console.error("Error creating user course:", error);
        throw error;
    }
};

const deleteUserCourseByUserID = async (userId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");
        const result = await collection.deleteMany({ userId });
        return result;
    } catch (error) {
        console.error("Error deleting user course:", error);
        throw error;
    }
};

const deleteUserCourseByCourseID = async (courseId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");
        const result = await collection.deleteMany({ courseId });
        return result;
    } catch (error) {
        console.error("Error deleting user course:", error);
        throw error;
    }
};

/**
 * Get user courses with full course details using MongoDB $lookup (JOIN)
 * @param {string|ObjectId} userId - User ID
 * @returns {Promise<Array>} Array of user-course documents with populated course details
 */
const getUserCourses = async (userId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");
        
        // Convert userId to ObjectId if it's a string
        const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId;
        
        // Use aggregation with $lookup to join with courses collection
        const userCourses = await collection.aggregate([
            // Match user courses for this user
            // Handle both ObjectId and string userId
            {
                $match: {
                    $or: [
                        { userId: userIdObj },
                        { userId: userId }
                    ]
                }
            },
            // Join with courses collection
            // Note: If courseId is stored as string, convert it in $lookup
            {
                $lookup: {
                    from: "grasp_course",
                    let: { 
                        // Convert courseId to ObjectId if it's a string
                        courseIdToMatch: {
                            $cond: {
                                if: { $eq: [{ $type: "$courseId" }, "string"] },
                                then: { $toObjectId: "$courseId" },
                                else: "$courseId"
                            }
                        }
                    },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ["$_id", "$$courseIdToMatch"] }
                            }
                        }
                    ],
                    as: "course"
                }
            },
            // Unwind the course array (since $lookup returns an array)
            { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
            // Reshape the output to include course fields at top level
            {
                $project: {
                    _id: 1,
                    userId: 1,
                    courseId: 1,
                    // Include all course fields at top level for easier access
                    courseCode: "$course.courseCode",
                    courseTitle: "$course.courseTitle",
                    courseName: "$course.courseName",
                    createdAt: "$course.createdAt",
                    // Keep full course object if needed
                    course: 1
                }
            }
        ]).toArray();
        
        return userCourses;
    } catch (error) {
        console.error("Error getting user courses:", error);
        throw error;
    }
};


/**
 * Get course users with full user details using MongoDB $lookup (JOIN)
 * @param {string|ObjectId} courseId - Course ID
 * @returns {Promise<Array>} Array of user-course documents with populated user details
 */
const getCourseUsers = async (courseId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");
        
        // Convert courseId to ObjectId if it's a string
        const courseIdObj = typeof courseId === 'string' ? new ObjectId(courseId) : courseId;
        
        // Use aggregation with $lookup to join with users collection
        const courseUsers = await collection.aggregate([
            // Match user courses for this course
            // Handle both ObjectId and string courseId
            {
                $match: {
                    $or: [
                        { courseId: courseIdObj },
                        { courseId: courseId }
                    ]
                }
            },
            // Join with users collection
            {
                $lookup: {
                    from: "grasp_user",
                    let: { 
                        // Convert userId to ObjectId if it's a string
                        userIdToMatch: {
                            $cond: {
                                if: { $eq: [{ $type: "$userId" }, "string"] },
                                then: { $toObjectId: "$userId" },
                                else: "$userId"
                            }
                        }
                    },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ["$_id", "$$userIdToMatch"] }
                            }
                        }
                    ],
                    as: "user"
                }
            },
            // Unwind the user array (since $lookup returns an array)
            { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
            // Reshape the output to include user fields at top level
            {
                $project: {
                    _id: 1,
                    userId: 1,
                    courseId: 1,
                    // Include all user fields at top level for easier access
                    username: "$user.username",
                    puid: "$user.puid",
                    firstName: "$user.firstName",
                    lastName: "$user.lastName",
                    email: "$user.email",
                    affiliation: "$user.affiliation",
                    registeredAt: "$user.registeredAt",
                    updatedAt: "$user.updatedAt",
                    // Keep full user object if needed
                    user: 1
                }
            }
        ]).toArray();
        
        return courseUsers;
    } catch (error) {
        console.error("Error getting course users:", error);
        throw error;
    }
};

/**
 * Get user courses (alternative: returns only course IDs, then fetch course details separately)
 * Use this if you prefer manual fetching over aggregation
 * @param {string|ObjectId} userId - User ID
 * @returns {Promise<Array>} Array of course IDs
 */
const getUserCourseIds = async (userId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");
        const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId;
        // Handle both ObjectId and string userId
        const userCourses = await collection.find({
            $or: [
                { userId: userIdObj },
                { userId: userId }
            ]
        }).toArray();
        return userCourses.map(uc => uc.courseId);
    } catch (error) {
        console.error("Error getting user course IDs:", error);
        throw error;
    }
};

/**
 * Get course users (alternative: returns only user IDs, then fetch user details separately)
 * Use this if you prefer manual fetching over aggregation
 * @param {string|ObjectId} courseId - Course ID
 * @returns {Promise<Array>} Array of user IDs
 */
const getCourseUserIds = async (courseId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");
        const courseIdObj = typeof courseId === 'string' ? new ObjectId(courseId) : courseId;
        // Handle both ObjectId and string courseId
        const courseUsers = await collection.find({
            $or: [
                { courseId: courseIdObj },
                { courseId: courseId }
            ]
        }).toArray();
        return courseUsers.map(cu => cu.userId);
    } catch (error) {
        console.error("Error getting course user IDs:", error);
        throw error;
    }
};

const isUserInCourse = async (userId, courseId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");
        const result = await collection.findOne({ userId: userId, courseId: courseId });
        return result ? true : false;
    } catch (error) {
        console.error("Error checking if user is in course:", error);
        throw error;
    }
};

module.exports = {
    createUserCourse,
    getUserCourses,
    getUserCourseIds,
    getCourseUsers,
    getCourseUserIds,
    deleteUserCourseByUserID,
    deleteUserCourseByCourseID,
    isUserInCourse,
};