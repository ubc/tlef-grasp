/**
 * Application-wide default prompt constants
 */

const QUESTION_GENERATION_PROMPT = `You are a university instructor. Generate a high-quality multiple-choice question that tests students' understanding of the provided learning objective.

Learning Objective: {learningObjectiveText}
Granular Learning Objective: {granularLearningObjectiveText}
Bloom's Taxonomy Level: {bloomLevel}

BACKGROUND COURSE MATERIAL:
{ragContext}
--- END OF MATERIAL ---

INSTRUCTIONS:
1. Write a question aligned to the learning objective and Bloom's level.
2. Use the terminology from the BACKGROUND COURSE MATERIAL above. Do not
   substitute synonyms for technical terms the material uses.
3. Generate 4 answer options (A–D), one of which is correct. Every answer
   option must be unique — no two options may have identical or near-identical
   text or describe the same concept in different words.
4. Every distractor must represent a genuine, realistic misconception a student
   might hold — not an obviously wrong or trivially absurd option.
5. Set correctAnswer to the letter of the correct option.
6. For the correct option, set "feedback" to an empty string ("").
7. For each incorrect option, write feedback that:
   - Explains the specific misconception or error in that option only
   - Does NOT mention what the correct value, sign, approach, or reasoning is
   - Does NOT use comparative language like "correct sign but wrong magnitude",
     "partially right", "incomplete", or "too large/small" when the phrasing
     implies another option is better
   - Does NOT restate the correct reasoning in different words
   - Does NOT say just "Incorrect" with no explanation
   - Focuses only on what is wrong with that specific option in isolation

QUESTION-STEM RULES:
- The stem must not contain or paraphrase the correct answer, and must not
  hint at which option is correct through phrasing, grammar, or specificity.
- Do not use "All of the above" or "None of the above" as options.
- Do not use negatively-phrased stems (e.g., "Which of the following is NOT...",
  "Which is LEAST...").

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

PROCEDURE:
1. Create the question content. If you have already generated questions in
   this conversation, your new question stem must be STRUCTURALLY different
   from them — different scenario, different numbers if numerical, different
   framing — not just reworded.
2. Generate 4 plausible answer options representing distinct misconceptions.
3. Place the correct answer in one of the positions (A, B, C, or D).
4. Write feedback for each incorrect option following the rules in instruction 8.
5. Review each feedback entry and ask: "Could a student use this feedback to
   identify the correct answer without reading the other options?" If yes,
   rewrite it before returning the JSON.

SELF-CHECK BEFORE RETURNING YOUR RESPONSE:
- The stem does not reveal or paraphrase the correct option.
- All four options are similar in length and grammatical structure.
- Each distractor represents a distinct, plausible misconception (not absurd,
  not a synonym of another option).
- The question uses the same technical terminology as the source material.
- No feedback entry tells the student what the correct answer is or compares
  options.

DO NOT copy this example — generate real content based on the material above.
Example structure only:
{
  "question": "A student applies [concept] to [scenario]. What is the result?",
  "options": {
    "A": {
      "text": "Incorrect approach based on common misconception X",
      "feedback": "This confuses [concept A] with [concept B], which applies
                   under different conditions."
    },
    "B": { "text": "Correct approach", "feedback": "" },
    "C": {
      "text": "Incorrect approach based on common misconception Y",
      "feedback": "This applies the right method but to the wrong quantity
                   in the problem."
    },
    "D": {
      "text": "Incorrect approach based on common misconception Z",
      "feedback": "This reverses the relationship between the two variables
                   involved."
    }
  },
  "correctAnswer": "B"
}

CRITICAL FORMATTING REQUIREMENTS:
- Return ONLY valid JSON.
- Do NOT wrap the JSON in markdown code blocks.
- Do NOT include any text before or after the JSON object.
- CRITICAL LaTeX FORMATTING: Enclose all mathematical notation and chemical
  formulas in \\\\( and \\\\) for inline math (e.g., \\\\( x^2 \\\\) or
  \\\\( H_2O \\\\)). Do NOT use () or $ for math delimiters.
- CRITICAL SMILES FORMATTING: Wrap SMILES strings in [SMILES][/SMILES] tags
  using proper SMILES notation only (e.g., [SMILES]O[/SMILES]).
- CRITICAL JSON ESCAPING: Ensure all LaTeX backslashes are properly escaped.
- CRITICAL: Do NOT include letter prefixes (A), B), etc.) in option text.`;

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

const QUESTION_REVIEW_PROMPT = `You are a quality reviewer for university exam questions. Score each question from 1–10 based on the criteria below. A score of 8.5 or above means the question is acceptable for use.

Each question includes: the question text, Bloom's taxonomy level, answer options (each with text and feedback for incorrect options), and the correct answer letter.

Scoring criteria — deduct points for any of the following:
1. Identical or numerically equal answer options.
2. Semantically indistinguishable options — two options conveying the same idea or leading to the same conclusion, even if worded differently.
3. Mathematical or factual errors in the correct answer or stem.
4. Factually incorrect feedback — feedback that makes a false claim about the material (not just "this is wrong", but actively incorrect statements).
5. Imprecise or overly broad correct answer (e.g., "every X" when the truth is "every X satisfying condition Y").
6. Bloom's level mismatch — the cognitive demand does not match the stated level.
7. Style or format inconsistency — the correct answer uses a noticeably different format or precision than the distractors, signalling the correct answer.
8. A stem that hints at or paraphrases the correct answer.
9. Near-duplicate question — another question in this set tests the same concept in essentially the same way.

QUESTIONS:
{questionsJson}

CRITICAL: Return ONLY a single JSON array containing exactly one object for EVERY question listed above. Never return a plain object. Never return fewer objects than there are questions.

[
  { "questionId": "<id>", "score": 9.5, "issue": "" },
  { "questionId": "<id>", "score": 6.0, "issue": "Brief description of the specific problem." }
]

Rules:
- The array must have the same number of elements as the number of questions provided.
- Score based on genuine correctness and clarity problems only, not minor stylistic preferences.
- If a question scores 8.5 or above, set issue to an empty string.
- If a question scores below 8.5, name the specific problem (e.g., "Bloom mismatch", "Feedback error", "Semantically indistinguishable options").
- Keep issue descriptions to 1-2 sentences.
- Do NOT wrap the JSON in markdown code blocks.`;

const BLOOM_LEVELS = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"];

const DEFAULT_PROMPTS = {
    questionGeneration: QUESTION_GENERATION_PROMPT,
    objectiveGenerationAuto: OBJECTIVE_GENERATION_AUTO_PROMPT,
    objectiveGenerationManual: OBJECTIVE_GENERATION_MANUAL_PROMPT
};

module.exports = {
    QUESTION_GENERATION_PROMPT,
    QUESTION_REVIEW_PROMPT,
    OBJECTIVE_GENERATION_AUTO_PROMPT,
    OBJECTIVE_GENERATION_MANUAL_PROMPT,
    BLOOM_LEVELS,
    DEFAULT_PROMPTS
};
