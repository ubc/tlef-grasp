/**
 * Application-wide default prompt constants
 */

const QUESTION_GENERATION_PROMPT = `You are a university instructor. Generate a high-quality question based on the provided material that effectively tests students' understanding of the course learning objective.

Course: {courseName}
Learning Objective: {learningObjectiveText}
Granular Learning Objective: {granularLearningObjectiveText}

BACKGROUND COURSE MATERIAL:
{ragContext}
--- END OF MATERIAL ---

Bloom's level guidance (sample verbs in parentheses):
- Remember: recall a definition or fact (define, list, identify, name)
- Understand: explain, paraphrase, or classify in own words (explain,
  describe, summarize, classify)
- Apply: use a concept or formula in a novel scenario (apply, solve, use,
  demonstrate)
- Analyze: compare, differentiate, or break down components (compare,
  differentiate, examine, contrast)
- Evaluate: justify, critique, or defend a choice (evaluate, critique,
  justify, judge)
- Create: design, construct, or propose something new (design, construct,
  propose, formulate)

SELF-CHECK BEFORE RETURNING (required):

TOPIC: Does your question stem directly test the concept named in the Granular Learning Objective above?
If the question is about a different subject, rewrite it before returning.

BLOOM: Apply the stricter definitions below before accepting your Bloom label:
- Apply = execute a procedure on a specific scenario, not name what the procedure does
- Analyze = explain WHY or compare components, not just perform a calculation
- Evaluate = make a judgment or critique, not just compute an answer
If a student can answer your question by recalling a single fact or definition, it is Remember or Understand — redesign it to genuinely match the target level.

CRITICAL FORMATTING REQUIREMENTS:
- Return ONLY valid JSON. Do NOT wrap in markdown code blocks.
- Do NOT include any text before or after the JSON object.
- CRITICAL LaTeX FORMATTING: Enclose all mathematical notation in \\\\( and \\\\) for inline math
  (e.g., \\\\( x^2 \\\\)). Do NOT use () or $ as math delimiters.
- CRITICAL SMILES FORMATTING: Wrap SMILES strings in [SMILES][/SMILES] tags
  (e.g., [SMILES]O[/SMILES]).
- CRITICAL JSON ESCAPING: Ensure all LaTeX backslashes are properly escaped.
- Do NOT include letter prefixes (A), B), etc.) inside option text values.

TARGET QUESTION PARAMETERS FOR THIS TASK:
- Question Type to Generate: {questionType}
- Bloom's Taxonomy Level: {bloomLevel}

Use ONLY the schema for the Question Type specified below:
{typeSpecificInstructions}`;

