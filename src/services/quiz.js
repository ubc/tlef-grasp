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
            questionLimit: quizData.questionLimit ? parseInt(quizData.questionLimit) : 0,
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

        if (quizData.questionLimit !== undefined) {
            updateData.questionLimit = quizData.questionLimit ? parseInt(quizData.questionLimit) : 0;
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

/**
 * Get personalized quiz questions for a student
 * @param {string} quizId - The quiz ID
 * @param {string} userId - The user ID
 * @returns {Promise<Array>} Array of selected questions
 */
const getQuizQuestionsForStudent = async (quizId, userId) => {
    try {
        const db = await databaseService.connect();
        const quiz = await getQuizById(quizId);
        if (!quiz) throw new Error("Quiz not found");

        const questionLimit = quiz.questionLimit || 10;
        
        // Get all approved questions
        const allQuestions = await getQuizQuestions(quizId, true);
        if (allQuestions.length === 0) return [];

        // Enrich questions with LO ID
        const enrichedQuestions = await enrichQuestionsWithLO(allQuestions);

        // Fetch student performance
        const performanceCollection = db.collection("grasp_student_performance");
        const userPerformance = await performanceCollection.find({ 
            userId: ObjectId.isValid(userId) ? new ObjectId(userId) : userId 
        }).sort({ createdAt: -1 }).toArray();

        // Group questions by LO
        const loGroups = {};
        enrichedQuestions.forEach(q => {
            const loId = q.learningObjectiveId?.toString() || "unassigned";
            if (!loGroups[loId]) loGroups[loId] = [];
            loGroups[loId].push(q);
        });

        const loIds = Object.keys(loGroups);
        if (loIds.length === 0) return [];

        // Determine target Bloom level for each LO based on performance
        const loTargetBloom = {};
        
        // Group LOs by their performance criteria
        const groups = { 
            step3: [], // 3 correct in last 3
            step2: [], // 2 correct in last 2
            step1: [], // 1 correct in last 1
            stepDown: [] // 2 wrong in last 2 AT SAME BLOOM LEVEL
        };

        loIds.forEach(loId => {
            const loPerf = userPerformance.filter(p => p.learningObjectiveId?.toString() === loId);
            const lastThree = loPerf.slice(0, 3);
            const lastTwo = loPerf.slice(0, 2);
            const lastOne = loPerf.slice(0, 1);
            
            if (lastThree.length === 3 && lastThree.every(p => p.isCorrect)) {
                groups.step3.push(loId);
            } else if (lastTwo.length === 2 && lastTwo.every(p => p.isCorrect)) {
                groups.step2.push(loId);
            } else if (lastOne.length === 1 && lastOne.every(p => p.isCorrect)) {
                groups.step1.push(loId);
            } else if (
                lastTwo.length === 2 && 
                lastTwo.every(p => !p.isCorrect) && 
                lastTwo[0].bloom === lastTwo[1].bloom
            ) {
                // If the last 2 attempts were both incorrect at the exact SAME taxonomy level, step down
                groups.stepDown.push(loId);
            }
            
            // Default target bloom anchors to their most recent attempt's level 
            // (allows continuous fluid movement up or down rather than getting stuck at an all-time high)
            let currentBloomIndex = 0;
            if (loPerf.length > 0) {
                const latestBloomIndex = BLOOM_ORDER.indexOf(loPerf[0].bloom);
                if (latestBloomIndex !== -1) {
                    currentBloomIndex = latestBloomIndex;
                }
            }
            loTargetBloom[loId] = { index: currentBloomIndex, stepUp: false, stepDown: false };
        });

        // Apply step-up probabilities to groups
        // 10% of 3-correct group
        groups.step3.filter(() => Math.random() < 0.10).forEach(id => loTargetBloom[id].stepUp = true);
        // 20% of 2-correct group
        groups.step2.filter(() => Math.random() < 0.20).forEach(id => loTargetBloom[id].stepUp = true);
        // 50% of 1-correct group
        groups.step1.filter(() => Math.random() < 0.50).forEach(id => loTargetBloom[id].stepUp = true);

        // Apply 100% step-down for 2-wrong group
        groups.stepDown.forEach(id => loTargetBloom[id].stepDown = true);

        // Finalize target bloom strings
        loIds.forEach(loId => {
            const { index, stepUp, stepDown } = loTargetBloom[loId];
            if (stepUp && index < BLOOM_ORDER.length - 1) {
                loTargetBloom[loId] = BLOOM_ORDER[index + 1];
            } else if (stepDown && index > 0) {
                loTargetBloom[loId] = BLOOM_ORDER[index - 1];
            } else {
                loTargetBloom[loId] = BLOOM_ORDER[index];
            }
        });

        // Identify questions from the most recent session
        // (A session is defined as all attempts sharing the same latest 'quizId' and 'createdAt' timestamp for this user)
        const lastSessionQuestionIds = new Set();
        if (userPerformance.length > 0) {
            const latestAttempt = userPerformance[0];
            // Questions taken in the same quiz session likely have the same or very close createdAt
            // For robustness, we'll take all questionIds from the very last attempt group
            const latestQuizId = latestAttempt.quizId.toString();
            const latestTime = latestAttempt.createdAt.getTime();
            
            // Allow 5 minutes window for a single session
            userPerformance.forEach(p => {
                const diff = Math.abs(p.createdAt.getTime() - latestTime);
                if (p.quizId.toString() === latestQuizId && diff < 5 * 60 * 1000) {
                    lastSessionQuestionIds.add(p.questionId.toString());
                }
            });
        }

        // Map most recent result for each combination of (LO + Bloom)
        const latestOutcomeByLoBloom = {};
        userPerformance.forEach(p => {
            if (!p.learningObjectiveId) return;
            const key = `${p.learningObjectiveId.toString()}_${p.bloom}`;
            if (latestOutcomeByLoBloom[key] === undefined) {
                latestOutcomeByLoBloom[key] = p.isCorrect;
            }
        });

        // Pick questions
        let selectedQuestions = [];
        const seenQuestionIds = new Set(userPerformance.map(p => p.questionId.toString()));

        loIds.forEach(loId => {
            // 1. Shuffle first to ensure random tie-breaking
            let candidates = [...loGroups[loId]].sort(() => Math.random() - 0.5);
            
            // 2. Sort candidates into 5 tiers based on the USER'S SPECIFIC REQUEST:
            // "previously wrong meaning the question in same learning objective and same bloom taxonomy was wrong in last quiz"
            // 1) Target Bloom + Never Seen (Unseen)
            // 2) Target Bloom + Previous (LO+Bloom) Wrong + Unseen (not in last session)
            // 3) Target Bloom + Previous (LO+Bloom) Wrong + Seen (in last session)
            // 4) Target Bloom + Previous (LO+Bloom) Correct + Unseen (not in last session)
            // 5) Target Bloom + Previous (LO+Bloom) Correct + Seen (in last session)
            candidates.sort((a, b) => {
                const aTarget = a.bloom === loTargetBloom[loId];
                const bTarget = b.bloom === loTargetBloom[loId];
                const aId = a._id.toString();
                const bId = b._id.toString();
                const aSeenEver = seenQuestionIds.has(aId);
                const bSeenEver = seenQuestionIds.has(bId);
                const aSeenLast = lastSessionQuestionIds.has(aId);
                const bSeenLast = lastSessionQuestionIds.has(bId);
                
                // Get the latest outcome for this question's specific LO + Bloom combination
                const aOutcomeKey = `${loId}_${a.bloom}`;
                const bOutcomeKey = `${loId}_${b.bloom}`;
                const aLatestCorrect = latestOutcomeByLoBloom[aOutcomeKey];
                const bLatestCorrect = latestOutcomeByLoBloom[bOutcomeKey];

                // Helper to get priority weight (lower is better, 0-4 for Target, 10-14 for Other)
                const getWeight = (isTarget, seenEver, lastCorrect, seenLast) => {
                    let base = isTarget ? 0 : 10;
                    if (!seenEver) return base + 0;                      // Tier 1: Never Seen
                    if (lastCorrect === false) return base + (seenLast ? 2 : 1); // Tier 2/3: Wrong
                    return base + (seenLast ? 4 : 3);                   // Tier 4/5: Correct
                };

                const aWeight = getWeight(aTarget, aSeenEver, aLatestCorrect, aSeenLast);
                const bWeight = getWeight(bTarget, bSeenEver, bLatestCorrect, bSeenLast);

                if (aWeight !== bWeight) return aWeight - bWeight;

                // Tie-breaker: Bloom distance
                const aIdx = BLOOM_ORDER.indexOf(a.bloom);
                const bIdx = BLOOM_ORDER.indexOf(b.bloom);
                const targetIdx = BLOOM_ORDER.indexOf(loTargetBloom[loId]);
                return Math.abs(aIdx - targetIdx) - Math.abs(bIdx - targetIdx);
            });

            // STRICT RETAKE Blacklist: Try to completely remove any question seen in the exact last session
            // so the student gets a truly fresh test permutation. Only fallback to including them if we
            // don't have enough unseen questions left in the bank for this LO.
            const unseenCandidates = candidates.filter(c => !lastSessionQuestionIds.has(c._id.toString()));
            // We want to try to guarantee at least 1 question per LO for equal distribution
            if (unseenCandidates.length > 0) {
                // We have enough unseen questions, use strict list!
                candidates = unseenCandidates;
            }

            // Tag each question with its LO for equal distribution logic below
            candidates.forEach(q => q.tempLoId = loId);
            selectedQuestions.push(...candidates);
        });

        // Equal distribution logic: round-robin through LOs until limit reached
        const finalSelection = [];
        const loQueues = loIds.map(id => selectedQuestions.filter(q => q.tempLoId === id));
        
        let loIdx = 0;
        while (finalSelection.length < questionLimit) {
            let found = false;
            // Try to find one from each LO in turn
            for (let i = 0; i < loIds.length; i++) {
                const currentLoQueue = loQueues[(loIdx + i) % loIds.length];
                if (currentLoQueue.length > 0) {
                    finalSelection.push(currentLoQueue.shift());
                    found = true;
                    if (finalSelection.length >= questionLimit) break;
                }
            }
            if (!found) break; // No more questions available
            loIdx = (loIdx + 1) % loIds.length;
        }

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

