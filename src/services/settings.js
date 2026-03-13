const databaseService = require('./database');
const { DEFAULT_PROMPTS, DEFAULT_GENERAL } = require('../constants/app-constants');

// Mapping between hierarchical object structure and DB flat keys
const KEY_MAP = {
    'general.appName': 'application_name',
    'prompts.questionGeneration': 'prompt_question_generation',
    'prompts.objectiveGenerationAuto': 'prompt_objective_generation_auto',
    'prompts.objectiveGenerationManual': 'prompt_objective_generation_manual'
};

/**
 * Get application settings
 */
const getSettings = async () => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection('grasp_settings');
        
        // Find all settings
        const results = await collection.find({}).toArray();
        const settingsMap = results.reduce((map, item) => {
            map[item.name] = item.value;
            return map;
        }, {});

        // Reconstruct the hierarchical settings object
        const settings = {
            general: {
                appName: settingsMap[KEY_MAP['general.appName']] || DEFAULT_GENERAL.appName
            },
            prompts: {}
        };

        // Populate prompts with defaults or found values
        for (const promptKey in DEFAULT_PROMPTS) {
            const dbKey = KEY_MAP[`prompts.${promptKey}`];
            settings.prompts[promptKey] = (dbKey ? settingsMap[dbKey] : null) ?? DEFAULT_PROMPTS[promptKey];
        }

        // Proactively save defaults if they don't exist (only for mapped keys)
        for (const path in KEY_MAP) {
            const dbKey = KEY_MAP[path];
            if (!(dbKey in settingsMap)) {
                const [category, item] = path.split('.');
                const value = category === 'general' ? DEFAULT_GENERAL[item] : DEFAULT_PROMPTS[item];
                await collection.updateOne(
                    { name: dbKey },
                    { $set: { name: dbKey, value: value, updatedAt: new Date() } },
                    { upsert: true }
                );
            }
        }
        
        return settings;
    } catch (error) {
        console.error('Error getting settings:', error);
        throw error;
    }
};

/**
 * Update application settings
 * @param {Object} updateData - Data to update (hierarchical structure)
 */
const updateSettings = async (updateData) => {
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
                                filter: { name: dbKey },
                                update: { $set: { name: dbKey, value: obj[key], updatedAt: new Date() } },
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
        console.error('Error updating settings:', error);
        throw error;
    }
};

module.exports = {
    getSettings,
    updateSettings,
    DEFAULT_PROMPTS
};
