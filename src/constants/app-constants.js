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
2. Generate 4 plausible answer options.
3. Place the correct answer in one of the positions (A, B, C, or D).
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
- CRITICAL LaTeX FORMATTING: You must enclose all mathematical notation and chemical formulas in \\( and \\) for inline math (e.g., \\( x^2 \\) or \\( H_2O \\)). Do NOT use parentheses () or $ for math delimiters.
- CRITICAL SMILES FORMATTING: To draw 2D chemical structures, return the SMILES string wrapped exactly in [SMILES] and [/SMILES] tags (e.g., [SMILES]C1=CC=CC=C1[/SMILES]). Do NOT use chemical formulas like H2O or NaCl inside these tags; use proper SMILES notation (e.g., [SMILES]O[/SMILES] or [SMILES][Na+].[Cl-][/SMILES]).
- CRITICAL JSON ESCAPING: Ensure all LaTeX backslashes are properly escaped for JSON.
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

const OBJECTIVE_GENERATION_MANUAL_PROMPT = `Role: You are an expert Educational Content Designer specializing in curriculum alignment and Bloom's Taxonomy.

Task: Reorganize the provided learning objectives into a structured JSON hierarchy of Meta Objectives (broad) and Granular Objectives (specific).

Input Data:
Course Name: {courseName}
User-Provided Objectives: {userObjectivesList}
Course Materials Content: {ragContext}

Strict Processing Rules:
1. Classification: Categorize every user-provided objective as either META (overarching/broad) or GRANULAR (specific/measurable).
2. Hierarchy Mapping: * Map all user-provided Granular objectives to the most relevant user-provided Meta objective.
3. Orphan Policy: If a user-provided Granular objective does not fit any existing Meta objective, only then should you create a new Meta objective to house it.

Generation Constraints (The "Gap-Fill" Rule):
1. DO NOT generate new granular objectives for any Meta objective that already contains user-provided granular objectives.
2. ONLY generate 2-4 granular objectives if a Meta objective is "empty" (has no user-provided sub-objectives).

Syntax & Language:
1. Action-Oriented: All granular objectives (user or AI) must start with the exact phrase: "Students will be able to..." followed by an active verb.
2. Taxonomy: Every granular objective must include an array of applicable Bloom’s Taxonomy levels (Remember, Understand, Apply, Analyze, Evaluate, Create).
3. Alignment: All content must be derived strictly from the {ragContext}.

Response Format (JSON Only):
JSON
{
  "objectives": [
    {
      "name": "Meta Objective Name",
      "granularObjectives": [
        {
          "text": "Students will be able to [action verb] [specific skill]...",
          "bloomTaxonomies": ["Apply", "Analyze"],
        }
      ]
    }
  ]
}

Final Warning: Return ONLY the JSON object. Do not include introductory text, explanations, or markdown code blocks. Ensure no user intent is lost.`;

const BLOOM_LEVELS = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"];

const DEFAULT_PROMPTS = {
    questionGeneration: QUESTION_GENERATION_PROMPT,
    objectiveGenerationAuto: OBJECTIVE_GENERATION_AUTO_PROMPT,
    objectiveGenerationManual: OBJECTIVE_GENERATION_MANUAL_PROMPT
};

module.exports = {
    QUESTION_GENERATION_PROMPT,
    OBJECTIVE_GENERATION_AUTO_PROMPT,
    OBJECTIVE_GENERATION_MANUAL_PROMPT,
    BLOOM_LEVELS,
    DEFAULT_PROMPTS
};
