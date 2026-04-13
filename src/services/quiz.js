const { ObjectId } = require("mongodb");
const databaseService = require("./database");
const { BLOOM_LEVELS } = require("../constants/app-constants");

/**
 * Create a new quiz
 * @param {string} courseId - The ID of the course
 * @param {Object} quizData - { name, description, releaseDate, expireDate }
 * @returns {Promise<Object>} The created quiz object
 */
const createQuiz = async (courseId, quizData) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_quiz");
        
        // Quizzes are generally drafts on creation unless explicitly published
        const newQuiz = {
            courseId: ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId,
            name: quizData.name,
            description: quizData.description || "",
            published: false,
            // Only add dates if they are provided
            ...(quizData.releaseDate && { releaseDate: new Date(quizData.releaseDate) }),
            ...(quizData.expireDate && { expireDate: new Date(quizData.expireDate) }),
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        const result = await collection.insertOne(newQuiz);
        return { ...newQuiz, _id: result.insertedId };
    } catch (error) {
        console.error("Error creating quiz:", error);
        throw error;
    }
};

/**
 * Get all quizzes for a course
 * @param {string} courseId - The ID of the course
 * @returns {Promise<Array>} Array of quizzes
 */
const getQuizzesByCourse = async (courseId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_quiz");
        
        const quizzes = await collection.find({ 
            courseId: ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId 
        }).sort({ createdAt: -1 }).toArray();
        
        return quizzes;
    } catch (error) {
        console.error("Error fetching quizzes for course:", error);
        throw error;
    }
};

/**
 * Get a quiz by ID
 * @param {string} quizId - The ID of the quiz
 * @returns {Promise<Object|null>} The quiz object
 */
const getQuizById = async (quizId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_quiz");
        
        const quiz = await collection.findOne({ 
            _id: ObjectId.isValid(quizId) ? new ObjectId(quizId) : quizId 
        });
        
        return quiz;
    } catch (error) {
        console.error("Error fetching quiz by ID:", error);
        throw error;
    }
};

/**
 * Update a quiz
 * @param {string} quizId - The ID of the quiz
 * @param {Object} updateData - Data to update
 * @returns {Promise<Object>} The update result
 */
const updateQuiz = async (quizId, updateData) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_quiz");
        
        // Clean undefined values completely so we don't accidentally wipe existing DB fields
        const cleanUpdateData = Object.fromEntries(
            Object.entries(updateData)
                .filter(([_, value]) => value !== undefined)
                .map(([key, value]) => {
                    // Convert date strings to actual Date objects
                    if ((key === 'releaseDate' || key === 'expireDate') && value !== null) {
                        return [key, new Date(value)];
                    }
                    return [key, value];
                })
        );
        
        cleanUpdateData.updatedAt = new Date();
        
        const result = await collection.updateOne(
            { _id: ObjectId.isValid(quizId) ? new ObjectId(quizId) : quizId },
            { $set: cleanUpdateData }
        );
        
        return result;
    } catch (error) {
        console.error("Error updating quiz:", error);
        throw error;
    }
};

/**
 * Delete a quiz
 * @param {string} quizId - The ID of the quiz
 * @returns {Promise<Object>} The deletion result
 */
const deleteQuiz = async (quizId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_quiz");
        
        // First delete all question associations
        await db.collection("grasp_quiz_question").deleteMany({
            quizId: ObjectId.isValid(quizId) ? new ObjectId(quizId) : quizId
        });
        
        // Then delete the quiz itself
        const result = await collection.deleteOne({ 
            _id: ObjectId.isValid(quizId) ? new ObjectId(quizId) : quizId 
        });
        
        return result;
    } catch (error) {
        console.error("Error deleting quiz:", error);
        throw error;
    }
};

/**
 * Add questions to a quiz
 * @param {string} quizId - The ID of the quiz
 * @param {Array<string>} questionIds - Array of question IDs
 * @returns {Promise<Object>} The result
 */
const addQuestionsToQuiz = async (quizId, questionIds) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_quiz_question");
        
        const docs = questionIds.map(qId => ({
            quizId: ObjectId.isValid(quizId) ? new ObjectId(quizId) : quizId,
            questionId: ObjectId.isValid(qId) ? new ObjectId(qId) : qId,
            createdAt: new Date()
        }));
        
        if (docs.length > 0) {
            const result = await collection.insertMany(docs);
            return result;
        }
        return { insertedCount: 0 };
    } catch (error) {
        console.error("Error adding questions to quiz:", error);
        throw error;
    }
};

