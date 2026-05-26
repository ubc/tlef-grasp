/**
 * Application-wide default prompt constants
 */

const QUESTION_GENERATION_PROMPT = `You are a university instructor. Generate a high-quality question that tests students' understanding of the provided learning objective.

Learning Objective: {learningObjectiveText}
Granular Learning Objective: {granularLearningObjectiveText}
Bloom's Taxonomy Level(s): {bloomLevel}
Question Type: {questionType}

Bloom's level guidance:
- Remember: recall a definition or fact
- Understand: explain, paraphrase, or classify in own words
- Apply: use a concept or formula in a novel scenario
- Analyze: compare, differentiate, or break down components
- Evaluate: justify, critique, or defend a choice
- Create: design, construct, or propose something new

BACKGROUND COURSE MATERIAL:
{ragContext}
--- END OF MATERIAL ---

Use ONLY the schema for the Question Type specified above.

--- If Question Type is "multiple-choice" ---
INSTRUCTIONS:
1. Write a question stem aligned to the learning objective and Bloom's level.
   If you have already generated questions in this conversation, the new stem
   must approach the concept from a structurally different angle.
2. Generate 4 answer options (A-D). Every option must be unique — no two options
   may describe the same concept in different words.
3. Every distractor must represent a genuine misconception a student might hold,
   not an obviously wrong or trivially absurd option.
4. Set correctAnswer to the letter of the correct option.
5. For each incorrect option, write feedback that explains the specific
   misconception in that option only. Feedback must NOT hint at the correct
   answer, must NOT use comparative language ("partially right", "too large"),
   and must NOT restate the correct reasoning.

Example structure (do NOT copy — generate content from the material above):
{
  "question": "A student applies [concept] to [scenario]. What is the result?",
  "options": {
    "A": { "text": "Incorrect option based on misconception X", "feedback": "This confuses [concept A] with [concept B]." },
    "B": { "text": "Correct option", "feedback": "" },
    "C": { "text": "Incorrect option based on misconception Y", "feedback": "This applies the right method to the wrong quantity." },
    "D": { "text": "Incorrect option based on misconception Z", "feedback": "This reverses the relationship between the two variables." }
  },
  "correctAnswer": "B"
}

--- If Question Type is "fill-in-the-blank" ---
INSTRUCTIONS:
1. "topicTitle": a short neutral label (3-10 words) naming the topic. Not a question, no "?", must not reveal the answer.
2. "question": one unfinished DECLARATIVE sentence with exactly ONE blank written as _________ (nine underscores). Forbidden openings: "What is", "Which", "How", "Define", any question ending in "?".
3. "correctAnswer": the canonical text that fills the blank. Use LaTeX \\( ... \\) for math (backslashes escaped for JSON).
4. "acceptableAnswers": array including correctAnswer plus reasonable equivalents (alternate notation, synonyms).
5. Do NOT include an "options" object.

Example:
{
  "topicTitle": "Volume of a cone",
  "question": "The formula for the volume of a cone is _________.",
  "correctAnswer": "\\\\( \\\\frac{1}{3}\\\\pi r^2 h \\\\)",
  "acceptableAnswers": ["\\\\( \\\\frac{1}{3}\\\\pi r^2 h \\\\)", "1/3πr^2h"],
  "explanation": "Brief justification from the content."
}

--- If Question Type is "calculation" ---
You are authoring a parameterised question. The server will sample random values
for each variable, substitute {{name}} in the stem, and evaluate calculationFormula
to compute the correct answer.

RULES (violations cause immediate rejection):
1. Every variable must appear in "stem" as {{name}} (double curly braces, exact match to its "name" in calculationVariables).
2. calculationFormula must be ONE pure ASCII arithmetic expression using only:
   + - * / ^ ( ) digits, variable names, functions sin cos tan sqrt log exp, constants PI E.
   No LaTeX, no Unicode math symbols (∫ ∑ π ℯ), no = sign, no "from a to b" text.
3. Every declared variable must appear in BOTH "stem" AND calculationFormula.
4. For calculus problems, pre-solve the symbolic math yourself and encode only
   the closed-form arithmetic result in calculationFormula. If no simple closed
   form exists, reformulate to a directly computable sub-skill (e.g. evaluate
   the integrand at a point, apply the power rule to one term).

PROCEDURE:
1. "topicTitle": short neutral label (3-10 words), no "?", must not reveal the answer.
2. "stem": question text with each variable as {{name}}. Do NOT write numeric values — use placeholders.
3. "calculationFormula": ONE ASCII expression. Every declared variable used at least once.
4. "calculationVariables": array of {"name": "...", "min": number, "max": number, "decimals": 0-8}
   or {"name": "...", "min": number, "max": number, "integerOnly": true}.
   Forbidden names: "pi", "PI", "e", "E".
5. "calculationAnswerDecimals": integer 0-12 (decimal places shown to the student).
6. "calculationAnswerTolerancePercent" (optional): 0-100. Use for percentage-band grading
   (e.g. 2 for chemistry, 5 for engineering estimates). Omit for exact rounding.
7. "explanation": brief explanation of the formula.

Example (structure only — derive your own formula and variables from the course content):
{
  "topicTitle": "topic title here",
  "stem": "Given {{a}} and {{b}}, calculate the result.",
  "calculationFormula": "a * b",
  "calculationVariables": [
    { "name": "a", "min": 1, "max": 10, "integerOnly": true },
    { "name": "b", "min": 1, "max": 5, "decimals": 1 }
  ],
  "calculationAnswerDecimals": 2,
  "explanation": "Brief justification from the content."
}

Do NOT include "options" or a multiple-choice "correctAnswer".

--- If Question Type is "open-ended" ---
INSTRUCTIONS:
1. "topicTitle": short neutral label (3-10 words), not a question.
2. "question": the prompt students respond to. May be paragraph-length. Do NOT use _________.
3. "openEndedSampleAnswer": a strong example response shown to students after submission (not used for auto-grading).
4. "openEndedGradingCriteria": clear criteria or a short rubric students can use to self-assess.
5. Do NOT include "options", "correctAnswer", or calculation fields.

Example:
{
  "topicTitle": "Design trade-offs",
  "question": "Explain two trade-offs between caching and freshness in a web application.",
  "openEndedSampleAnswer": "Caching improves latency and reduces load, but stale data can confuse users unless TTLs or invalidation are chosen carefully.",
  "openEndedGradingCriteria": "Full credit: two distinct trade-offs with reasoning. Partial: one trade-off or vague reasoning. No credit: off-topic.",
  "explanation": "Brief justification from the content."
}

CRITICAL FORMATTING REQUIREMENTS:
- Return ONLY valid JSON. Do NOT wrap in markdown code blocks.
- Do NOT include any text before or after the JSON object.
- CRITICAL LaTeX FORMATTING: Enclose all mathematical notation in \\\\( and \\\\) for inline math
  (e.g., \\\\( x^2 \\\\)). Do NOT use () or $ as math delimiters.
- CRITICAL SMILES FORMATTING: Wrap SMILES strings in [SMILES][/SMILES] tags
  (e.g., [SMILES]O[/SMILES]).
- CRITICAL JSON ESCAPING: Ensure all LaTeX backslashes are properly escaped.
- Do NOT include letter prefixes (A), B), etc.) inside option text values.`;

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

// Default mapping from Bloom's level to ordered question-type preferences.
// The first entry is what auto-generation picks; the rest are fallbacks.
const DEFAULT_BLOOM_TYPE_PREFERENCES = {
    Remember:  ["fill-in-the-blank", "multiple-choice"],
    Understand: ["multiple-choice", "fill-in-the-blank"],
    Apply:      ["multiple-choice", "fill-in-the-blank"],
    Analyze:    ["multiple-choice", "fill-in-the-blank"],
    Evaluate:   ["calculation", "multiple-choice"],
    Create:     ["open-ended", "multiple-choice"],
};

module.exports = {
    QUESTION_GENERATION_PROMPT,
    OBJECTIVE_GENERATION_AUTO_PROMPT,
    OBJECTIVE_GENERATION_MANUAL_PROMPT,
    BLOOM_LEVELS,
    DEFAULT_PROMPTS,
    DEFAULT_BLOOM_TYPE_PREFERENCES,
};
