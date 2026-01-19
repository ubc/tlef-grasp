const databaseService = require('./database');
const { ObjectId } = require('mongodb');

/**
 * Save an achievement for a user
 * @param {string} userId - The user ID
 * @param {string} courseId - The course ID
 * @param {string} quizId - The quiz ID
 * @param {Object} achievementData - Achievement data (title, description, type, etc.)
 * @returns {Promise<Object>} The created achievement
 */
const saveAchievement = async (userId, courseId, quizId, achievementData) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_achievement");
        
        // Validate required fields
        if (!userId || !courseId || !quizId) {
            throw new Error("User ID, Course ID, and Quiz ID are required");
        }
        
        // Convert IDs to ObjectId if they're strings
        const userIdObj = ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
        const courseIdObj = ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId;
        const quizIdObj = ObjectId.isValid(quizId) ? new ObjectId(quizId) : quizId;
        
        // Check if achievement already exists for this user/quiz combination
        const existingAchievement = await collection.findOne({
            userId: userIdObj,
            quizId: quizIdObj
        });
        
        if (existingAchievement) {
            // Update existing achievement
            const result = await collection.updateOne(
                { _id: existingAchievement._id },
                {
                    $set: {
                        ...achievementData,
                        updatedAt: new Date()
                    }
                }
            );
            return { ...existingAchievement, ...achievementData, updated: true };
        } else {
            // Create new achievement
            const achievement = await collection.insertOne({
                userId: userIdObj,
                courseId: courseIdObj,
                quizId: quizIdObj,
                title: achievementData.title || "Perfect Score!",
                description: achievementData.description || "Answered all questions correctly",
                type: achievementData.type || "quiz_perfect",
                earnedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date()
            });
            
            return { _id: achievement.insertedId, ...achievementData, updated: false };
        }
    } catch (error) {
        console.error("Error saving achievement:", error);
        throw error;
    }
};

/**
 * Get achievements for a user
 * @param {string} userId - The user ID
 * @param {string} courseId - Optional course ID to filter by
 * @returns {Promise<Array>} Array of achievements
 */
const getUserAchievements = async (userId, courseId = null) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_achievement");
        
        const userIdObj = ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
        
        const query = { userId: userIdObj };
        if (courseId) {
            const courseIdObj = ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId;
            query.courseId = courseIdObj;
        }
        
        const achievements = await collection.find(query).sort({ earnedAt: -1 }).toArray();
        return achievements;
    } catch (error) {
        console.error("Error fetching user achievements:", error);
        throw error;
    }
};

/**
 * Check if user has achievement for a quiz
 * @param {string} userId - The user ID
 * @param {string} quizId - The quiz ID
 * @returns {Promise<boolean>} True if achievement exists
 */
const hasAchievement = async (userId, quizId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_achievement");
        
        const userIdObj = ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
        const quizIdObj = ObjectId.isValid(quizId) ? new ObjectId(quizId) : quizId;
        
        const achievement = await collection.findOne({
            userId: userIdObj,
            quizId: quizIdObj
        });
        
        return !!achievement;
    } catch (error) {
        console.error("Error checking achievement:", error);
        throw error;
    }
};

module.exports = {
    saveAchievement,
    getUserAchievements,
    hasAchievement
};