/**
 * Get all questions for a quiz (Instructors)
 * @param {string} quizId - The ID of the quiz
 * @param {boolean} approvedOnly - Whether to only return approved questions
 * @returns {Promise<Array>} Array of questions
 */
const getQuizQuestions = async (quizId, approvedOnly = false) => {
    try {
        const db = await databaseService.connect();
        
        // Step 1: Find all question mappings for this quiz
        const mappings = await db.collection("grasp_quiz_question").find({
            quizId: ObjectId.isValid(quizId) ? new ObjectId(quizId) : quizId
        }).toArray();

        if (mappings.length === 0) return [];
        
        // Extract all the question IDs assigned to this quiz
        const questionIds = mappings.map(m => m.questionId);

        // Step 2: Query the actual questions
        const query = {
            _id: { $in: questionIds }
        };
        
        if (approvedOnly) {
            query.status = "Approved";
        }
        
        const rawQuestions = await db.collection("grasp_question").find(query).toArray();
        return await enrichQuestionsWithLO(rawQuestions, db);
    } catch (error) {
        console.error("Error fetching quiz questions:", error);
        throw error;
    }
};

const BLOOM_ORDER = BLOOM_LEVELS;

/**
 * Helper: Enriches an array of questions with their parent Meta Learning Objective IDs
 * and human-readable names to satisfy the rest of the algorithm and UI constraints.
 */
const enrichQuestionsWithLO = async (questions) => {
    const db = await databaseService.connect();
    
    // Create maps for IDs and Names
    const granularToParentMap = {};
    const parentToNameMap = {};
    const granularToNameMap = {};

    // 1. Fetch names and hierarchies for all unique granular LOs
    const granularIds = questions.filter(q => q.granularObjectiveId).map(q => q.granularObjectiveId);
    if (granularIds.length > 0) {
        const granularObjectives = await db.collection("grasp_objective").find({ _id: { $in: granularIds } }).toArray();
        
        // Populate maps
        granularObjectives.forEach(obj => {
            granularToNameMap[obj._id.toString()] = obj.name;
            if (obj.parent) {
                granularToParentMap[obj._id.toString()] = obj.parent.toString();
            }
        });

        // 2. Fetch names for the unique parent (Meta) LOs discovered
        const parentIds = Array.from(new Set(Object.values(granularToParentMap))).map(id => new ObjectId(id));
        if (parentIds.length > 0) {
            const parentObjectives = await db.collection("grasp_objective").find({ _id: { $in: parentIds } }).toArray();
            parentObjectives.forEach(obj => {
                parentToNameMap[obj._id.toString()] = obj.name;
            });
        }
    }

    // Add learningObjectiveId where missing
    const enriched = questions.map(q => {
        if (!q.learningObjectiveId && q.granularObjectiveId) {
            const parentId = granularToParentMap[q.granularObjectiveId.toString()];
            if (parentId) q.learningObjectiveId = new ObjectId(parentId);
        }
        
        // Also add names for UI context
        if (q.learningObjectiveId && parentToNameMap[q.learningObjectiveId.toString()]) {
            q.learningObjectiveName = parentToNameMap[q.learningObjectiveId.toString()];
        }
        if (q.granularObjectiveId && granularToNameMap[q.granularObjectiveId.toString()]) {
            q.granularObjectiveName = granularToNameMap[q.granularObjectiveId.toString()];
        }
        return q;
    });

    return enriched;
};

/**
 * Phase 1: New Material Selection.
 * Iterates through all target Learning Objectives for the current quiz and picks exactly
 * 1 question per LO. Prioritizes the lowest available Bloom level and favors unseen questions.
 * 
 * @param {string|ObjectId} quizId - The ID of the current quiz.
 * @param {string|ObjectId} userId - The ID of the student.
 * @returns {Promise<Array>} An array of selected Phase 1 question objects.
 */
