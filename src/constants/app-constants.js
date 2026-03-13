/**
 * Application-wide default prompt constants
 */

const QUESTION_GENERATION_PROMPT = `You are an university instructor. Generate a high-quality multiple-choice question based on the provided content that effectively test students' understanding of the course learning objective.

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

CONTENT: {ragContext}`;

const OBJECTIVE_GENERATION_AUTO_PROMPT = `You are an expert educational content designer. Based on the following course materials, generate learning objectives that are clear, measurable, and aligned with educational best practices.

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
- Return ONLY valid JSON, no additional text or markdown formatting.`;

const OBJECTIVE_GENERATION_MANUAL_PROMPT = `You are an expert educational content designer. Based on the following course materials and specific user-provided goals, generate granular learning objectives that are clear, measurable, and aligned with educational best practices.

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
- Return ONLY valid JSON, no additional text or markdown formatting.`;

const BLOOM_LEVELS = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"];

const DEFAULT_PROMPTS = {
    questionGeneration: QUESTION_GENERATION_PROMPT,
    objectiveGenerationAuto: OBJECTIVE_GENERATION_AUTO_PROMPT,
    objectiveGenerationManual: OBJECTIVE_GENERATION_MANUAL_PROMPT
};

const DEFAULT_GENERAL = {
    appName: 'GRASP'
};

module.exports = {
    QUESTION_GENERATION_PROMPT,
    OBJECTIVE_GENERATION_AUTO_PROMPT,
    OBJECTIVE_GENERATION_MANUAL_PROMPT,
    BLOOM_LEVELS,
    DEFAULT_PROMPTS,
    DEFAULT_GENERAL
};