const OBJECTIVE_GENERATION_AUTO_PROMPT = `You are an expert educational content designer. Based on the following course materials, generate learning objectives that are clear, measurable, and aligned with educational best practices.

COURSE: {courseName}

COURSE MATERIALS CONTENT:
{ragContext}

INSTRUCTIONS:
1. Analyze the course materials and identify key topics, concepts, and learning outcomes.
2. Generate 3-8 main (meta) learning objectives covering the major themes in the provided materials. Go outside this range only if the material genuinely demands it.
3. For each main learning objective, generate 2-5 granular (sub) objectives, or as many as the material genuinely supports. Do not pad with weak or overlapping objectives to meet a minimum. Quality and distinctiveness take priority over quantity.
4. For each granular objective, identify the most appropriate Bloom's Taxonomy level(s) based on the nature of the skill or concept being assessed (choose from: Remember, Understand, Apply, Analyze, Evaluate, Create).
5. Write each granular objective as a clear, concise statement beginning with an active verb (e.g., "Apply Newton's second law...", "Distinguish between..."). Do not add boilerplate prefixes.
6. Ensure objectives are specific to the content provided, not generic. Use the terminology from the course materials.

Bloom's level guidance (sample verbs in parentheses):
- Remember: recall a definition or fact (define, list, identify, name)
- Understand: explain, paraphrase, or classify in own words (explain, describe, summarize, classify)
- Apply: use a concept or formula in a novel scenario (apply, solve, use, demonstrate)
- Analyze: compare, differentiate, or break down components (compare, differentiate, examine, contrast)
- Evaluate: justify, critique, or defend a choice (evaluate, critique, justify, judge)
- Create: design, construct, or propose something new (design, construct, propose, formulate)

RULES FOR GRANULAR OBJECTIVES:
- Each granular objective under a main objective must test a DISTINCT concept or skill — not a rephrasing of the same idea.
- A granular objective must not restate the meta objective in different words; it must test a specific sub-skill the meta encompasses.
- Do not generate two granular objectives that a student could satisfy by knowing the same single fact.
- Each granular objective must be assessable with a question that is fundamentally different from questions assessing the other granular objectives under the same main objective.
- Let the content drive the Bloom's level — do not force a level that does not fit the material.
- Avoid granular objectives that are too shallow to assess meaningfully on their own, such as recalling a single definition or performing a trivial isolated task. Instead, embed such skills within a richer, more substantive objective.

SELF-CHECK BEFORE RETURNING YOUR RESPONSE:
- No two granular objectives under the same main objective test the same fact or skill.
- No granular objective is a rephrasing of its parent meta objective.
- Each granular objective is genuinely distinct and necessary — remove any that are redundant or only added to meet a count.
- Every meta objective has at least one granular objective.
- Every granular objective begins with an active verb and has at least one Bloom level.

Return ONLY the JSON object below. Do not include any introductory text, explanations, or markdown code fences. Respond with exactly this shape:
{
  "objectives": [
    {
      "name": "Main learning objective title",
      "granularObjectives": [
        { "text": "[Active verb] [specific skill]...", "bloomTaxonomies": ["Understand", "Apply"] },
        { "text": "[Active verb] [specific skill]...", "bloomTaxonomies": ["Analyze"] }
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

const OBJECTIVE_GENERATION_MANUAL_PROMPT = `Role: You are an expert Educational Content Designer specializing in curriculum alignment and Bloom’s Taxonomy.

Task: Reorganize the user’s objectives into a meta/granular hierarchy, and fill in granular objectives only where a meta objective has none.

Input Data:
Course Name: {courseName}
User-Provided Objectives: {userObjectivesList}
Course Materials Content: {ragContext}

Strict Processing Rules:
1. Classification: Categorize every user-provided objective as either META (overarching/broad) or GRANULAR (specific/measurable).
2. Hierarchy Mapping: Map all user-provided Granular objectives to the most relevant user-provided Meta objective.
3. Orphan Policy: If a user-provided Granular objective does not fit any existing Meta objective, only then should you create a new Meta objective to house it.

Generation Constraints (The "Gap-Fill" Rule):
1. DO NOT generate new granular objectives for any Meta objective that already contains user-provided granular objectives.
2. ONLY generate granular objectives if a Meta objective is "empty" (has no user-provided sub-objectives).

Syntax & Language:
1. Action-Oriented:
   - Write each granular objective as a clear statement beginning with an active verb (e.g., "Apply...", "Distinguish...", "Derive..."). Do not add boilerplate prefixes.
   - For user-provided granular objectives, preserve the instructor’s wording exactly. Only correct obvious grammatical errors.
2. Taxonomy: Every granular objective must include an array of applicable Bloom’s Taxonomy levels (Remember, Understand, Apply, Analyze, Evaluate, Create). For user-provided granular objectives, infer Bloom levels from the verb and scope of the text.
3. Alignment: All content must be derived strictly from the provided course content. Do not invent material that is not in the provided course content.

SELF-CHECK BEFORE RETURNING YOUR RESPONSE:
- No two granular objectives under the same Meta objective test the same fact or skill.
- Every Meta objective has at least one granular objective.
- Every granular objective has at least one Bloom level.
- User-provided granular objectives still convey the instructor’s original meaning.

