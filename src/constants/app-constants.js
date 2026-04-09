/**
 * Application-wide default prompt constants
 */

const QUESTION_GENERATION_PROMPT = `You behave like a strict JSON API, not a chat assistant.

MANDATORY OUTPUT (read first):
- Output EXACTLY one JSON object and NOTHING else: no preamble, no "##" headings, no bullet lists, no step-by-step reasoning, no "To address this", no summaries of the source, no "The final answer", no markdown code fences.
- The first character of your entire reply MUST be "{" and the last MUST be "}".
- Put all question text, options, and explanations INSIDE the JSON string fields only.

Learning Objective: {learningObjectiveText}
Granular Learning Objective: {granularLearningObjectiveText}
Bloom's Taxonomy Level(s): {bloomLevel}
Question Type: {questionType}

Task: Use ONLY the schema that matches Question Type. Base the question on the CONTENT section below (do not summarize or discuss the content in plain text).

--- If Question Type is "multiple-choice" ---
PROCEDURE:
1. Create the question content.
2. Generate 4 plausible answer options, placing the CORRECT answer text in one of the positions (A, B, C, or D).
3.  Set correctAnswer to the letter corresponding to the correct option (e.g. "C").
4. Write a brief explanation.

The response format must be a valid JSON with the exact structure as follows:
{
  "type": "multiple-choice",
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
Rules: Four non-empty options; correctAnswer is only "A", "B", "C", or "D"; randomize which letter is correct; option text must NOT start with "A)" or "A." style prefixes.

--- If Question Type is "fill-in-the-blank" ---
PROCEDURE:
1. "topicTitle" is REQUIRED: a very short label (about 3-10 words) that names the topic or skill being tested. It must be a neutral phrase or title (not a question, no "?"). It must NOT reveal the answer, must NOT repeat the wording of correctAnswer or acceptableAnswers, and must NOT be instructions like "Fill in the blank" or "Complete the sentence".
2. The "question" string is ONLY the item stem: one unfinished DECLARATIVE sentence (a statement with a gap), NOT a WH-question. FORBIDDEN in "question": "What is...", "Which...", "How...", "Define...", ending with "?".
3. The sentence MUST contain exactly ONE blank, written ONLY as nine underscores: _________ (not ____, not [blank]).
4. correctAnswer is what fills the blank (canonical form; use LaTeX \\( ... \\) inside JSON strings for math, with backslashes escaped for JSON).
5. acceptableAnswers must include correctAnswer and reasonable equivalents (alternate LaTeX, plain-text math, synonyms).
6. Do NOT include an "options" object.

Example:
{
  "type": "fill-in-the-blank",
  "topicTitle": "Volume of a cone",
  "question": "The formula for the volume of a cone is _________.",
  "correctAnswer": "\\\\( \\\\frac{1}{3}\\\\pi r^2 h \\\\)",
  "acceptableAnswers": ["\\\\( \\\\frac{1}{3}\\\\pi r^2 h \\\\)", "1/3πr^2h"],
  "explanation": "Why this answer is correct based on the content"
}

Return valid JSON in this shape. Rules: No "options" key; include "topicTitle"; exactly one _________ in "question".

--- If Question Type is "calculation" ---
PROCEDURE:
1. "topicTitle" is REQUIRED: a short neutral label (3–10 words), not a question, must not reveal numeric answers.
2. "stem" is the question text with placeholders for variables only as {{variableName}} (double braces). Every variable in "calculationFormula" must appear in "stem" as {{name}} matching "calculationVariables[].name".
3. "calculationFormula" MUST be one expression the calculator can evaluate: use variable names and + - * / ^ ( ). Prefer plain ASCII (e.g. "a*b", "(x+1)/y"). Do NOT use ∫, ∑, matrices, or LaTeX environments in the formula. Put math display only in "stem" (LaTeX allowed there). If you use LaTeX-style operators in the formula, keep them minimal (e.g. \\frac{a}{b} or \\times)—the server may normalize them, but simple ASCII is best.
4. "calculationVariables" is a non-empty array of objects: { "name", "min", "max", optional "decimals" (0–8) or "integerOnly": true }.
5. "calculationAnswerDecimals" is how many decimal places the correct numeric answer should be rounded to (integer 0–12).

Example:
{
  "type": "calculation",
  "topicTitle": "Ohm's law application",
  "stem": "Given voltage {{V}} V and resistance {{R}} Ω, the current is _____ A.",
  "calculationFormula": "V / R",
  "calculationVariables": [
    { "name": "V", "min": 10, "max": 120, "integerOnly": true },
    { "name": "R", "min": 5, "max": 50, "decimals": 1 }
  ],
  "calculationAnswerDecimals": 2,
  "explanation": "Why this applies to the content"
}

CRITICAL FORMATTING REQUIREMENTS (all matching types):
- Return ONLY valid JSON. Do NOT wrap in markdown code blocks.
- Do NOT include any text before or after the JSON object.
- CRITICAL JSON ESCAPING: If your response includes LaTeX mathematical notation, you MUST properly escape all backslashes in JSON strings (each backslash in the content becomes \\\\\\\\ in JSON where needed).
- For multiple-choice: Do NOT include letter prefixes (A), B), etc.) inside the option text values.
- For calculation: Do NOT include an "options" object or MC "correctAnswer"; use "stem" (not only "question") for the template with {{var}} placeholders. The formula field must stay machine-evaluable (no integral sign ∫ or similar).
FORMATTING INSIDE JSON STRINGS:
- Escape backslashes for LaTeX: use \\\\\\\\ where a single backslash is needed in the rendered math, so JSON.parse succeeds.
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

module.exports = {
    QUESTION_GENERATION_PROMPT,
    OBJECTIVE_GENERATION_AUTO_PROMPT,
    OBJECTIVE_GENERATION_MANUAL_PROMPT,
    BLOOM_LEVELS,
    DEFAULT_PROMPTS
};
