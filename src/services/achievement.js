const databaseService = require('./database');
const { ObjectId } = require('mongodb');

// Achievement type constants
const ACHIEVEMENT_TYPES = {
    QUIZ_COMPLETED: 'quiz_completed',
    QUIZ_PERFECT: 'quiz_perfect',
};

// Achievement definitions
const ACHIEVEMENT_DEFINITIONS = {
    [ACHIEVEMENT_TYPES.QUIZ_COMPLETED]: {
        title: "Quiz Completed",
        description: "Successfully completed the quiz",
        icon: "fas fa-check-circle"
    },
    [ACHIEVEMENT_TYPES.QUIZ_PERFECT]: {
        title: "Perfect Score!",
        description: "Answered all questions correctly",
        icon: "fas fa-star"
    }
};

/**
 * Save an achievement for a user
 * @param {string} userId - The user ID
 * @param {string} courseId - The course ID
 * @param {string} quizId - The quiz ID
 * @param {string} type - Achievement type (quiz_completed, quiz_perfect, etc.)
 * @param {Object} additionalData - Additional achievement data
 * @returns {Promise<Object>} The created achievement or null if already exists
 */
const saveAchievement = async (userId, courseId, quizId, type, additionalData = {}) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_achievement");
        
        // Validate required fields
        if (!userId || !courseId || !quizId || !type) {
            throw new Error("User ID, Course ID, Quiz ID, and type are required");
        }
        
        // Convert IDs to ObjectId if they're strings
        const userIdObj = ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
        const courseIdObj = ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId;
        const quizIdObj = ObjectId.isValid(quizId) ? new ObjectId(quizId) : quizId;
        
        // Check if this specific achievement type already exists for this user/quiz combination
        const existingAchievement = await collection.findOne({
            userId: userIdObj,
            quizId: quizIdObj,
            type: type
        });
        
        if (existingAchievement) {
            // Achievement already exists, don't award again
            return null;
        }
        
        // Get achievement definition
        const definition = ACHIEVEMENT_DEFINITIONS[type] || {
            title: additionalData.title || "Achievement",
            description: additionalData.description || "You earned an achievement",
            icon: additionalData.icon || "fas fa-trophy"
        };
        
        // Create new achievement
        const achievement = {
            userId: userIdObj,
            courseId: courseIdObj,
            quizId: quizIdObj,
            type: type,
            title: definition.title,
            description: definition.description,
            icon: definition.icon,
            ...additionalData,
            earnedAt: new Date(),
            createdAt: new Date()
        };
        
        const result = await collection.insertOne(achievement);
        
        return { _id: result.insertedId, ...achievement, isNew: true };
    } catch (error) {
        // Handle duplicate key error gracefully
        if (error.code === 11000) {
            return null;
        }
        console.error("Error saving achievement:", error);
        throw error;
    }
};

/**
 * Award achievements for quiz completion
 * @param {string} userId - The user ID
 * @param {string} courseId - The course ID  
 * @param {string} quizId - The quiz ID
 * @param {string} quizName - The quiz name
 * @param {number} score - The quiz score (0-100)
 * @returns {Promise<Array>} Array of newly awarded achievements
 */
const awardQuizAchievements = async (userId, courseId, quizId, quizName, score) => {
    const awardedAchievements = [];
    
    // Ensure score is a number
    const numericScore = Number(score);
    
    try {
        // Award "Quiz Completed" achievement (first time completing this quiz)
        const completedAchievement = await saveAchievement(
            userId,
            courseId,
            quizId,
            ACHIEVEMENT_TYPES.QUIZ_COMPLETED,
            { quizName: quizName, score: numericScore }
        );
        
        if (completedAchievement) {
            awardedAchievements.push(completedAchievement);
        }
        
        // Award "Perfect Score" achievement if score is 100%
        if (numericScore >= 100) {
            const perfectAchievement = await saveAchievement(
                userId,
                courseId,
                quizId,
                ACHIEVEMENT_TYPES.QUIZ_PERFECT,
                { quizName: quizName, score: numericScore }
            );
            
            if (perfectAchievement) {
                awardedAchievements.push(perfectAchievement);
            }
        }
        
        return awardedAchievements;
    } catch (error) {
        console.error("Error awarding quiz achievements:", error);
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
 * Check if user has a specific achievement type for a quiz
 * @param {string} userId - The user ID
 * @param {string} quizId - The quiz ID
 * @param {string} type - Optional achievement type to check for
 * @returns {Promise<boolean>} True if achievement exists
 */
const hasAchievement = async (userId, quizId, type = null) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_achievement");
        
        const userIdObj = ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
        const quizIdObj = ObjectId.isValid(quizId) ? new ObjectId(quizId) : quizId;
        
        const query = {
            userId: userIdObj,
            quizId: quizIdObj
        };
        
        if (type) {
            query.type = type;
        }
        
        const achievement = await collection.findOne(query);
        
        return !!achievement;
    } catch (error) {
        console.error("Error checking achievement:", error);
        throw error;
    }
};

/**
 * Get achievement counts by type for a user
 * @param {string} userId - The user ID
 * @param {string} courseId - Optional course ID to filter by
 * @returns {Promise<Object>} Object with counts by achievement type
 */
const getAchievementCounts = async (userId, courseId = null) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_achievement");
        
        const userIdObj = ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
        
        const matchStage = { userId: userIdObj };
        if (courseId) {
            const courseIdObj = ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId;
            matchStage.courseId = courseIdObj;
        }
        
        const counts = await collection.aggregate([
            { $match: matchStage },
            { $group: { _id: "$type", count: { $sum: 1 } } }
        ]).toArray();
        
        const result = {
            total: 0,
            [ACHIEVEMENT_TYPES.QUIZ_COMPLETED]: 0,
            [ACHIEVEMENT_TYPES.QUIZ_PERFECT]: 0
        };
        
        counts.forEach(c => {
            result[c._id] = c.count;
            result.total += c.count;
        });
        
        return result;
    } catch (error) {
        console.error("Error getting achievement counts:", error);
        throw error;
    }
};

module.exports = {
    ACHIEVEMENT_TYPES,
    ACHIEVEMENT_DEFINITIONS,
    saveAchievement,
    awardQuizAchievements,
    getUserAchievements,
    hasAchievement,
    getAchievementCounts
};
