const databaseService = require('./database');
const { ObjectId } = require('mongodb');

const saveQuestion = async (courseId, questionData) => {
    try {
        console.log("Saving question:", questionData);
        const db = await databaseService.connect();
        const collection = db.collection("grasp_question");
        
        // Convert courseId to ObjectId if it's a string
        const courseIdObj = ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId;
        
        // Convert granularObjectiveId to ObjectId if it's provided and valid
        let granularObjectiveIdObj = null;
        if (questionData.granularObjectiveId) {
            granularObjectiveIdObj = ObjectId.isValid(questionData.granularObjectiveId) 
                ? new ObjectId(questionData.granularObjectiveId) 
                : questionData.granularObjectiveId;
        }
        
        // Save the full question data including granularObjectiveId
        const question = await collection.insertOne({
            title: questionData.title,
            stem: questionData.stem,
            options: questionData.options,
            correctAnswer: questionData.correctAnswer,
            bloom: questionData.bloom,
            difficulty: questionData.difficulty,
            courseId: courseIdObj,
            granularObjectiveId: granularObjectiveIdObj,
            createdBy: questionData.by,
            status: questionData.status || "Draft",
            flagStatus: questionData.flagStatus || false,
            createdAt: new Date(),
        });
        
        console.log("Question saved with ID:", question.insertedId);
        return question;
    } catch (error) {
        console.error("Error creating question:", error);
        throw error;
    }
};

const getQuestions = async (courseId) => {
    try {
        const db = await databaseService.connect();
        const questionCollection = db.collection("grasp_question");
        const objectiveCollection = db.collection("grasp_objective");
        
        // Convert courseId to ObjectId if it's a string
        const courseIdObj = ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId;
        
        const questions = await questionCollection.find({ courseId: courseIdObj }).toArray();

        // Get all unique granular objective IDs from questions
        // First normalize to strings to get unique values, then convert to ObjectIds
        const uniqueGranularIdStrings = [...new Set(
            questions
                .map(q => q.granularObjectiveId)
                .filter(id => id != null)
                .map(id => id.toString())
        )];
        
        const granularObjectiveIds = uniqueGranularIdStrings
            .filter(idStr => ObjectId.isValid(idStr))
            .map(idStr => new ObjectId(idStr));

        // Fetch all granular objectives in one query
        const granularObjectives = granularObjectiveIds.length > 0
            ? await objectiveCollection.find({ 
                _id: { $in: granularObjectiveIds } 
            }).toArray()
            : [];

        // Create a map of granular objective ID to parent objective ID
        // Handle both ObjectId and string formats for comparison
        const granularToParentMap = new Map();
        granularObjectives.forEach(granular => {
            const granularId = granular._id.toString();
            const parentId = granular.parent;
            granularToParentMap.set(granularId, parentId);
            // Also store with ObjectId key for matching
            if (granular._id instanceof ObjectId) {
                granularToParentMap.set(granular._id, parentId);
            }
        });

        // Attach parent objective ID to each question
        const questionsWithParentId = questions.map(question => {
            const granularId = question.granularObjectiveId || question.objectiveId;
            let parentObjectiveId = null;
            
            if (granularId) {
                // Try to find parent ID using string or ObjectId key
                const granularIdStr = granularId.toString();
                parentObjectiveId = granularToParentMap.get(granularIdStr) || 
                                  granularToParentMap.get(granularId);
            }
            
            return {
                ...question,
                learningObjectiveId: parentObjectiveId,
            };
        });

        return questionsWithParentId;
    } catch (error) {
        console.error("Error getting questions by course ID:", error);
        throw error;
    }
};

const getQuestion = async (questionId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_question");
        
        // Convert questionId to ObjectId if it's a string
        const id = ObjectId.isValid(questionId) ? new ObjectId(questionId) : questionId;
        
        const question = await collection.findOne({ _id: id });
        return question;
    } catch (error) {
        console.error("Error getting question:", error);
        throw error;
    }
};

const updateQuestion = async (questionId, updateData) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_question");
        
        // Convert questionId to ObjectId if it's a string
        const id = ObjectId.isValid(questionId) ? new ObjectId(questionId) : questionId;
        
        // Build update object
        const update = {
            updatedAt: new Date(),
        };
        
        // Only update fields that are provided
        if (updateData.title !== undefined) update.title = updateData.title;
        if (updateData.stem !== undefined) update.stem = updateData.stem;
        if (updateData.options !== undefined) update.options = updateData.options;
        if (updateData.correctAnswer !== undefined) update.correctAnswer = updateData.correctAnswer;
        if (updateData.bloom !== undefined) update.bloom = updateData.bloom;
        if (updateData.difficulty !== undefined) update.difficulty = updateData.difficulty;
        if (updateData.status !== undefined) update.status = updateData.status;
        if (updateData.flagStatus !== undefined) update.flagStatus = updateData.flagStatus;
        if (updateData.granularObjectiveId !== undefined) {
            // Convert granularObjectiveId to ObjectId if it's a string
            update.granularObjectiveId = updateData.granularObjectiveId 
                ? (ObjectId.isValid(updateData.granularObjectiveId) 
                    ? new ObjectId(updateData.granularObjectiveId) 
                    : updateData.granularObjectiveId)
                : null;
        }
        
        const result = await collection.updateOne(
            { _id: id },
            { $set: update }
        );
        
        return result;
    } catch (error) {
        console.error("Error updating question:", error);
        throw error;
    }
};

const deleteQuestion = async (questionId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_question");
        
        // Convert questionId to ObjectId if it's a string
        const id = ObjectId.isValid(questionId) ? new ObjectId(questionId) : questionId;
        
        const result = await collection.deleteOne({ _id: id });
        
        return result;
    } catch (error) {
        console.error("Error deleting question:", error);
        throw error;
    }
};

const getQuestionCourseId = async (questionId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_question");
        
        // Convert questionId to ObjectId if it's a string
        const id = ObjectId.isValid(questionId) ? new ObjectId(questionId) : questionId;
        
        const question = await collection.findOne({ _id: id });
        return question?.courseId;
    } catch (error) {
        console.error("Error getting question course ID:", error);
        throw error;
    }
};

module.exports = {
    saveQuestion,
    getQuestions,
    updateQuestion,
    deleteQuestion,
    getQuestion,
    getQuestionCourseId,
};