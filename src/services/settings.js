const databaseService = require('./database');
const { DEFAULT_PROMPTS } = require('../constants/app-constants');

// Mapping between hierarchical object structure and DB flat keys
const KEY_MAP = {
    'prompts.questionGeneration': 'prompt_question_generation',
    'prompts.objectiveGenerationAuto': 'prompt_objective_generation_auto',
    'prompts.objectiveGenerationManual': 'prompt_objective_generation_manual',
    'prompts.powerPointImageDescription': 'prompt_powerpoint_image_description',
    'prompts.openEndedGrading': 'prompt_open_ended_grading',
    'prompts.fillInTheBlankGrading': 'prompt_fill_in_the_blank_grading',
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
        // themselves a top-level key — this prevents object-valued settings like
        // coInstructorPermissions and reasoningEffort from being flattened into
        // one entry per inner key.
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

/**
 * How many courses store their own copy of each prompt, and how many of those
 * copies still match the current default. A stored copy overrides the default
 * for good, so a course that saved its settings before a default changed keeps
 * the old text until the copy is removed.
 */
const getStoredPromptCounts = async () => {
    const db = await databaseService.connect();
    const collection = db.collection('grasp_settings');
    const counts = {};
    for (const promptKey in DEFAULT_PROMPTS) {
        const dbKey = KEY_MAP[`prompts.${promptKey}`];
        if (!dbKey) continue;
        const rows = await collection.find({ name: dbKey }, { projection: { value: 1 } }).toArray();
        counts[promptKey] = {
            courses: rows.length,
            matchingDefault: rows.filter((row) => row.value === DEFAULT_PROMPTS[promptKey]).length,
        };
    }
    return counts;
};

/**
 * Put one prompt back to the default in every course, archived ones included,
 * by removing each course's stored copy so getSettings falls back to
 * DEFAULT_PROMPTS. Returns how many courses had a copy.
 */
const resetPromptForAllCourses = async (promptKey) => {
    const dbKey = Object.prototype.hasOwnProperty.call(DEFAULT_PROMPTS, promptKey)
        ? KEY_MAP[`prompts.${promptKey}`]
        : null;
    if (!dbKey) throw new Error(`Unknown prompt: ${promptKey}`);
    const db = await databaseService.connect();
    const result = await db.collection('grasp_settings').deleteMany({ name: dbKey });
    return result.deletedCount;
};

module.exports = {
    getSettings,
    updateSettings,
    getStoredPromptCounts,
    resetPromptForAllCourses,
    DEFAULT_PROMPTS
};
