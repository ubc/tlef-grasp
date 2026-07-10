const databaseService = require('./database');
const { QUESTION_TYPES } = require('../constants/app-constants');
const CalculationQuestion = require('../models/questions/CalculationQuestion');
const { deleteImages, collectQuestionImageIds } = require('./image');
const { ObjectId } = require('mongodb');

const MAX_IMAGE_CAPTION_LENGTH = 300;

/**
 * Validate and whitelist an instructor-attached image reference before it is
 * persisted on a question. Returns null for anything malformed. The instructor
 * caption doubles as the image's alt text (`alt` is read for legacy refs).
 */
const sanitizeImageRef = (ref) => {
    if (!ref || typeof ref !== "object") return null;
    if (typeof ref.fileId !== "string" || !ObjectId.isValid(ref.fileId)) return null;

    const rawCaption =
        typeof ref.caption === "string"
            ? ref.caption
            : typeof ref.alt === "string"
              ? ref.alt
              : "";

    return {
        fileId: ref.fileId,
        filename: typeof ref.filename === "string" ? ref.filename : "",
        mimeType: typeof ref.mimeType === "string" ? ref.mimeType : "",
        size: Number.isFinite(ref.size) ? ref.size : 0,
        caption: rawCaption.slice(0, MAX_IMAGE_CAPTION_LENGTH),
    };
};

/**
 * Normalize a stem-image value (array, single ref, or legacy `stemImage`)
 * into a clean array of validated refs.
 */
const sanitizeImageRefArray = (value) => {
    const arr = Array.isArray(value) ? value : value ? [value] : [];
    return arr.map(sanitizeImageRef).filter(Boolean);
};

/**
 * Strip any per-option `image` field — images are only attached to the
 * question stem now, not to individual options. Legacy option images are
 * dropped on the next save.
 */
