const databaseService = require('./database');

const createQuestion = async (questionData) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_question");
        const question = await collection.insertOne(questionData);
        return question;
    } catch (error) {
        console.error("Error creating question:", error);
        throw error;
    }
};

module.exports = {
    createQuestion,
};