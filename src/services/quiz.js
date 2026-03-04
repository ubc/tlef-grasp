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
            published: false, // Default to unpublished
            releaseDate: quizData.releaseDate ? new Date(quizData.releaseDate) : null,
            expireDate: quizData.expireDate ? new Date(quizData.expireDate) : null,
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
        
        // Handle null, undefined, or empty string
        if (!quizId) {
            throw new Error("Quiz ID is required");
        }
        
        // Convert to string if it's not already
        const quizIdStr = String(quizId).trim();
        
        if (!ObjectId.isValid(quizIdStr)) {
            console.error("Invalid quiz ID format:", quizIdStr, "Type:", typeof quizId);
            throw new Error(`Invalid quiz ID: ${quizIdStr}`);
        }
        
        const quiz = await collection.findOne({ _id: new ObjectId(quizIdStr) });
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
        
        if (quizData.published !== undefined) {
            updateData.published = quizData.published;
        }

        if (quizData.releaseDate !== undefined) {
            updateData.releaseDate = quizData.releaseDate ? new Date(quizData.releaseDate) : null;
        }

        if (quizData.expireDate !== undefined) {
            updateData.expireDate = quizData.expireDate ? new Date(quizData.expireDate) : null;
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
        const questionCollection = db.collection("grasp_question");
        
        if (!ObjectId.isValid(quizId)) {
            throw new Error("Invalid quiz ID");
        }
        
        const quizObjectId = new ObjectId(quizId);
        
        // Get all question IDs associated with this quiz
        const relationships = await relationshipCollection
            .find({ quizId: quizObjectId })
            .toArray();
        
        const questionIds = relationships.map(rel => rel.questionId);
        
        // Delete all associated questions
        if (questionIds.length > 0) {
            await questionCollection.deleteMany({ _id: { $in: questionIds } });
        }
        
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
 * @param {boolean} approvedOnly - If true, only return approved questions (for students)
 * @returns {Promise<Array>} Array of questions
 */
const getQuizQuestions = async (quizId, approvedOnly = false) => {
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
        
        // Build query - filter by approved status if requested
        const query = { _id: { $in: questionIds } };
        if (approvedOnly) {
            query.status = "Approved";
        }
        
        // Fetch the questions
        const questions = await questionCollection
            .find(query)
            .toArray();
        
        return questions;
    } catch (error) {
        console.error("Error fetching quiz questions:", error);
        throw error;
    }
};

/**
 * Enrich questions with their parent Learning Objective ID and names
 * @param {Array} questions - Array of questions
 * @returns {Promise<Array>} Enriched questions
 */
const enrichQuestionsWithLO = async (questions) => {
    try {
        const db = await databaseService.connect();
        const objectiveCollection = db.collection("grasp_objective");
        
        // Get all unique granular objective IDs from questions
        const granularIds = [...new Set(
            questions
                .map(q => q.granularObjectiveId)
                .filter(id => id != null)
        )];
        
        if (granularIds.length === 0) return questions;

        const granularObjectives = await objectiveCollection.find({ 
            _id: { $in: granularIds.map(id => new ObjectId(id)) } 
        }).toArray();

        // Also fetch all parent objectives needed
        const parentIds = [...new Set(
            granularObjectives
                .map(g => g.parent)
                .filter(id => id != null && id !== 0)
        )];

        const parentObjectives = await objectiveCollection.find({
            _id: { $in: parentIds.map(id => new ObjectId(id)) }
        }).toArray();

        const parentMap = new Map();
        parentObjectives.forEach(parent => {
            parentMap.set(parent._id.toString(), parent);
        });

        const granularToDataMap = new Map();
        granularObjectives.forEach(granular => {
            const parentIdStr = granular.parent?.toString();
            const parentData = parentIdStr ? parentMap.get(parentIdStr) : null;
            
            granularToDataMap.set(granular._id.toString(), {
                parentId: granular.parent,
                granularName: granular.name,
                parentName: parentData ? parentData.name : null
            });
        });

        return questions.map(question => {
            const granularId = question.granularObjectiveId;
            let parentObjectiveId = null;
            let learningObjectiveName = null;
            let granularObjectiveName = null;
            
            if (granularId) {
                const loData = granularToDataMap.get(granularId.toString());
                if (loData) {
                    parentObjectiveId = loData.parentId;
                    learningObjectiveName = loData.parentName;
                    granularObjectiveName = loData.granularName;
                }
            }
            
            return {
                ...question,
                learningObjectiveId: parentObjectiveId,
                learningObjectiveName: learningObjectiveName,
                granularObjectiveName: granularObjectiveName
            };
        });
    } catch (error) {
        console.error("Error enriching questions with LO:", error);
        return questions;
    }
};

