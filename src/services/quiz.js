const databaseService = require('./database');
const { ObjectId } = require('mongodb');

/**
 * Create a new quiz
 * @param {string} courseId - The course ID
 * @param {Object} quizData - Quiz data with name and description
 * @returns {Promise<Object>} The created quiz
 */
const createQuiz = async (courseId, quizData) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_quiz");
        
        // Validate required fields
        if (!quizData.name || !quizData.name.trim()) {
            throw new Error("Quiz name is required");
        }
        
        if (!ObjectId.isValid(courseId)) {
            throw new Error("Invalid course ID");
        }
        
        const quiz = await collection.insertOne({
            courseId: new ObjectId(courseId),
            name: quizData.name.trim(),
            description: quizData.description || "",
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        
        console.log("Quiz created with ID:", quiz.insertedId);
        return quiz;
    } catch (error) {
        console.error("Error creating quiz:", error);
        throw error;
    }
};

/**
 * Get all quizzes for a course
 * @param {string} courseId - The course ID
 * @returns {Promise<Array>} Array of quizzes
 */
const getQuizzesByCourse = async (courseId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_quiz");
        
        if (!ObjectId.isValid(courseId)) {
            throw new Error("Invalid course ID");
        }
        
        const quizzes = await collection
            .find({ courseId: new ObjectId(courseId) })
            .sort({ createdAt: -1 })
            .toArray();
        
        return quizzes;
    } catch (error) {
        console.error("Error fetching quizzes:", error);
        throw error;
    }
};

/**
 * Get a quiz by ID
 * @param {string} quizId - The quiz ID
 * @returns {Promise<Object|null>} The quiz or null if not found
 */
const getQuizById = async (quizId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_quiz");
        
        if (!ObjectId.isValid(quizId)) {
            throw new Error("Invalid quiz ID");
        }
        
        const quiz = await collection.findOne({ _id: new ObjectId(quizId) });
        return quiz;
    } catch (error) {
        console.error("Error fetching quiz:", error);
        throw error;
    }
};

/**
 * Update a quiz
 * @param {string} quizId - The quiz ID
 * @param {Object} quizData - Updated quiz data
 * @returns {Promise<Object>} The update result
 */
const updateQuiz = async (quizId, quizData) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_quiz");
        
        if (!ObjectId.isValid(quizId)) {
            throw new Error("Invalid quiz ID");
        }
        
        const updateData = {
            updatedAt: new Date(),
        };
        
        if (quizData.name !== undefined) {
            updateData.name = quizData.name.trim();
        }
        
        if (quizData.description !== undefined) {
            updateData.description = quizData.description;
        }
        
        const result = await collection.updateOne(
            { _id: new ObjectId(quizId) },
            { $set: updateData }
        );
        
        return result;
    } catch (error) {
        console.error("Error updating quiz:", error);
        throw error;
    }
};

/**
 * Delete a quiz
 * @param {string} quizId - The quiz ID
 * @returns {Promise<Object>} The delete result
 */
const deleteQuiz = async (quizId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_quiz");
        const relationshipCollection = db.collection("grasp_quiz_question");
        
        if (!ObjectId.isValid(quizId)) {
            throw new Error("Invalid quiz ID");
        }
        
        const quizObjectId = new ObjectId(quizId);
        
        // Delete all quiz-question relationships
        await relationshipCollection.deleteMany({ quizId: quizObjectId });
        
        // Delete the quiz
        const result = await collection.deleteOne({ _id: quizObjectId });
        
        return result;
    } catch (error) {
        console.error("Error deleting quiz:", error);
        throw error;
    }
};

/**
 * Add questions to a quiz (create quiz-question relationships)
 * @param {string} quizId - The quiz ID
 * @param {Array<string>} questionIds - Array of question IDs
 * @returns {Promise<Object>} The insert result
 */
const addQuestionsToQuiz = async (quizId, questionIds) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_quiz_question");
        
        if (!ObjectId.isValid(quizId)) {
            throw new Error("Invalid quiz ID");
        }
        
        const quizObjectId = new ObjectId(quizId);
        
        // Validate and convert question IDs
        const validQuestionIds = questionIds
            .filter(id => ObjectId.isValid(id))
            .map(id => new ObjectId(id));
        
        if (validQuestionIds.length === 0) {
            throw new Error("No valid question IDs provided");
        }
        
        // Check for existing relationships to avoid duplicates
        const existingRelationships = await collection
            .find({
                quizId: quizObjectId,
                questionId: { $in: validQuestionIds }
            })
            .toArray();
        
        const existingQuestionIds = new Set(
            existingRelationships.map(rel => rel.questionId.toString())
        );
        
        // Only insert new relationships
        const newRelationships = validQuestionIds
            .filter(qId => !existingQuestionIds.has(qId.toString()))
            .map(questionId => ({
                quizId: quizObjectId,
                questionId: questionId,
                addedAt: new Date(),
            }));
        
        if (newRelationships.length === 0) {
            return {
                insertedCount: 0,
                message: "All questions already exist in this quiz"
            };
        }
        
        const result = await collection.insertMany(newRelationships);
        
        console.log(`Added ${result.insertedCount} questions to quiz ${quizId}`);
        return result;
    } catch (error) {
        console.error("Error adding questions to quiz:", error);
        throw error;
    }
};

/**
 * Get all questions in a quiz
 * @param {string} quizId - The quiz ID
 * @returns {Promise<Array>} Array of questions
 */
const getQuizQuestions = async (quizId) => {
    try {
        const db = await databaseService.connect();
        const relationshipCollection = db.collection("grasp_quiz_question");
        const questionCollection = db.collection("grasp_question");
        
        if (!ObjectId.isValid(quizId)) {
            throw new Error("Invalid quiz ID");
        }
        
        const quizObjectId = new ObjectId(quizId);
        
        // Get all relationships for this quiz
        const relationships = await relationshipCollection
            .find({ quizId: quizObjectId })
            .toArray();
        
        if (relationships.length === 0) {
            return [];
        }
        
        // Get all question IDs
        const questionIds = relationships.map(rel => rel.questionId);
        
        // Fetch the questions
        const questions = await questionCollection
            .find({ _id: { $in: questionIds } })
            .toArray();
        
        return questions;
    } catch (error) {
        console.error("Error fetching quiz questions:", error);
        throw error;
    }
};

module.exports = {
    createQuiz,
    getQuizzesByCourse,
    getQuizById,
    updateQuiz,
    deleteQuiz,
    addQuestionsToQuiz,
    getQuizQuestions,
};

