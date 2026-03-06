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

        // Fetch student mastery records for selection logic
        const performanceCollection = db.collection("grasp_student_performance");
        const masteryRecords = await performanceCollection.find({ 
            userId: ObjectId.isValid(userId) ? new ObjectId(userId) : userId,
            courseId: quiz.courseId ? (ObjectId.isValid(quiz.courseId) ? new ObjectId(quiz.courseId) : quiz.courseId) : null
        }).toArray();
        
        // Fetch all attempts to identify seen questions (for diversity)
        const attemptCollection = db.collection("grasp_student_attempt");
        const userAttempts = await attemptCollection.find({
            userId: ObjectId.isValid(userId) ? new ObjectId(userId) : userId
        }).project({ questionId: 1 }).toArray();

        const seenQuestionIds = new Set(userAttempts.map(p => p.questionId.toString()));

        // --- Prep for Phase 3: Course History ---
        // Get all quizzes in the course sorted by releaseDate to calculate "sessions ago"
        const courseQuizzes = await db.collection("grasp_quiz").find({
            courseId: ObjectId.isValid(quiz.courseId) ? new ObjectId(quiz.courseId) : quiz.courseId
        }).sort({ releaseDate: 1 }).toArray();

        const currentQuizIdx = courseQuizzes.findIndex(q => q._id.toString() === quizId);
        const quizIndexMap = {};
        courseQuizzes.forEach((q, idx) => {
            quizIndexMap[q._id.toString()] = idx;
        });

        // Group questions by LO
        const loGroups = {};
        enrichedQuestions.forEach(q => {
            const loId = q.learningObjectiveId?.toString() || "unassigned";
            if (!loGroups[loId]) loGroups[loId] = [];
            loGroups[loId].push(q);
        });

        const loIds = Object.keys(loGroups);
        if (loIds.length === 0) return [];

        // --- Phase 1: New Material ---
        // Select exactly 1 question per LO mapped directly to this quiz, anchored at bottom Bloom
        const phase1Selection = [];

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
                phase1Selection.push(candidates[0]);
            }
        });

        // --- Phase 2: Review Incorrect ---
        // Simplified: Pull from the Mastery table for any LO flagged as 'needsRemediation'
        const phase2Selection = [];
        const remediationLOs = masteryRecords.filter(m => m.needsRemediation);
        
        if (remediationLOs.length > 0) {
            // We need to fetch questions from the database because Phase 2 pulls from *past* LOs
            // not necessarily assigned to this specific quiz.
            const extraQuestionsCollection = db.collection("grasp_question");
            const historicalQuestions = await extraQuestionsCollection.find({
                status: "Approved"
            }).toArray();
            
            const enrichedHistorical = await enrichQuestionsWithLO(historicalQuestions);
            const phase1QuestionIds = new Set(phase1Selection.map(q => q._id.toString()));

            remediationLOs.forEach(mastery => {
                const loId = mastery.learningObjectiveId?.toString() || mastery.granularObjectiveId?.toString();
                if (!loId) return;

                const targetBloom = mastery.remediationBloomLevel || "Remember";

                const candidates = enrichedHistorical.filter(q => 
                    (q.learningObjectiveId?.toString() === loId || q.granularObjectiveId?.toString() === loId) &&
                    !phase1QuestionIds.has(q._id.toString())
                );

                if (candidates.length > 0) {
                    // Sort candidates
                    candidates.sort((a, b) => {
                        // Priority 1: Match the remediation Bloom level
                        const aTarget = a.bloom === targetBloom;
                        const bTarget = b.bloom === targetBloom;
                        if (aTarget !== bTarget) return aTarget ? -1 : 1;

                        // Priority 2: Prioritize questions they've never seen
                        const aSeen = seenQuestionIds.has(a._id.toString());
                        const bSeen = seenQuestionIds.has(b._id.toString());
                        if (aSeen !== bSeen) return aSeen ? 1 : -1;
                        
                        return Math.random() - 0.5;
                    });

                    phase2Selection.push(candidates[0]);
                }
            });
        }

        // --- Phase 3: Spaced Review (A/B/C) ---
        // 1. Identify "Successfully Mastered" LOs (not in Phase 1 or Phase 2)
        const phase3Selection = [];
        const excludedLOIDs = new Set([
            ...phase1Selection.map(q => q.learningObjectiveId?.toString() || q.granularObjectiveId?.toString()),
            ...remediationLOs.map(m => m.learningObjectiveId?.toString() || m.granularObjectiveId?.toString())
        ]);

        const poolA = []; // 1 session ago
        const poolB = []; // 2-3 sessions ago
        const poolC = []; // 4+ sessions ago

        masteryRecords.forEach(mastery => {
            const loId = mastery.learningObjectiveId?.toString() || mastery.granularObjectiveId?.toString();
            if (!loId || excludedLOIDs.has(loId) || mastery.needsRemediation) return;

            const lastIdx = quizIndexMap[mastery.lastQuizIdSeen?.toString()];
            if (lastIdx === undefined) return;

            const distance = currentQuizIdx - lastIdx;
            if (distance === 1) poolA.push(mastery);
            else if (distance >= 2 && distance <= 3) poolB.push(mastery);
            else if (distance >= 4) poolC.push(mastery);
        });

        // 2. Deterministic Selection (50% / 20% / 10%)
        const selectCountA = Math.ceil(poolA.length * 0.5);
        const selectCountB = Math.ceil(poolB.length * 0.2);
        const selectCountC = Math.ceil(poolC.length * 0.1);

        const selectionConfig = [
            { pool: poolA, count: selectCountA },
            { pool: poolB, count: selectCountB },
            { pool: poolC, count: selectCountC }
        ];

        // 3. Select questions for each chosen Mastery record
        const extraQuestionsCollection = db.collection("grasp_question");
        const historicalQuestions = await extraQuestionsCollection.find({
            status: "Approved"
        }).toArray();
        const enrichedHistorical = await enrichQuestionsWithLO(historicalQuestions);

        const activeQuestionIds = new Set([
            ...phase1Selection.map(q => q._id.toString()),
            ...phase2Selection.map(q => q._id.toString())
        ]);

        for (const config of selectionConfig) {
            // Sort pool items randomly for deterministic choice of *which* 50/20/10% we take
            const selectedMasteries = config.pool
                .sort(() => Math.random() - 0.5)
                .slice(0, config.count);

            selectedMasteries.forEach(mastery => {
                const loId = mastery.learningObjectiveId?.toString() || mastery.granularObjectiveId?.toString();
                
                // Bloom Step-Up logic: Target the next level after highestBloomPassed
                const currentBloomIdx = BLOOM_ORDER.indexOf(mastery.highestBloomPassed || "Remember");
                const targetBloomIdx = Math.min(currentBloomIdx + 1, BLOOM_ORDER.length - 1);
                const targetBloom = BLOOM_ORDER[targetBloomIdx];

                const candidates = enrichedHistorical.filter(q => 
                    (q.learningObjectiveId?.toString() === loId || q.granularObjectiveId?.toString() === loId) &&
                    !activeQuestionIds.has(q._id.toString())
                );

                if (candidates.length > 0) {
                    candidates.sort((a, b) => {
                        // Priority 1: Match the target (higher) Bloom level
                        const aTarget = a.bloom === targetBloom;
                        const bTarget = b.bloom === targetBloom;
                        if (aTarget !== bTarget) return aTarget ? -1 : 1;

                        // Priority 2: Prefer unseen questions for variety
                        const aSeen = seenQuestionIds.has(a._id.toString());
                        const bSeen = seenQuestionIds.has(b._id.toString());
                        if (aSeen !== bSeen) return aSeen ? 1 : -1;

                        return Math.random() - 0.5;
                    });
                    
                    phase3Selection.push(candidates[0]);
                }
            });
        }

        // Combine Phase 1, Phase 2, and Phase 3
        const finalSelection = [...phase1Selection, ...phase2Selection, ...phase3Selection];

        // Inject dynamic student performance metadata for the UI using Mastery and Audit Log
        finalSelection.forEach(q => {
            const currentLoId = q.learningObjectiveId?.toString() || q.granularObjectiveId?.toString();
            
            if (!currentLoId) {
                q.userLevel = "No Prior History";
                return;
            }
            
            // Find mastery record
            const mastery = masteryRecords.find(m => 
                m.learningObjectiveId?.toString() === currentLoId || m.granularObjectiveId?.toString() === currentLoId
            );

            if (!mastery) {
                q.userLevel = "No Prior History";
            } else {
                q.userLevel = mastery.needsRemediation ? "⚠️ Needs Remediation" : "✅ Mastery: " + (mastery.highestBloomPassed || "Remember");
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
/**
 * Save student performance for a quiz question
 * Implements a dual-table architecture: 
 * 1. grasp_student_attempt (Audit) - Every single answer log
 * 2. grasp_student_performance (Mastery) - High-level student state per LO
 * 
 * @param {Object} performanceData - { userId, quizId, questionId, learningObjectiveId, granularObjectiveId, bloom, isCorrect }
 * @returns {Promise<Object>} The attempt log result
 */
const saveStudentPerformance = async (performanceData) => {
    try {
        const db = await databaseService.connect();
        const loIdentifier = performanceData.learningObjectiveId?.toString() || performanceData.granularObjectiveId?.toString();
        
        if (!loIdentifier) {
            console.warn("[Quiz Service] Attempt saved without LO identifier. Phase 2/3 will not track this.");
        }

        // Fetch quiz to get courseId (not passed from frontend)
        const quiz = await getQuizById(performanceData.quizId);
        const courseId = quiz ? quiz.courseId : null;

        // 1. Log the raw attempt to the Audit Table
        const attemptCollection = db.collection("grasp_student_attempt");
        const attemptData = {
            userId: ObjectId.isValid(performanceData.userId) ? new ObjectId(performanceData.userId) : performanceData.userId,
            courseId: courseId ? (ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId) : null,
            quizId: ObjectId.isValid(performanceData.quizId) ? new ObjectId(performanceData.quizId) : performanceData.quizId,
            questionId: ObjectId.isValid(performanceData.questionId) ? new ObjectId(performanceData.questionId) : performanceData.questionId,
            learningObjectiveId: performanceData.learningObjectiveId ? (ObjectId.isValid(performanceData.learningObjectiveId) ? new ObjectId(performanceData.learningObjectiveId) : performanceData.learningObjectiveId) : null,
            granularObjectiveId: performanceData.granularObjectiveId ? (ObjectId.isValid(performanceData.granularObjectiveId) ? new ObjectId(performanceData.granularObjectiveId) : performanceData.granularObjectiveId) : null,
            bloom: performanceData.bloom,
            isCorrect: !!performanceData.isCorrect,
            createdAt: new Date()
        };
        const attemptResult = await attemptCollection.insertOne(attemptData);

        // 2. Update the Mastery Table (grasp_student_performance)
        if (loIdentifier && courseId) {
            const performanceCollection = db.collection("grasp_student_performance");
            const userIdObj = ObjectId.isValid(performanceData.userId) ? new ObjectId(performanceData.userId) : performanceData.userId;
            
            // Define the query to find the unique Mastery record for this Student + LO
            const query = { 
                userId: userIdObj,
                courseId: ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId,
                learningObjectiveId: performanceData.learningObjectiveId ? (ObjectId.isValid(performanceData.learningObjectiveId) ? new ObjectId(performanceData.learningObjectiveId) : performanceData.learningObjectiveId) : null,
                // Only use granular index if it was the primary identifier provided
                ...(performanceData.granularObjectiveId && !performanceData.learningObjectiveId ? {
                    granularObjectiveId: ObjectId.isValid(performanceData.granularObjectiveId) ? new ObjectId(performanceData.granularObjectiveId) : performanceData.granularObjectiveId
                } : {})
            };

            const existingMastery = await performanceCollection.findOne(query);
            const quizIdStr = performanceData.quizId.toString();
            const isFirstAttemptInSession = !existingMastery || existingMastery.lastQuizIdSeen?.toString() !== quizIdStr;

            const updateFields = {
                $set: { 
                    lastQuizIdSeen: new ObjectId(quizIdStr),
                    updatedAt: new Date()
                }
            };

            // Rule 1: Remediation Status
            // Based strictly on the "First Attempt" of the LATEST quiz session.
            if (isFirstAttemptInSession) {
                // If this is the first encounter in a NEW quiz, set remediation state.
                updateFields.$set.needsRemediation = !performanceData.isCorrect;
                if (!performanceData.isCorrect) {
                  updateFields.$set.remediationBloomLevel = performanceData.bloom;
                }
            } else {
                // If it's a subsequent attempt in the SAME quiz, a failure "re-fails" them,
                // but a success doesn't necessarily clear it (stays failed if ANY question was missed).
                if (!performanceData.isCorrect) {
                  updateFields.$set.needsRemediation = true;
                  updateFields.$set.remediationBloomLevel = performanceData.bloom;
                }
            }

            // Rule 2: Bloom Mastery Progress
            // Only update highestBloomPassed if they GOT IT CORRECT.
            if (performanceData.isCorrect) {
                const currentBloomIdx = BLOOM_ORDER.indexOf(performanceData.bloom);
                const storedBloomIdx = existingMastery ? BLOOM_ORDER.indexOf(existingMastery.highestBloomPassed) : -1;
                
                if (currentBloomIdx > storedBloomIdx) {
                    updateFields.$set.highestBloomPassed = performanceData.bloom;
                }
            }

            await performanceCollection.updateOne(query, updateFields, { upsert: true });
        }

        return attemptResult;
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