const BLOOM_ORDER = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"];

const getQuizQuestionsForStudent = async (quizId, userId) => {
    try {
        const db = await databaseService.connect();
        const quiz = await getQuizById(quizId);
        if (!quiz) throw new Error("Quiz not found");

        // Get all approved questions
        const allQuestions = await getQuizQuestions(quizId, true);
        if (allQuestions.length === 0) return [];

        // Enrich questions with LO ID
        const enrichedQuestions = await enrichQuestionsWithLO(allQuestions);

        // Fetch student performance to know which questions are unseen
        const performanceCollection = db.collection("grasp_student_performance");
        const userPerformance = await performanceCollection.find({ 
            userId: ObjectId.isValid(userId) ? new ObjectId(userId) : userId 
        }).sort({ createdAt: -1 }).toArray();
        
        const seenQuestionIds = new Set(userPerformance.map(p => p.questionId.toString()));

        // Group questions by LO
        const loGroups = {};
        enrichedQuestions.forEach(q => {
            const loId = q.learningObjectiveId?.toString() || "unassigned";
            if (!loGroups[loId]) loGroups[loId] = [];
            loGroups[loId].push(q);
        });

        const loIds = Object.keys(loGroups);
        if (loIds.length === 0) return [];

        // Phase 1 (New Material): Select exactly 1 question per LO, anchored at bottom Bloom
        const finalSelection = [];

        loIds.forEach(loId => {
            const candidates = [...loGroups[loId]];
            
            // Sort to find the lowest available Bloom level that is preferably unseen
            candidates.sort((a, b) => {
                // Primary: Lowest Bloom taxonomy index
                const aIdx = BLOOM_ORDER.indexOf(a.bloom);
                const bIdx = BLOOM_ORDER.indexOf(b.bloom);
                if (aIdx !== bIdx) return aIdx - bIdx;

                // Secondary: Prioritize questions the student has never seen
                const aSeen = seenQuestionIds.has(a._id.toString());
                const bSeen = seenQuestionIds.has(b._id.toString());
                if (aSeen !== bSeen) return aSeen ? 1 : -1;
                
                // Tertiary: Randomize selection amongst remaining identical weights
                return Math.random() - 0.5;
            });

            if (candidates.length > 0) {
                finalSelection.push(candidates[0]);
            }
        });

        // Inject dynamic student performance metadata for the UI
        finalSelection.forEach(q => {
            const currentLoId = q.learningObjectiveId?.toString();
            const currentBloom = q.bloom;
            
            if (!currentLoId) {
                q.userLevel = "No Prior History";
                return;
            }
            
            // Find performance records for this exact LO + Bloom
            const perfRecords = userPerformance.filter(p => 
                p.learningObjectiveId?.toString() === currentLoId && p.bloom === currentBloom
            );
            
            if (perfRecords.length === 0) {
                q.userLevel = "No Prior History";
            } else {
                const correctCount = perfRecords.filter(p => p.isCorrect).length;
                const totalCount = perfRecords.length;
                const accuracy = Math.round((correctCount / totalCount) * 100);
                q.userLevel = `${correctCount}/${totalCount} Correct (${accuracy}%)`;
            }
        });

        return finalSelection;
    } catch (error) {
        console.error("Error in getQuizQuestionsForStudent:", error);
        throw error;
    }
};

/**
 * Save student performance for a quiz question
 * @param {Object} performanceData - { userId, quizId, questionId, learningObjectiveId, granularObjectiveId, bloom, isCorrect }
 * @returns {Promise<Object>} The insert result
 */
const saveStudentPerformance = async (performanceData) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_student_performance");
        
        const data = {
            userId: ObjectId.isValid(performanceData.userId) ? new ObjectId(performanceData.userId) : performanceData.userId,
            quizId: ObjectId.isValid(performanceData.quizId) ? new ObjectId(performanceData.quizId) : performanceData.quizId,
            questionId: ObjectId.isValid(performanceData.questionId) ? new ObjectId(performanceData.questionId) : performanceData.questionId,
            learningObjectiveId: ObjectId.isValid(performanceData.learningObjectiveId) ? new ObjectId(performanceData.learningObjectiveId) : performanceData.learningObjectiveId,
            granularObjectiveId: ObjectId.isValid(performanceData.granularObjectiveId) ? new ObjectId(performanceData.granularObjectiveId) : performanceData.granularObjectiveId,
            bloom: performanceData.bloom,
            isCorrect: !!performanceData.isCorrect,
            createdAt: new Date()
        };
        
        const result = await collection.insertOne(data);
        return result;
    } catch (error) {
        console.error("Error saving student performance:", error);
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
    getQuizQuestionsForStudent,
    saveStudentPerformance,
    enrichQuestionsWithLO,
};

