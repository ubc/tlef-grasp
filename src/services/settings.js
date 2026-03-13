const databaseService = require('./database');

/**
 * Default prompts for the application
 */
const DEFAULT_PROMPTS = {
    questionGeneration: `You are an university instructor. Generate a high-quality multiple-choice question based on the provided content that effectively test students' understanding of the course learning objective.

Learning Objective: {learningObjectiveText}
Granular Learning Objective: {granularLearningObjectiveText}
Bloom's Taxonomy Level(s): {bloomLevel}

Task: Create a multiple-choice question based on the provided content that effectively test students' understanding of the course learning objective.

PROCEDURE:
1. Create the question content
2. Generate 4 plausible answer options, placing the CORRECT answer text in one of the positions (A, B, C, or D).
3. Set correctAnswer to the letter corresponding to the correct option (e.g. "C").
4. Write the explanation

The response format must be a valid JSON with the exact structure as follows:
{
  "question": "Your specific question here",
  "options": {
    "A": "First option text",
    "B": "Second option text",
    "C": "Third option text",
    "D": "Fourth option text"
  },
  "correctAnswer": "C",
  "explanation": "Why this answer is correct based on the content"
}

CRITICAL FORMATTING REQUIREMENTS:
- Return ONLY valid JSON.
- Do NOT wrap the JSON in markdown code blocks.
- Do NOT include any text before or after the JSON object.
- CRITICAL JSON ESCAPING: If your response includes LaTeX mathematical notation, you MUST properly escape all backslashes in the JSON string as \\\\\\\\ (double backslash).
- CRITICAL: Do NOT include letter prefixes (A), B), etc.) in the option text.

CONTENT: {ragContext}`,

    objectiveGenerationAuto: `You are an expert educational content designer. Based on the following course materials, generate learning objectives that are clear, measurable, and aligned with educational best practices.

COURSE: {courseName}

COURSE MATERIALS CONTENT:
{ragContext}

INSTRUCTIONS:
1. Analyze the course materials and identify key topics, concepts, and learning outcomes.
2. Determine an appropriate number of main learning objectives that comprehensively cover the major themes in the provided materials.
3. For each main learning objective, generate 2-4 granular (sub) objectives that break it down into specific, measurable learning outcomes.
4. Identify appropriate Bloom's Taxonomy levels that it targets (choose from: Remember, Understand, Apply, Analyze, Evaluate, Create).
5. Use clear, action-oriented language (e.g., "Students will be able to...").
6. Ensure objectives are specific to the content provided, not generic.

RESPONSE FORMAT (JSON):
{
  "objectives": [
    {
      "name": "Main learning objective title",
      "granularObjectives": [
        { "text": "Granular objective 1", "bloomTaxonomies": ["Understand", "Apply"] },
        { "text": "Granular objective 2", "bloomTaxonomies": ["Analyze"] }
      ]
    }
  ]
}

IMPORTANT:
- Base objectives on the actual content in the materials.
- Make objectives specific and measurable.
- Ensure granular objectives support their parent objective.
- Return ONLY valid JSON, no additional text or markdown formatting.`,

    objectiveGenerationManual: `You are an expert educational content designer. Based on the following course materials and specific user-provided goals, generate granular learning objectives that are clear, measurable, and aligned with educational best practices.

COURSE: {courseName}

USER-PROVIDED MAIN OBJECTIVES:
{userObjectivesList}

COURSE MATERIALS CONTENT:
{ragContext}

INSTRUCTIONS:
1. Use the specific learning objectives provided above as the MAIN objectives.
2. For EACH of the user-provided main objectives, generate 2-4 granular (sub) objectives that break it down into specific, measurable learning outcomes based ON THE COURSE MATERIALS CONTENT.
3. Identify appropriate Bloom's Taxonomy levels that it targets (choose from: Remember, Understand, Apply, Analyze, Evaluate, Create).
4. Use clear, action-oriented language (e.g., "Students will be able to...").
5. Ensure objectives are specific to the content provided, not generic.

RESPONSE FORMAT (JSON):
{
  "objectives": [
    {
      "name": "User-provided Objective name",
      "granularObjectives": [
        { "text": "Granular objective 1", "bloomTaxonomies": ["Understand", "Apply"] },
        { "text": "Granular objective 2", "bloomTaxonomies": ["Analyze"] }
      ]
    }
  ]
}

IMPORTANT:
- Align sub-objectives strictly with the user's provided main goals.
- Base content strictly on the material provided.
- Return ONLY valid JSON, no additional text or markdown formatting.`
};

// Mapping between hierarchical object structure and DB flat keys
const KEY_MAP = {
    'general.appName': 'application_name',
    'prompts.questionGeneration': 'prompt_question_generation',
    'prompts.objectiveGenerationAuto': 'prompt_objective_generation_auto',
    'prompts.objectiveGenerationManual': 'prompt_objective_generation_manual'
};

const DEFAULT_GENERAL = {
    appName: 'GRASP'
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