Return ONLY the JSON object below. Do not include any introductory text, explanations, or markdown code fences. Respond with exactly this shape:
{
  "objectives": [
    {
      "name": "Meta Objective Name",
      "granularObjectives": [
        {
          "text": "[Active verb] [specific skill]...",
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

const QUESTION_REVIEW_PROMPT = `The following quiz questions were generated by AI for a university course. Evaluate each one and identify anything that is weak, problematic, or worth an instructor's attention — errors, poor design, inflated Bloom labels, weak distractors, anything.

COURSE: {courseName}

QUESTIONS TO EVALUATE:
{questionsJson}

For EVERY question, go through each check below and note what you find. Then set flagged to true if you found anything worth flagging.

CHECKS:

CORRECTNESS:
- Is the stated correct answer actually correct? Work through it.
- Do any distractors accidentally give a correct answer?
- Are any two answer options identical or near-identical in text?
- Note: blank feedback on the correct answer is intentional and is NOT a flag reason.
- IMPORTANT: For questions involving mathematics, flag a correctness issue ONLY if you are highly confident there is an error. If you are uncertain whether the answer is correct, do NOT flag it — leave that judgment to the instructor.

TOPIC ALIGNMENT:
- Does the question content actually test the concept named in the learning objective?
- If the question is about a completely different subject, that is a critical issue.

BLOOM LEVEL ACCURACY:
- Remember/Understand = recall or recognition. Apply = execute a procedure. Analyze = break down, compare, explain why. Evaluate = judge or critique.
- Is the stated Bloom level inflated? (e.g. labelled Analyze but only requires recalling a fact or applying a formula)

DISTRACTOR QUALITY (multiple-choice):
- Does each distractor represent a real mistake students make — an arithmetic slip, a misconception, partial understanding?
- Can a student identify the correct answer from answer length or formatting alone, without knowing the content?

QUESTION AUTHENTICITY:
- Does the question test subject knowledge, or does it test test-taking skill?
- Are distractors over-explained in a way that reveals the correct answer?

Step 2 — Set flagged to true if you found any issue in Step 1. Describe it concisely in the issue field.

CRITICAL: Return ONLY a single JSON array containing exactly one object for EVERY question listed above. Do not include markdown code blocks.

You MUST fill in the reasoning field for every question — work through the checks in plain text before deciding. This is required.

The JSON array must look like this:
[
  {
    "questionId": "<id>",
    "flagged": true,
    "issue": "Brief description of the issue."
  },
  {
    "questionId": "<id>",
    "flagged": false,
    "issue": ""
  }
]`;

const BLOOM_LEVELS = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"];

const QUESTION_TYPES = {
  MULTIPLE_CHOICE: "multiple-choice",
  FILL_IN_THE_BLANK: "fill-in-the-blank",
  CALCULATION: "calculation",
  OPEN_ENDED: "open-ended",
};

const DEFAULT_PROMPTS = {
  questionGeneration: QUESTION_GENERATION_PROMPT,
  objectiveGenerationAuto: OBJECTIVE_GENERATION_AUTO_PROMPT,
  objectiveGenerationManual: OBJECTIVE_GENERATION_MANUAL_PROMPT
};

// Default mapping from Bloom's level to ordered question-type preferences.
// The first entry is what auto-generation picks; the rest are fallbacks.
const DEFAULT_BLOOM_TYPE_PREFERENCES = {
  Remember: [QUESTION_TYPES.FILL_IN_THE_BLANK, QUESTION_TYPES.MULTIPLE_CHOICE],
  Understand: [QUESTION_TYPES.MULTIPLE_CHOICE, QUESTION_TYPES.FILL_IN_THE_BLANK],
  Apply: [QUESTION_TYPES.MULTIPLE_CHOICE, QUESTION_TYPES.FILL_IN_THE_BLANK],
  Analyze: [QUESTION_TYPES.MULTIPLE_CHOICE, QUESTION_TYPES.FILL_IN_THE_BLANK],
  Evaluate: [QUESTION_TYPES.MULTIPLE_CHOICE, QUESTION_TYPES.CALCULATION],
  Create: [QUESTION_TYPES.OPEN_ENDED, QUESTION_TYPES.MULTIPLE_CHOICE],
};

module.exports = {
  QUESTION_GENERATION_PROMPT,
  QUESTION_REVIEW_PROMPT,
  OBJECTIVE_GENERATION_AUTO_PROMPT,
  OBJECTIVE_GENERATION_MANUAL_PROMPT,
  BLOOM_LEVELS,
  QUESTION_TYPES,
  DEFAULT_PROMPTS,
  DEFAULT_BLOOM_TYPE_PREFERENCES,
};