const getPhase1Questions = async (quizId, userId) => {
    const db = await databaseService.connect();
    const quiz = await getQuizById(quizId);
    if (!quiz) throw new Error("Quiz not found");

    const rawBankQuestions = await getQuizQuestions(quizId, true);
    if (!rawBankQuestions || rawBankQuestions.length === 0) return [];

    const bankQuestions = await enrichQuestionsWithLO(rawBankQuestions);

    const attemptCollection = db.collection("grasp_student_attempt");
    const userAttempts = await attemptCollection.find({
        userId: ObjectId.isValid(userId) ? new ObjectId(userId) : userId
    }).project({ questionId: 1 }).toArray();
    const seenQuestionIds = new Set(userAttempts.map(p => p.questionId.toString()));

    const loIds = [...new Set(bankQuestions.map(q => 
        q.learningObjectiveId?.toString() || q.granularObjectiveId?.toString()
    ).filter(Boolean))];

    const loGroups = {};
    bankQuestions.forEach(q => {
        const lo = q.learningObjectiveId?.toString() || q.granularObjectiveId?.toString();
        if (lo) {
            if (!loGroups[lo]) loGroups[lo] = [];
            loGroups[lo].push(q);
        }
    });

    const phase1Selection = [];

    loIds.forEach(lo => {
        const options = loGroups[lo];
        if (options && options.length > 0) {
            options.sort((a, b) => {
                const aBloomIdx = BLOOM_ORDER.indexOf(a.bloom);
                const bBloomIdx = BLOOM_ORDER.indexOf(b.bloom);
                
                // Priority 1: Pick Lowest Level Bloom 
                if (aBloomIdx !== bBloomIdx) return aBloomIdx - bBloomIdx;
                
                // Priority 2: Unseen Questions first!
                const aSeen = seenQuestionIds.has(a._id.toString());
                const bSeen = seenQuestionIds.has(b._id.toString());
                if (aSeen !== bSeen) return aSeen ? 1 : -1;
                
                // Priority 3: Tie breaker is purely math random
                return Math.random() - 0.5;
            });
            phase1Selection.push(options[0]);
        }
    });

    return phase1Selection;
};

/**
 * Phase 2: Remediation Selection.
 * Identifies the student's *immediate* previous quiz chronologically. Scans for any Learning
 * Objectives marked as failed (`needsRemediation: true`) during that specific past quiz.
 * Selects 1 question per failed LO, strictly drawing from the pool of questions associated with past quizzes,
 * prioritizing the exact Bloom level where the student previously struggled.
 * 
 * @param {string|ObjectId} quizId - The ID of the current quiz.
 * @param {string|ObjectId} userId - The ID of the student.
 * @returns {Promise<Array>} An array of selected Phase 2 (Remediation) question objects.
 */
const getPhase2Questions = async (quizId, userId) => {
    const db = await databaseService.connect();
    const quiz = await getQuizById(quizId);
    if (!quiz) throw new Error("Quiz not found");

    const performanceCollection = db.collection("grasp_student_performance");
    const masteryRecords = await performanceCollection.find({ 
        userId: ObjectId.isValid(userId) ? new ObjectId(userId) : userId,
        courseId: quiz.courseId ? (ObjectId.isValid(quiz.courseId) ? new ObjectId(quiz.courseId) : quiz.courseId) : null
    }).toArray();

    const courseQuizzes = await db.collection("grasp_quiz").find({
        courseId: quiz.courseId ? (ObjectId.isValid(quiz.courseId) ? new ObjectId(quiz.courseId) : quiz.courseId) : null
    }).sort({ releaseDate: 1 }).toArray();

    const currentQuizIdx = courseQuizzes.findIndex(q => q._id.toString() === quizId.toString());
    const historicalQuizIds = courseQuizzes.slice(0, currentQuizIdx).map(q => q._id.toString());

    if (historicalQuizIds.length === 0) return [];

    const historicalQuizObjectIds = historicalQuizIds.map(id => new ObjectId(id));
    const historicalMappings = await db.collection("grasp_quiz_question").find({
        quizId: { $in: historicalQuizObjectIds }
    }).toArray();
    
    const historicalQuestionIds = historicalMappings.map(mapping => mapping.questionId);
    if (historicalQuestionIds.length === 0) return [];

    const extraQuestionsCollection = db.collection("grasp_question");
    const historicalQuestionsQuery = { 
        status: "Approved",
        _id: { $in: historicalQuestionIds }
    };
    
    const historicalQuestions = await extraQuestionsCollection.find(historicalQuestionsQuery).toArray();
    const enrichedHistorical = await enrichQuestionsWithLO(historicalQuestions);

    // Identify LOs that appeared in previous quizzes
    const historicalLOIds = new Set();
    enrichedHistorical.forEach(q => {
        if (q.learningObjectiveId) historicalLOIds.add(q.learningObjectiveId.toString());
        if (q.granularObjectiveId) historicalLOIds.add(q.granularObjectiveId.toString());
    });

    const remediationLOs = masteryRecords.filter(m => {
        const loId = m.learningObjectiveId?.toString() || m.granularObjectiveId?.toString();
        return m.needsRemediation && loId && historicalLOIds.has(loId);
    });

    if (remediationLOs.length === 0) return [];

    const attemptCollection = db.collection("grasp_student_attempt");
    const userAttempts = await attemptCollection.find({
        userId: ObjectId.isValid(userId) ? new ObjectId(userId) : userId
    }).project({ questionId: 1 }).toArray();
    const seenQuestionIds = new Set(userAttempts.map(p => p.questionId.toString()));

    const phase2Selection = [];

    remediationLOs.forEach(mastery => {
        const loId = mastery.learningObjectiveId?.toString() || mastery.granularObjectiveId?.toString();
        if (!loId) return;
        
        const targetBloom = mastery.remediationBloomLevel || "Remember";
        
        const candidates = enrichedHistorical.filter(q => 
            q.learningObjectiveId?.toString() === loId || q.granularObjectiveId?.toString() === loId
        );
        
        if (candidates.length > 0) {
            candidates.sort((a, b) => {
                const aTarget = a.bloom === targetBloom;
                const bTarget = b.bloom === targetBloom;
                if (aTarget !== bTarget) return aTarget ? -1 : 1;
                
                const aSeen = seenQuestionIds.has(a._id.toString());
                const bSeen = seenQuestionIds.has(b._id.toString());
                if (aSeen !== bSeen) return aSeen ? 1 : -1;
                
                return Math.random() - 0.5;
            });
            phase2Selection.push(candidates[0]);
        }
    });
    
    return phase2Selection;
};

