const databaseService = require('./database');
const { DEFAULT_PROMPTS, DEFAULT_BLOOM_TYPE_PREFERENCES } = require('../constants/app-constants');

// Mapping between hierarchical object structure and DB flat keys
const KEY_MAP = {
    'prompts.questionGeneration': 'prompt_question_generation',
    'prompts.objectiveGenerationAuto': 'prompt_objective_generation_auto',
    'prompts.objectiveGenerationManual': 'prompt_objective_generation_manual',
    'prompts.powerPointImageDescription': 'prompt_powerpoint_image_description',
    'prompts.openEndedGrading': 'prompt_open_ended_grading',
    'prompts.fillInTheBlankGrading': 'prompt_fill_in_the_blank_grading',
    'bloomTypePreferences': 'bloom_type_preferences',
    'coInstructorPermissions': 'co_instructor_permissions',
    // Owner-only generation controls. The controller strips both from an update
    // by a non-owner, the same way it does for coInstructorPermissions.
    'reasoningEffort': 'reasoning_effort',
    'autoFixEnabled': 'auto_fix_enabled',
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
            // Per-pipeline-stage reasoning effort. An absent stage falls back to
            // the LLM_EFFORT_* env vars and then to "medium" (see llm-effort.js),
            // so an empty map means "whatever the deployment is configured for".
            reasoningEffort: {},
            // Generated questions are always reviewed; this governs only whether
            // the flagged ones are then repaired automatically. On by default,
            // which keeps an untouched course on its existing behaviour.
            autoFixEnabled: true,
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
        const effortDbKey = KEY_MAP['reasoningEffort'];
        const storedEffort = settingsMap[effortDbKey];
        if (storedEffort) {
            try {
                settings.reasoningEffort = JSON.parse(storedEffort);
            } catch {
                settings.reasoningEffort = {};
            }
        }

        // Stored as a string by the flat key/value writer; only an explicit
        // "false" turns it off, so a corrupt value fails safe to fixing.
        const autoFixDbKey = KEY_MAP['autoFixEnabled'];
        const storedAutoFix = settingsMap[autoFixDbKey];
        if (storedAutoFix !== undefined && storedAutoFix !== null) {
            settings.autoFixEnabled = !(storedAutoFix === false || storedAutoFix === 'false');
        }

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
