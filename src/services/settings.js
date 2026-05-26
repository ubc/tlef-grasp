const databaseService = require('./database');
const { DEFAULT_PROMPTS, DEFAULT_GENERAL } = require('../constants/app-constants');

// Mapping between hierarchical object structure and DB flat keys
const KEY_MAP = {
    'prompts.questionGeneration': 'prompt_question_generation',
    'prompts.objectiveGenerationAuto': 'prompt_objective_generation_auto',
    'prompts.objectiveGenerationManual': 'prompt_objective_generation_manual'
};

const REQUIRED_PROMPT_MARKERS = {
    questionGeneration: [
        '{questionType}',
        '{learningObjectiveText}',
        '{ragContext}'
    ]
};

const isStalePromptSnapshot = (promptKey, value) => {
    const required = REQUIRED_PROMPT_MARKERS[promptKey];
    if (!required) return false;
    const v = String(value || '');
    return required.some((marker) => !v.includes(marker));
};

/**
 * Get application settings for a specific course
 * @param {string} courseId - The course ID to get settings for
 */
const getSettings = async (courseId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection('grasp_settings');
        
        // Find all settings for this course
        const results = await collection.find({ courseId }).toArray();
        const settingsMap = results.reduce((map, item) => {
            map[item.name] = item.value;
            return map;
        }, {});

        // Reconstruct the hierarchical settings object
        const settings = {
            prompts: {}
        };

        // Resolve each prompt: use stored value when present and structurally compatible,
        // otherwise fall back to the current default and persist it (insert if missing, refresh if stale).
        for (const promptKey in DEFAULT_PROMPTS) {
            const dbKey = KEY_MAP[`prompts.${promptKey}`];
            if (!dbKey) {
                settings.prompts[promptKey] = DEFAULT_PROMPTS[promptKey];
                continue;
            }
            const storedValue = settingsMap[dbKey];
            const stored = storedValue != null;
            const stale = stored && isStalePromptSnapshot(promptKey, storedValue);
            if (!stored || stale) {
                if (stale) {
                    console.log(`[settings] Refreshing stale prompt snapshot "${dbKey}" for course ${courseId}.`);
                }
                settings.prompts[promptKey] = DEFAULT_PROMPTS[promptKey];
                await collection.updateOne(
                    { name: dbKey, courseId },
                    { $set: { name: dbKey, value: DEFAULT_PROMPTS[promptKey], courseId, updatedAt: new Date() } },
                    { upsert: true }
                );
            } else {
                settings.prompts[promptKey] = storedValue;
            }
        }
        
        return settings;
    } catch (error) {
        console.error(`Error getting settings for course ${courseId}:`, error);
        throw error;
    }
};

/**
 * Update application settings for a specific course
 * @param {string} courseId - The course ID
 * @param {Object} updateData - Data to update (hierarchical structure)
 */
const updateSettings = async (courseId, updateData) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection('grasp_settings');
        
        const operations = [];

        // Function to flatten and create bulk ops
        const processUpdates = (obj, prefix = '') => {
            for (const key in obj) {
                const path = prefix ? `${prefix}.${key}` : key;
                if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
                    processUpdates(obj[key], path);
                } else {
                    const dbKey = KEY_MAP[path];
                    if (dbKey) {
                        operations.push({
                            updateOne: {
                                filter: { name: dbKey, courseId: courseId },
                                update: { $set: { name: dbKey, value: obj[key], courseId: courseId, updatedAt: new Date() } },
                                upsert: true
                            }
                        });
                    }
                }
            }
        };

        processUpdates(updateData);

        if (operations.length > 0) {
            await collection.bulkWrite(operations);
        }
        
        return { success: true };
    } catch (error) {
        console.error(`Error updating settings for course ${courseId}:`, error);
        throw error;
    }
};

module.exports = {
    getSettings,
    updateSettings,
    DEFAULT_PROMPTS
};