/**
 * Phase 3: Spaced Review Selection.
 * Implements a spaced repetition schedule for previously mastered learning objectives.
 * Categorizes historical mastery into pools based on Frequency `timesCorrect`
 * (Pool A: 1 pass, Pool B: 2 passes, Pool C: 3+ passes) and probabilistically selects 
 * questions (50%, 20%, 10%). Applies "Bloom Step-up" logic to test the NEXT highest 
 * required cognitive level compared to the student's previously passed level.
 * 
 * @param {string|ObjectId} quizId - The ID of the current quiz.
 * @param {string|ObjectId} userId - The ID of the student.
 * @returns {Promise<Array>} An array of selected Phase 3 (Spaced Review) question objects.
 */
const getPhase3Questions = async (quizId, userId) => {
    const db = await databaseService.connect();
    const quiz = await getQuizById(quizId);
    if (!quiz) throw new Error("Quiz not found");

    const performanceCollection = db.collection("grasp_student_performance");
    const masteryRecords = await performanceCollection.find({ 
        userId: ObjectId.isValid(userId) ? new ObjectId(userId) : userId,
        courseId: quiz.courseId ? (ObjectId.isValid(quiz.courseId) ? new ObjectId(quiz.courseId) : quiz.courseId) : null
    }).toArray();

    const courseQuizzes = await db.collection("grasp_quiz").find({
        courseId: quiz.courseId ? (ObjectId.isValid(quiz.courseId) ? new ObjectId(quiz.courseId) : quiz.courseId) : null
    }).sort({ releaseDate: 1 }).toArray();

    const currentQuizIdx = courseQuizzes.findIndex(q => q._id.toString() === quizId.toString());
    
    // If this is Quiz 1, there are no previous quizzes, thus no Spaced Review is possible yet
    if (currentQuizIdx <= 0) return [];

    // Isolate quizzes that came strictly BEFORE the current quiz
    const previousQuizzes = courseQuizzes.slice(0, currentQuizIdx);
    const previousQuizIds = previousQuizzes.map(q => q._id);

    // Find all questions associated with these strictly previous quizzes
    const previousQuizQuestionMappings = await db.collection("grasp_quiz_question").find({
        quizId: { $in: previousQuizIds }
    }).toArray();
    
    const validPhase3QuestionIds = previousQuizQuestionMappings.map(mapping => mapping.questionId);
    if (validPhase3QuestionIds.length === 0) return [];

    const extraQuestionsCollection = db.collection("grasp_question");
    const historicalQuestions = await extraQuestionsCollection.find({ 
        status: "Approved",
        _id: { $in: validPhase3QuestionIds }
    }).toArray();
    const enrichedHistorical = await enrichQuestionsWithLO(historicalQuestions);

    const attemptCollection = db.collection("grasp_student_attempt");
    const userAttempts = await attemptCollection.find({
        userId: ObjectId.isValid(userId) ? new ObjectId(userId) : userId
    }).project({ questionId: 1 }).toArray();
    const seenQuestionIds = new Set(userAttempts.map(p => p.questionId.toString()));

    const phase3Selection = [];
    const poolA = []; // Gotten correct 1 time
    const poolB = []; // Gotten correct 2 times
    const poolC = []; // Gotten correct 3+ times

    // Identify LOs that appeared in previous quizzes
    const historicalLOIds = new Set();
    enrichedHistorical.forEach(q => {
        if (q.learningObjectiveId) historicalLOIds.add(q.learningObjectiveId.toString());
        if (q.granularObjectiveId) historicalLOIds.add(q.granularObjectiveId.toString());
    });

    // Categorize established mastery into frequency pools
    masteryRecords.forEach(mastery => {
        const loIdentifier = mastery.learningObjectiveId?.toString() || mastery.granularObjectiveId?.toString();
        if (!loIdentifier || mastery.needsRemediation) return;

        // Strictly check that this LO existed in a previous quiz
        if (!historicalLOIds.has(loIdentifier)) return;

        const timesCorrect = mastery.timesCorrect || 0;
        
        if (timesCorrect === 1) poolA.push(mastery);
        else if (timesCorrect === 2) poolB.push(mastery);
        else if (timesCorrect >= 3) poolC.push(mastery);
    });

    const selectCountA = Math.ceil(poolA.length * 0.5);
    const selectCountB = Math.ceil(poolB.length * 0.2);
    const selectCountC = Math.ceil(poolC.length * 0.1);

    const selectionConfig = [
        { pool: poolA, count: selectCountA },
        { pool: poolB, count: selectCountB },
        { pool: poolC, count: selectCountC }
    ];

    for (const config of selectionConfig) {
        const selectedMasteries = config.pool
            .sort(() => Math.random() - 0.5)
            .slice(0, config.count);

        selectedMasteries.forEach(mastery => {
            const loId = mastery.learningObjectiveId?.toString() || mastery.granularObjectiveId?.toString();
            
            const currentBloomIdx = BLOOM_ORDER.indexOf(mastery.highestBloomPassed || "Remember");
            let targetBloomIdx = currentBloomIdx + 1;
            
            if (targetBloomIdx >= BLOOM_ORDER.length) targetBloomIdx = BLOOM_ORDER.length - 1;

            const candidates = enrichedHistorical.filter(q => 
                (q.learningObjectiveId?.toString() === loId || q.granularObjectiveId?.toString() === loId) &&
                BLOOM_ORDER.indexOf(q.bloom) <= targetBloomIdx
            );

            if (candidates.length > 0) {
                candidates.sort((a, b) => {
                    const aBloomIdx = BLOOM_ORDER.indexOf(a.bloom);
                    const bBloomIdx = BLOOM_ORDER.indexOf(b.bloom);
                    
                    if (aBloomIdx !== bBloomIdx) return bBloomIdx - aBloomIdx; // Descending
                    
                    const aSeen = seenQuestionIds.has(a._id.toString());
                    const bSeen = seenQuestionIds.has(b._id.toString());
                    if (aSeen !== bSeen) return aSeen ? 1 : -1;
                    
                    return Math.random() - 0.5;
                });
                
                phase3Selection.push(candidates[0]);
            }
        });
    }

    return phase3Selection;
};

