/**
 * Application-wide default prompt constants
 */

const QUESTION_GENERATION_PROMPT = `You are a university instructor. Generate a high-quality multiple-choice question that tests students' understanding of the provided learning objective.

Learning Objective: {learningObjectiveText}
Granular Learning Objective: {granularLearningObjectiveText}
Bloom's Taxonomy Level(s): {bloomLevel}

BACKGROUND COURSE MATERIAL:
{ragContext}
--- END OF MATERIAL ---

{existingQuestionsContext}

INSTRUCTIONS:
1. Write a question aligned to the learning objective and Bloom's level.
2. Generate 4 answer options (A–D), one of which is correct. Every answer option must be unique — no two options may have identical or near-identical text.
3. Set correctAnswer to the letter of the correct option.
4. For each incorrect option, write feedback explaining only why that specific option is wrong — do not reference, imply, or lead toward the correct answer.

Bloom's level guidance:
- Remember: recall a definition or fact
- Understand: explain, paraphrase, or classify in own words
- Apply: use a concept or formula in a novel scenario
- Analyze: compare, differentiate, or break down components
- Evaluate: justify, critique, or defend a choice
- Create: design, construct, or propose something new

PROCEDURE:
1. Create the question content, Your question stem must be STRUCTURALLY different from previous questions, You must approach the same concept from a different angle.
2. Generate 4 plausible answer options.
3. Place the correct answer in one of the positions (A, B, C, or D).
4. Write the explanation

{
  "question": "Question text here",
  "options": {
    "A": { "text": "Option text", "feedback": "Why this distractor is wrong" },
    "B": { "text": "Option text", "feedback": "Why this distractor is wrong" },
    "C": { "text": "Correct option text", "feedback": "" },
    "D": { "text": "Option text", "feedback": "Why this distractor is wrong" }
  },
  "correctAnswer": "C"
}

CRITICAL FORMATTING REQUIREMENTS:
- Return ONLY valid JSON.
- Do NOT wrap the JSON in markdown code blocks.
- Do NOT include any text before or after the JSON object.
- CRITICAL LaTeX FORMATTING: You must enclose all mathematical notation and chemical formulas in \\\\( and \\\\) for inline math (e.g., \\\\( x^2 \\\\) or \\\\( H_2O \\\\)). Do NOT use parentheses () or $ for math delimiters.
- CRITICAL SMILES FORMATTING: To draw 2D chemical structures, return the SMILES string wrapped exactly in [SMILES] and [/SMILES] tags (e.g., [SMILES]C1=CC=CC=C1[/SMILES]). Do NOT use chemical formulas like H2O or NaCl inside these tags; use proper SMILES notation (e.g., [SMILES]O[/SMILES] or [SMILES][Na+].[Cl-][/SMILES]).
- CRITICAL JSON ESCAPING: Ensure all LaTeX backslashes are properly escaped for JSON.
- CRITICAL: Do NOT include letter prefixes (A), B), etc.) in the option text.`;

const OBJECTIVE_GENERATION_AUTO_PROMPT = `You are an expert educational content designer. Based on the following course materials, generate learning objectives that are clear, measurable, and aligned with educational best practices.

COURSE: {courseName}

COURSE MATERIALS CONTENT:
{ragContext}

INSTRUCTIONS:
1. Analyze the course materials and identify key topics, concepts, and learning outcomes.
2. Determine an appropriate number of main learning objectives that comprehensively cover the major themes in the provided materials.
3. For each main learning objective, generate as many granular (sub) objectives as the material genuinely supports. Do not pad with weak or overlapping objectives to meet a minimum. Quality and distinctiveness take priority over quantity.
4. For each granular objective, identify the most appropriate Bloom's Taxonomy level(s) based on the nature of the skill or concept being assessed (choose from: Remember, Understand, Apply, Analyze, Evaluate, Create).
5. Use clear, action-oriented language (e.g., "Students will be able to...").
6. Ensure objectives are specific to the content provided, not generic.

RULES FOR GRANULAR OBJECTIVES:
- Each granular objective under a main objective must test a DISTINCT concept or skill — not a rephrasing of the same idea.
- Do not generate two granular objectives that a student could satisfy by knowing the same single fact.
- Each granular objective must be assessable with a question that is fundamentally different from questions assessing the other granular objectives under the same main objective.
- Let the content drive the Bloom's level — do not force a level that does not fit the material.
- Avoid granular objectives that are too shallow to assess meaningfully on their own, such as recalling a single definition or performing a trivial isolated task. Instead, embed such skills within a richer, more substantive objective.

SELF-CHECK BEFORE RETURNING YOUR RESPONSE:
- No two granular objectives under the same main objective test the same fact or skill.
- Each granular objective is genuinely distinct and necessary — remove any that are redundant or only added to meet a count.

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

IMPORTANT RULES:
1. Base objectives strictly on the provided material content.
2. Return ONLY valid JSON.
3. CRITICAL LaTeX FORMATTING: You must enclose all mathematical notation and chemical formulas in \\\\( and \\\\) for inline math (e.g., \\\\( x^2 \\\\) or \\\\( H_2O \\\\)). Do NOT use parentheses () or $ for math delimiters.
4. CRITICAL SMILES FORMATTING: To draw 2D chemical structures, return the SMILES string wrapped exactly in [SMILES] and [/SMILES] tags (e.g., [SMILES]C1=CC=CC=C1[/SMILES]).
5. CRITICAL JSON ESCAPING: Ensure all LaTeX backslashes are properly escaped for JSON.`;

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
2. ONLY generate granular objectives if a Meta objective is "empty" (has no user-provided sub-objectives).

Syntax & Language:
1. Action-Oriented: All granular objectives (user or AI) must start with the exact phrase: "Students will be able to..." followed by an active verb.
2. Taxonomy: Every granular objective must include an array of applicable Bloom’s Taxonomy levels (Remember, Understand, Apply, Analyze, Evaluate, Create).
3. Alignment: All content must be derived strictly from the provided course content.

Response Format (JSON Only):
JSON
{
  "objectives": [
    {
      "name": "Meta Objective Name",
      "granularObjectives": [
        {
          "text": "Students will be able to [action verb] [specific skill]...",
          "bloomTaxonomies": ["Apply", "Analyze"]
        }
      ]
    }
  ]
}

FINAL INSTRUCTIONS:
1. Return ONLY the JSON object. Do not include introductory text, explanations, or markdown code blocks.
2. CRITICAL LaTeX FORMATTING: You must enclose all mathematical notation and chemical formulas in \\\\( and \\\\) for inline math (e.g., \\\\( x^2 \\\\) or \\\\( H_2O \\\\)). Do NOT use parentheses () or $ for math delimiters.
3. CRITICAL SMILES FORMATTING: To draw 2D chemical structures, return the SMILES string wrapped exactly in [SMILES] and [/SMILES] tags (e.g., [SMILES]C1=CC=CC=C1[/SMILES]).
4. CRITICAL JSON ESCAPING: Ensure all LaTeX backslashes are properly escaped for JSON.`;

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
