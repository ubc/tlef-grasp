const databaseService = require('./database');
const { DEFAULT_PROMPTS, DEFAULT_BLOOM_TYPE_PREFERENCES } = require('../constants/app-constants');

// Mapping between hierarchical object structure and DB flat keys
const KEY_MAP = {
    'prompts.questionGeneration': 'prompt_question_generation',
    'prompts.objectiveGenerationAuto': 'prompt_objective_generation_auto',
    'prompts.objectiveGenerationManual': 'prompt_objective_generation_manual',
    'bloomTypePreferences': 'bloom_type_preferences',
    'coInstructorPermissions': 'co_instructor_permissions',
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
            prompts: {},
            bloomTypePreferences: null,
            coInstructorPermissions: {},
        };

        // Resolve each prompt: use stored value when present, otherwise fall back to default.
        for (const promptKey in DEFAULT_PROMPTS) {
            const dbKey = KEY_MAP[`prompts.${promptKey}`];
            if (!dbKey) {
                settings.prompts[promptKey] = DEFAULT_PROMPTS[promptKey];
                continue;
            }
            const storedValue = settingsMap[dbKey];
            if (storedValue != null) {
                settings.prompts[promptKey] = storedValue;
            } else {
                settings.prompts[promptKey] = DEFAULT_PROMPTS[promptKey];
            }
        }

        // Resolve bloomTypePreferences: parse stored JSON or fall back to default.
        const bloomDbKey = KEY_MAP['bloomTypePreferences'];
        const storedBloom = settingsMap[bloomDbKey];
        if (storedBloom) {
            try {
                settings.bloomTypePreferences = JSON.parse(storedBloom);
            } catch {
                settings.bloomTypePreferences = DEFAULT_BLOOM_TYPE_PREFERENCES;
            }
        } else {
            settings.bloomTypePreferences = DEFAULT_BLOOM_TYPE_PREFERENCES;
        }

        // Resolve co-instructor permissions: a map of feature key -> boolean.
        // An absent map (or absent key) means "allowed" — the frontend treats
        // anything not explicitly false as enabled, so the default is full access.
        const permsDbKey = KEY_MAP['coInstructorPermissions'];
        const storedPerms = settingsMap[permsDbKey];
        if (storedPerms) {
            try {
                settings.coInstructorPermissions = JSON.parse(storedPerms);
            } catch {
                settings.coInstructorPermissions = {};
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

        // Function to flatten and create bulk ops.
        // KEY_MAP is checked first: if the current path maps to a DB key, store it directly
        // (serializing objects/arrays to JSON). Only recurse into plain objects that are NOT
        // themselves a top-level key — this prevents bloomTypePreferences from being
        // flattened into per-level entries.
        const processUpdates = (obj, prefix = '') => {
            for (const key in obj) {
                const path = prefix ? `${prefix}.${key}` : key;
                const dbKey = KEY_MAP[path];
                if (dbKey) {
                    const raw = obj[key];
                    const value = (raw !== null && typeof raw === 'object')
                        ? JSON.stringify(raw)
                        : raw;
                    operations.push({
                        updateOne: {
                            filter: { name: dbKey, courseId: courseId },
                            update: { $set: { name: dbKey, value, courseId: courseId, updatedAt: new Date() } },
                            upsert: true
                        }
                    });
                } else if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
                    processUpdates(obj[key], path);
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