/**
 * Orchestrator logic that fetches questions for a student view of a quiz.
 * Follows the 3-Phase Spaced Repetition process:
 * 1. New Material (1 item per valid Course LO assigned to this quiz)
 * 2. Remediation (Items failed in immediate previous quiz from student mastery)
 * 3. Spaced Review (Pool logic testing previous positive mastery instances)
 * 
 * @param {string} quizId 
 * @param {string} userId
 */
const getQuizQuestionsForStudent = async (quizId, userId) => {
    try {
        const db = await databaseService.connect();
        const quiz = await getQuizById(quizId);
        
        if (!quiz) throw new Error("Quiz not found");

        const phase1SelectionRaw = (await getPhase1Questions(quizId, userId)).map(q => ({ ...q, phase: 1 }));
        const phase2SelectionRaw = (await getPhase2Questions(quizId, userId)).map(q => ({ ...q, phase: 2 }));
        const phase3SelectionRaw = (await getPhase3Questions(quizId, userId)).map(q => ({ ...q, phase: 3 }));

        const finalSelection = [...phase1SelectionRaw];
        const selectedQuestionIds = new Set(phase1SelectionRaw.map(q => q._id.toString()));
        const selectedLOIds = new Set(phase1SelectionRaw.map(q => q.learningObjectiveId?.toString() || q.granularObjectiveId?.toString()));

        phase2SelectionRaw.forEach(q => {
            if (!selectedQuestionIds.has(q._id.toString())) {
                finalSelection.push(q);
                selectedQuestionIds.add(q._id.toString());
                selectedLOIds.add(q.learningObjectiveId?.toString() || q.granularObjectiveId?.toString());
            }
        });

        phase3SelectionRaw.forEach(q => {
            const loId = q.learningObjectiveId?.toString() || q.granularObjectiveId?.toString();
            // Spaced review strictly shouldn't cover an LO that was already tested in Phase 1 or 2 in this session
            if (!selectedLOIds.has(loId)) {
                finalSelection.push(q);
                selectedQuestionIds.add(q._id.toString());
                selectedLOIds.add(loId);
            }
        });

        const performanceCollection = db.collection("grasp_student_performance");
        const masteryRecords = await performanceCollection.find({ 
            userId: ObjectId.isValid(userId) ? new ObjectId(userId) : userId,
            courseId: quiz.courseId ? (ObjectId.isValid(quiz.courseId) ? new ObjectId(quiz.courseId) : quiz.courseId) : null
        }).toArray();

        finalSelection.forEach(q => {
            const currentLoId = q.learningObjectiveId?.toString() || q.granularObjectiveId?.toString();
            
            if (!currentLoId) {
                q.userLevel = "No Prior History";
                return;
            }
            
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
 * Implements a dual-table architecture: 
 * 1. grasp_student_attempt (Audit) - Every single answer log
 * 2. grasp_student_performance (Mastery) - High-level student state per LO
 * 
 * @param {Object} performanceData
 * @returns {Promise<Object>} The attempt log result
 */
const saveStudentPerformance = async (performanceData) => {
    try {
        const db = await databaseService.connect();
        const loIdentifier = performanceData.learningObjectiveId?.toString() || performanceData.granularObjectiveId?.toString();
        
        if (!loIdentifier) {
            console.warn("[Quiz Service] Attempt saved without LO identifier. Phase 2/3 will not track this.");
        }

        const quiz = await getQuizById(performanceData.quizId);
        const courseId = quiz ? quiz.courseId : null;

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
            selectedAnswer: performanceData.selectedAnswer || null,
            correctAnswer: performanceData.correctAnswer || null,
            isFirstAttempt: performanceData.isFirstAttempt !== undefined ? performanceData.isFirstAttempt : true,
            createdAt: new Date()
        };
        const attemptResult = await attemptCollection.insertOne(attemptData);

        if (loIdentifier && courseId) {
            const performanceCollection = db.collection("grasp_student_performance");
            const userIdObj = ObjectId.isValid(performanceData.userId) ? new ObjectId(performanceData.userId) : performanceData.userId;
            const quizIdObj = ObjectId.isValid(performanceData.quizId) ? new ObjectId(performanceData.quizId) : performanceData.quizId;

            // CRITICAL: Check if this is a retake. 
            // If a score already exists for this User + Quiz, it is a retake.
            // Retakes SHOULD record attempts (audit) but NOT update permanent mastery records.
            const existingScore = await db.collection("grasp_quiz_score").findOne({ 
                userId: userIdObj, 
                quizId: quizIdObj 
            });

            if (existingScore) {
                console.log(`[Quiz Service] Retake detected for user ${performanceData.userId} on quiz ${performanceData.quizId}. Skipping mastery updates.`);
                return attemptResult;
            }
            
            const query = { 
                userId: userIdObj,
                courseId: ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId,
                learningObjectiveId: performanceData.learningObjectiveId ? (ObjectId.isValid(performanceData.learningObjectiveId) ? new ObjectId(performanceData.learningObjectiveId) : performanceData.learningObjectiveId) : null,
                ...(performanceData.granularObjectiveId && !performanceData.learningObjectiveId ? {
                    granularObjectiveId: ObjectId.isValid(performanceData.granularObjectiveId) ? new ObjectId(performanceData.granularObjectiveId) : performanceData.granularObjectiveId
                } : {})
            };

            const existingMastery = await performanceCollection.findOne(query);
            const quizIdStr = performanceData.quizId.toString();
            const isFirstAttemptInSession = !existingMastery || existingMastery.lastQuizIdSeen?.toString() !== quizIdStr;

            if (isFirstAttemptInSession) {
                const updateFields = {
                    $set: { 
                        lastQuizIdSeen: new ObjectId(quizIdStr),
                        updatedAt: new Date(),
                        needsRemediation: !performanceData.isCorrect
                    }
                };

                // Rule 1: Remediation & Frequency
                if (!performanceData.isCorrect) {
                  updateFields.$set.remediationBloomLevel = performanceData.bloom;
                  updateFields.$set.timesCorrect = 0;
                } else {
                  if (!updateFields.$inc) updateFields.$inc = {};
                  updateFields.$inc.timesCorrect = 1;
                }

                // Rule 2: Bloom Mastery Progress (Internal to first-encounter only)
                if (performanceData.isCorrect) {
                    const currentBloomIdx = BLOOM_ORDER.indexOf(performanceData.bloom);
                    const storedBloomIdx = existingMastery ? BLOOM_ORDER.indexOf(existingMastery.highestBloomPassed) : -1;
                    
                    if (currentBloomIdx > storedBloomIdx) {
                        updateFields.$set.highestBloomPassed = performanceData.bloom;
                    }
                }

                await performanceCollection.updateOne(query, updateFields, { upsert: true });
            }
        }

        return attemptResult;
    } catch (error) {
        console.error("Error saving student performance:", error);
        throw error;
    }
};

/**
 * Save quiz score for a student (First attempt only)
 * 
 * @param {Object} scoreData - { userId, quizId, courseId, score, correctAnswers, totalQuestions, timeSpent }
 * @returns {Promise<Object|null>} The insertion result or null if it was not the first attempt
 */
const saveQuizScore = async (scoreData) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_quiz_score");
        
        const doc = {
            userId: ObjectId.isValid(scoreData.userId) ? new ObjectId(scoreData.userId) : scoreData.userId,
            quizId: ObjectId.isValid(scoreData.quizId) ? new ObjectId(scoreData.quizId) : scoreData.quizId,
            courseId: scoreData.courseId ? (ObjectId.isValid(scoreData.courseId) ? new ObjectId(scoreData.courseId) : scoreData.courseId) : null,
            score: Number(scoreData.score),
            correctAnswers: Number(scoreData.correctAnswers),
            totalQuestions: Number(scoreData.totalQuestions),
            timeSpent: scoreData.timeSpent,
            completedAt: new Date(),
            createdAt: new Date()
        };
        
        const result = await collection.insertOne(doc);
        return result;
    } catch (error) {
        // Handle duplicate key error (11000) - indicates a subsequent attempt
        if (error.code === 11000) {
            console.log(`[Quiz Service] Score for user ${scoreData.userId} on quiz ${scoreData.quizId} already exists. Skipping first-attempt-only record.`);
            return null;
        }
        console.error("Error saving quiz score:", error);
        throw error;
    }
};

/**
 * Get all scores for a quiz with student info (Instructors only)
 * 
 * @param {string} quizId - The ID of the quiz
 * @returns {Promise<Array>} Array of score objects with student details attached
 */
const getQuizScores = async (quizId) => {
    try {
        const db = await databaseService.connect();
        
        // 1. Get the quiz to find the course
        const quiz = await getQuizById(quizId);
        if (!quiz) return [];
        
        // 2. Get all users in the course
        const { getCourseUsers } = require('./user-course');
        const courseUsers = await getCourseUsers(quiz.courseId);
        
        // Filter out instructors/staff to get only students
        const studentsInCourse = courseUsers.filter(userCourse => {
            if (!userCourse.affiliation) return false;
            
            const affiliations = Array.isArray(userCourse.affiliation)
                ? userCourse.affiliation
                : String(userCourse.affiliation).split(',').map(a => a.trim());
            
            const hasStudent = affiliations.includes('student') || affiliations.includes('affiliate');
            const hasStaff = affiliations.includes('staff');
            const hasFaculty = affiliations.includes('faculty');
            
            return hasStudent && !hasStaff && !hasFaculty;
        });
        
        // 3. Get all quiz scores for this quiz
        const scores = await db.collection("grasp_quiz_score").find({
            quizId: ObjectId.isValid(quizId) ? new ObjectId(quizId) : quizId
        }).toArray();
        
        // 4. Map students to their scores
        const result = studentsInCourse.map(student => {
            const userStrId = student.userId.toString();
            const scoreRecord = scores.find(s => s.userId.toString() === userStrId);
            
            return {
                _id: scoreRecord ? scoreRecord._id : null,
                userId: student.userId,
                score: scoreRecord ? scoreRecord.score : null,
                correctAnswers: scoreRecord ? scoreRecord.correctAnswers : null,
                totalQuestions: scoreRecord ? scoreRecord.totalQuestions : null,
                timeSpent: scoreRecord ? scoreRecord.timeSpent : null,
                completedAt: scoreRecord ? scoreRecord.completedAt : null,
                studentName: student.displayName || student.username || 'Unknown Student',
                studentEmail: student.email || '-'
            };
        });
        
        // Sort: completed scores first (descending), then not taken, alphabetized by name
        result.sort((a, b) => {
            if (a.completedAt && !b.completedAt) return -1;
            if (!a.completedAt && b.completedAt) return 1;
            if (a.completedAt && b.completedAt) {
                return new Date(b.completedAt) - new Date(a.completedAt);
            }
            return a.studentName.localeCompare(b.studentName);
        });
        
        return result;
    } catch (error) {
        console.error("Error fetching quiz scores:", error);
        throw error;
    }
};

/**
 * Get detailed student attempt for a review interface
 * @param {string} quizId 
 * @param {string} userId 
 * @returns {Promise<Array>} Array of detailed question responses
 */
const getStudentQuizAttempt = async (quizId, userId) => {
    try {
        const db = await databaseService.connect();
        
        const attemptCollection = db.collection("grasp_student_attempt");
        const query = {
            quizId: ObjectId.isValid(quizId) ? new ObjectId(quizId) : quizId,
            userId: ObjectId.isValid(userId) ? new ObjectId(userId) : userId,
            isFirstAttempt: { $ne: false } // Catch older records before this field existed
        };
        
        const attempts = await attemptCollection.find(query).toArray();
        if (!attempts || attempts.length === 0) return [];

        const questionIds = attempts.map(a => a.questionId);
        const questionsCollection = db.collection("grasp_question");
        const questions = await questionsCollection.find({
            _id: { $in: questionIds }
        }).toArray();

        // Create map for easy lookup
        const questionMap = {};
        questions.forEach(q => {
            questionMap[q._id.toString()] = q;
        });

        // Combine
        return attempts.map(attempt => {
            const questionData = questionMap[attempt.questionId.toString()];
            if (!questionData) return null;

            return {
                attemptId: attempt._id,
                questionId: questionData._id,
                questionText: questionData.title || questionData.stem || "Unknown Question",
                options: questionData.options || {},
                selectedAnswer: attempt.selectedAnswer,
                correctAnswer: attempt.correctAnswer || questionData.correctAnswer,
                isCorrect: attempt.isCorrect,
                bloom: attempt.bloom,
                createdAt: attempt.createdAt
            };
        }).filter(a => a !== null);
    } catch (error) {
        console.error("Error fetching student quiz attempt:", error);
        throw error;
    }
};

/**
 * Get all scores for a specific user in a course
 * @param {string} userId 
 * @param {string} courseId 
 * @returns {Promise<Array>} Array of quiz IDs the user has completed
 */
const getUserScoresForCourse = async (userId, courseId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_quiz_score");
        
        const query = {
            userId: ObjectId.isValid(userId) ? new ObjectId(userId) : userId,
            courseId: ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId
        };
        
        const scores = await collection.find(query).toArray();
        return scores.map(s => s.quizId.toString());
    } catch (error) {
        console.error("Error fetching user scores for course:", error);
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
    saveQuizScore,
    enrichQuestionsWithLO,
    getPhase1Questions,
    getPhase2Questions,
    getPhase3Questions,
    getQuizScores,
    getStudentQuizAttempt,
    getUserScoresForCourse
};