const sanitizeOptions = (options) => {
    if (!options || typeof options !== "object" || Array.isArray(options)) return options;

    const sanitized = {};
    for (const key of Object.keys(options)) {
        const option = options[key];
        if (option && typeof option === "object" && !Array.isArray(option)) {
            const { image, ...rest } = option;
            sanitized[key] = rest;
        } else {
            sanitized[key] = option;
        }
    }
    return sanitized;
};

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
        
        const questionType =
            questionData.questionType ||
            questionData.type ||
            QUESTION_TYPES.MULTIPLE_CHOICE;

        if (String(questionType).toLowerCase() === QUESTION_TYPES.CALCULATION) {
            CalculationQuestion.validateFormulaAgainstVariableSpecs(
                typeof questionData.calculationFormula === "string"
                    ? questionData.calculationFormula
                    : "",
                Array.isArray(questionData.calculationVariables)
                    ? questionData.calculationVariables
                    : []
            );
        }

        // Save the full question data including granularObjectiveId
        const answerDecRaw = questionData.calculationAnswerDecimals;
        const calculationAnswerDecimals =
            answerDecRaw !== undefined && answerDecRaw !== null && answerDecRaw !== ""
                ? Math.max(0, Math.min(12, parseInt(answerDecRaw, 10) || 2))
                : 2;

        const tolRaw = questionData.calculationAnswerTolerancePercent;
        const calculationAnswerTolerancePercent =
            tolRaw !== undefined && tolRaw !== null && tolRaw !== ""
                ? Math.max(0, Math.min(100, parseFloat(tolRaw) || 0))
                : null;

        const calcVarsForStore = Array.isArray(questionData.calculationVariables)
            ? questionData.calculationVariables
            : [];
        const calcFormulaRaw =
            typeof questionData.calculationFormula === "string"
                ? questionData.calculationFormula
                : "";

        const qtLower = String(questionType).toLowerCase();
        const question = await collection.insertOne({
            title: questionData.title,
            stem: questionData.stem,
            stemImages: sanitizeImageRefArray(questionData.stemImages ?? questionData.stemImage),
            options: sanitizeOptions(questionData.options),
            correctAnswer: questionData.correctAnswer,
            questionType,
            acceptableAnswers: Array.isArray(questionData.acceptableAnswers)
                ? questionData.acceptableAnswers
                : [],
            openEndedSampleAnswer:
                qtLower === QUESTION_TYPES.OPEN_ENDED
                    ? String(questionData.openEndedSampleAnswer || "").trim()
                    : "",
            openEndedGradingCriteria:
                qtLower === QUESTION_TYPES.OPEN_ENDED
                    ? String(questionData.openEndedGradingCriteria || "").trim()
                    : "",
            calculationFormula:
                qtLower === QUESTION_TYPES.CALCULATION
                    ? CalculationQuestion.prepareCalculationFormula(
                          calcFormulaRaw,
                          calcVarsForStore
                      )
                    : calcFormulaRaw,
            calculationVariables: calcVarsForStore,
            calculationAnswerDecimals,
            calculationAnswerTolerancePercent,
            bloom: questionData.bloom,
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
        if (updateData.stemImages !== undefined || updateData.stemImage !== undefined) {
            update.stemImages = sanitizeImageRefArray(updateData.stemImages ?? updateData.stemImage);
            // Clear any legacy single-image field so it can't shadow the array.
            update.stemImage = null;
        }
        if (updateData.options !== undefined) update.options = sanitizeOptions(updateData.options);
        if (updateData.correctAnswer !== undefined) update.correctAnswer = updateData.correctAnswer;
        if (updateData.bloom !== undefined) update.bloom = updateData.bloom;

        if (updateData.status !== undefined) update.status = updateData.status;
        if (updateData.flagStatus !== undefined) update.flagStatus = updateData.flagStatus;
        if (updateData.questionType !== undefined) update.questionType = updateData.questionType;
        if (updateData.type !== undefined && updateData.questionType === undefined) {
            update.questionType = updateData.type;
        }
        if (updateData.acceptableAnswers !== undefined) {
            update.acceptableAnswers = Array.isArray(updateData.acceptableAnswers)
                ? updateData.acceptableAnswers
                : [];
        }
        if (updateData.calculationFormula !== undefined) {
            update.calculationFormula =
                typeof updateData.calculationFormula === "string" ? updateData.calculationFormula : "";
        }
        if (updateData.calculationVariables !== undefined) {
            update.calculationVariables = Array.isArray(updateData.calculationVariables)
                ? updateData.calculationVariables
                : [];
        }
        if (updateData.calculationAnswerDecimals !== undefined) {
            const d = parseInt(updateData.calculationAnswerDecimals, 10);
            update.calculationAnswerDecimals = Math.max(0, Math.min(12, Number.isFinite(d) ? d : 2));
        }
        if (updateData.calculationAnswerTolerancePercent !== undefined) {
            const t = parseFloat(updateData.calculationAnswerTolerancePercent);
            update.calculationAnswerTolerancePercent = (updateData.calculationAnswerTolerancePercent === null ||
                updateData.calculationAnswerTolerancePercent === "" ||
                !Number.isFinite(t))
                ? null
                : Math.max(0, Math.min(100, t));
        }
        if (updateData.openEndedSampleAnswer !== undefined) {
            update.openEndedSampleAnswer =
                typeof updateData.openEndedSampleAnswer === "string"
                    ? updateData.openEndedSampleAnswer.trim()
                    : "";
        }
        if (updateData.openEndedGradingCriteria !== undefined) {
            update.openEndedGradingCriteria =
                typeof updateData.openEndedGradingCriteria === "string"
                    ? updateData.openEndedGradingCriteria.trim()
                    : "";
        }
        if (updateData.granularObjectiveId !== undefined) {
            // Convert granularObjectiveId to ObjectId if it's a string
            update.granularObjectiveId = updateData.granularObjectiveId 
                ? (ObjectId.isValid(updateData.granularObjectiveId) 
                    ? new ObjectId(updateData.granularObjectiveId) 
                    : updateData.granularObjectiveId)
                : null;
        }

        const touchesCalculation =
            update.calculationFormula !== undefined ||
            update.calculationVariables !== undefined ||
            update.questionType !== undefined;
        const touchesImages =
            update.stemImages !== undefined || update.options !== undefined;

        // Fetch the existing doc once when either validation path needs it.
        const existing = (touchesCalculation || touchesImages)
            ? await collection.findOne({ _id: id })
            : null;

        if (touchesCalculation) {
            if (existing) {
                const merged = { ...existing, ...update };
                const qt = String(merged.questionType || merged.type || "")
                    .trim()
                    .toLowerCase();
                if (qt === QUESTION_TYPES.CALCULATION) {
                    const mergedFormula =
                        typeof merged.calculationFormula === "string"
                            ? merged.calculationFormula
                            : "";
                    const mergedVars = Array.isArray(merged.calculationVariables)
                        ? merged.calculationVariables
                        : [];
                    CalculationQuestion.validateFormulaAgainstVariableSpecs(
                        mergedFormula,
                        mergedVars
                    );
                    update.calculationFormula =
                        CalculationQuestion.prepareCalculationFormula(
                            mergedFormula,
                            mergedVars
                        );
                }
            }
        }
        
        const result = await collection.updateOne(
            { _id: id },
            { $set: update }
        );

        // Best-effort GridFS cleanup for images this update removed/replaced.
        if (touchesImages && existing && result.acknowledged) {
            const oldIds = collectQuestionImageIds(existing);
            const newIds = new Set(collectQuestionImageIds({ ...existing, ...update }));
            const removedIds = oldIds.filter((fileId) => !newIds.has(fileId));
            if (removedIds.length > 0) {
                await deleteImages(removedIds);
            }
        }

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
        const relationshipCollection = db.collection("grasp_quiz_question");
        
        // Convert questionId to ObjectId if it's a string
        const id = ObjectId.isValid(questionId) ? new ObjectId(questionId) : questionId;

        // Grab the doc first so its attached images can be cleaned up after.
        const existing = await collection.findOne({ _id: id });

        // Delete all quiz-question relationships for this question
        await relationshipCollection.deleteMany({ questionId: id });

        // Delete the question
        const result = await collection.deleteOne({ _id: id });

        // Best-effort GridFS cleanup of the question's attached images.
        if (existing && result.deletedCount > 0) {
            const imageIds = collectQuestionImageIds(existing);
            if (imageIds.length > 0) {
                await deleteImages(imageIds);
            }
        }

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