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

{existingQuestionsContext}

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

CONTENT FORMATTING REQUIREMENTS:
- CRITICAL LaTeX FORMATTING: Enclose all mathematical notation in \\\\( and \\\\) for inline math
  (e.g., \\\\( x^2 \\\\)). Do NOT use () or $ as math delimiters.
- CRITICAL SMILES FORMATTING: Wrap SMILES strings in [SMILES][/SMILES] tags
  (e.g., [SMILES]O[/SMILES]).
- Do NOT include letter prefixes (A), B), etc.) inside option text values.

TARGET QUESTION PARAMETERS FOR THIS TASK:
- Question Type to Generate: {questionType}
- Bloom's Taxonomy Level: {bloomLevel}

Use ONLY the instructions for the Question Type specified below:
{typeSpecificInstructions}`;

const OBJECTIVE_GENERATION_AUTO_PROMPT = `You are an expert educational content designer. Based on the following course materials, generate learning objectives that are clear, measurable, and aligned with educational best practices.

COURSE: {courseName}

COURSE MATERIALS CONTENT:
{ragContext}

INSTRUCTIONS:
1. First decide whether the material contains enough course-related, teachable content to support learning objectives. If it does not (for example, it is a personal note, placeholder text, navigation, a receipt, or unrelated content), set materialIsRelevant to false, explain why in relevanceReason, and return an empty objectives array. Never invent objectives for material that is not genuinely relevant. This relevance decision always takes priority over every instruction below — no downstream coverage or merging requirement ever justifies fabricating an objective for material you have judged irrelevant.
2. Only when materialIsRelevant is true, analyze the course materials and identify key topics, concepts, and learning outcomes.
3. Only when materialIsRelevant is true: derive the meta learning objectives from the topics in the provided outlines. Create as many as the material requires — typically one per topic, or one per group of closely related topics. There is no target number: let the material's structure decide how many there are.
4. Only when materialIsRelevant is true: Every topic in every provided outline must be covered by at least one meta learning objective. Do not omit topics to keep the list short. This coverage requirement never overrides the relevance decision in instruction 1 — if materialIsRelevant is false, return no objectives regardless of what the outline's topics contain.
5. Only when materialIsRelevant is true: treat the provided materials as one body of course content, not as separate lists. When two or more materials cover the same topic, produce ONE meta learning objective for that topic rather than a near-duplicate objective per material.
6. Only when materialIsRelevant is true: merging must never lose coverage. A topic covered by several materials yields one meta learning objective whose granular objectives reflect everything those materials teach about it, with genuinely duplicate granular objectives collapsed into one.
7. Only when materialIsRelevant is true: for each meta learning objective, write granular objectives covering that topic's key points. Create as many as the key points require. Do not pad with weak or overlapping objectives, and do not drop key points to keep the list short: distinctness matters, but coverage takes priority over brevity.
8. For each granular objective, identify the most appropriate Bloom's Taxonomy level(s) based on the nature of the skill or concept being assessed (choose from: Remember, Understand, Apply, Analyze, Evaluate, Create).
9. Write each granular objective as a clear, concise statement beginning with an active verb (e.g., "Apply...", "Distinguish between...", "Derive..."). Do not add boilerplate prefixes.
10. Ensure objectives are specific to the content provided, not generic. Use the terminology from the course materials.

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
- If materialIsRelevant is false, objectives is empty — none of the checks below apply, and no outline topic count justifies adding an objective.
- If materialIsRelevant is true: every topic in every provided outline is covered by at least one meta objective.
- No two meta objectives cover the same topic; topics appearing in more than one material were merged into a single objective.
- No two granular objectives under the same main objective test the same fact or skill.
- No granular objective is a rephrasing of its parent meta objective.
- Each granular objective is genuinely distinct and necessary — remove any that are redundant.
- Every meta objective has at least one granular objective.
- Every granular objective begins with an active verb and has at least one Bloom level.

IMPORTANT RULES:
1. Base objectives strictly on the provided material content.
2. CRITICAL LaTeX FORMATTING: You must enclose all mathematical notation and chemical formulas in \\\\( and \\\\) for inline math (e.g., \\\\( x^2 \\\\) or \\\\( H_2O \\\\)). Do NOT use parentheses () or $ for math delimiters.
3. CRITICAL SMILES FORMATTING: To draw 2D chemical structures, return the SMILES string wrapped exactly in [SMILES] and [/SMILES] tags (e.g., [SMILES]C1=CC=CC=C1[/SMILES]).`;

const OBJECTIVE_GENERATION_MANUAL_PROMPT = `Role: You are an expert Educational Content Designer specializing in curriculum alignment and Bloom’s Taxonomy.

Task: Reorganize the user’s objectives into a meta/granular hierarchy. The instructor’s objectives are authoritative, even if the selected material is sparse or unrelated.

Input Data:
Course Name: {courseName}
User-Provided Objectives: {userObjectivesList}
Course Materials Content: {ragContext}

Strict Processing Rules:
1. Classification: Categorize every user-provided objective as either META (overarching/broad) or GRANULAR (specific/measurable).
2. Hierarchy Mapping: Map all user-provided Granular objectives to the most relevant user-provided Meta objective.
3. Orphan Policy: If a user-provided Granular objective does not fit any existing Meta objective, only then should you create a new Meta objective to house it.

Generation Constraints:
1. Do not add, remove, replace, or broaden instructor-provided objectives. Use every supplied objective exactly once in the resulting hierarchy (apart from obvious grammar corrections).
2. Do not create new objectives from the selected material. The material may inform hierarchy placement only.
3. Set materialIsRelevant to true because the instructor has supplied the learning intent. Use relevanceReason to briefly state that the instructor-provided objectives were preserved.

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

FINAL INSTRUCTIONS:
1. CRITICAL LaTeX FORMATTING: You must enclose all mathematical notation and chemical formulas in \\\\( and \\\\) for inline math (e.g., \\\\( x^2 \\\\) or \\\\( H_2O \\\\)). Do NOT use parentheses () or $ for math delimiters.
2. CRITICAL SMILES FORMATTING: To draw 2D chemical structures, return the SMILES string wrapped exactly in [SMILES] and [/SMILES] tags (e.g., [SMILES]C1=CC=CC=C1[/SMILES]).`;

const POWERPOINT_IMAGE_DESCRIPTION_PROMPT = `You are an expert lecture-slide content extractor. Precisely transcribe visible text, numbers, equations, axis labels, legends, and chart labels from this PowerPoint image. Then describe the educational meaning of diagrams, charts, screenshots, or relationships. This image appears on slide {slideNumber}. Respond ONLY in valid JSON format with a single key "description". If the image is decorative, set the description to "decorative".`;

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
- IMPORTANT: This course may be in any discipline — mathematics, chemistry, physics,
  biology, or a non-quantitative subject. Whatever the discipline, if the question
  has a checkable, objective correct answer, you MUST independently recompute or
  re-derive it in the reasoning field before judging, rather than judging whether it
  sounds plausible. This includes: a numeric computation; a comparison of which of
  two values, quantities, or outcomes is greater, favoured, or correct; whether
  something satisfies a stated definition, condition, or rule; or a classification
  against criteria given in the material. Show the actual recomputation or
  derivation — the real numbers, substitution, or step-by-step reasoning — not just
  a verdict. Only leave flagged false if your own re-derivation matches the stated
  correctAnswer. Do not accept a claim as correct just because it sounds plausible
  or uses correct-sounding terminology — re-derive it.
- This re-derivation requirement applies to any checkable, objective claim, in any
  discipline. For genuinely subjective judgment calls (see BLOOM LEVEL ACCURACY and
  DISTRACTOR QUALITY below), it is still fine to leave flagged false when uncertain.
- Before re-deriving anything, check whether the question explicitly states a
  convention, definition, ordering, indexing, sign convention, unit, or setup
  particular to that problem. If it does, your re-derivation MUST use that exact
  stated convention — do not substitute a different one just because it is more
  familiar or more common in general practice. Silently swapping to a different,
  more familiar convention than the one the question actually stated produces a
  different, non-comparable answer — that is a reviewer error, not a question
  error. If your re-derivation disagrees with the stated correctAnswer, before
  flagging, explicitly re-check in the reasoning field that you used the exact
  convention/definition the question itself stated, not a default one from your
  own training or general knowledge of the field.

TOPIC ALIGNMENT:
- Does the question content actually test the concept named in the learning objective?
- If the question is about a completely different subject, that is a critical issue.

BLOOM LEVEL ACCURACY:
- Remember/Understand = recall or recognition. Apply = execute a procedure. Analyze = break down, compare, explain why. Evaluate = judge or critique.
- Only flag if you are confident the stated Bloom level is wrong — for example, labelled Analyze but a student could answer it by recalling a single fact. If the question plausibly matches the stated level, do NOT flag it.
- Do not flag a question for Bloom level if you would assign it the same level that is already stated.

DISTRACTOR QUALITY (multiple-choice):
- Does each distractor represent a real mistake students make — an arithmetic slip, a misconception, partial understanding?
- Can a student identify the correct answer from answer length or formatting alone, without knowing the content?
- Is the feedback for each incorrect option mathematically and factually accurate? It must state the actual reason that option is wrong. Feedback that describes a superficial symptom ("this assumes X") when the real reason is something else ("the system is inconsistent") is a defect — flag it.

OPEN-ENDED RUBRIC (open-ended questions only):
- Would the grading criteria apply fairly to multiple valid approaches, or is it too narrowly fitted to the sample answer?
- A rubric that only credits the exact method shown in the sample answer will incorrectly penalise students who reach the correct answer a different way. Flag this if the question admits multiple valid approaches and the rubric does not acknowledge them.

QUESTION AUTHENTICITY:
- Does the question test subject knowledge, or does it test test-taking skill?
- Are distractors over-explained in a way that reveals the correct answer?

Step 2 — Set flagged to true if you found any issue in Step 1. Describe it concisely in the issue field.

CRITICAL: Provide exactly one rating in the "ratings" array for EVERY question listed above — match each by its questionId.

You MUST fill in the reasoning field for every question — work through the checks in plain text before deciding. This is required.`;

const QUESTION_FIX_PROMPT = `An independent quality reviewer examined the {questionType} question you generated above (beginning: "{questionExcerpt}") and flagged it:

REVIEWER'S ISSUE: {issue}
REVIEWER'S REASONING: {reasoning}

Fix ONLY what is necessary to resolve this specific issue. Do not rewrite the question from scratch, and do not change any field the issue above does not implicate — if the issue is about one distractor's feedback, leave the stem, the other distractors, and their feedback exactly as they are; if the issue is about the stem or the correct answer, change only what is needed to correct it. Preserve the original question's topic, Bloom's Taxonomy level, and question type exactly.

Before finalizing, independently re-verify that your corrected content is accurate — work through it a different way than you originally constructed the question.

Respond with ONLY a single valid JSON object matching the same schema as before. No other text.`;

const OPEN_ENDED_GRADING_PROMPT = `You are an automated grader for a university course. Grade the student's answer to an open-ended question.

QUESTION:
{question}

GRADING CRITERIA (rubric):
{gradingCriteria}

SAMPLE STRONG ANSWER (one valid response — NOT the only valid response):
{sampleAnswer}

STUDENT'S ANSWER:
{studentAnswer}

INSTRUCTIONS:
1. Break the grading criteria into individual criteria and judge each one separately. For each, set "met" and write a 1-2 sentence "comment" explaining why, addressed directly to the student ("you").
2. The student's answer does not need to resemble the sample answer. Credit any valid approach that satisfies the criteria.
3. Be lenient with spelling, grammar, and phrasing when the meaning is clear. Judge substance, not style.
4. Set "pass" to true only if the answer satisfies the essential criteria. A partially correct answer that misses a core concept does not pass.
5. "overallFeedback": 2-4 sentences addressed to the student summarizing what they did well and what is missing or incorrect. Do not simply restate the sample answer.`;

const FILL_IN_THE_BLANK_GRADING_PROMPT = `You are an automated grader for a university course. A student answered a fill-in-the-blank question and their answer did NOT exactly match any accepted answer. Decide whether it is nonetheless equivalent to an accepted answer.

QUESTION (the blank is shown as _________):
{question}

EXPECTED ANSWER:
{correctAnswer}

OTHER ACCEPTED ANSWERS (instructor-provided):
{acceptableAnswers}

STUDENT'S ANSWER:
{studentAnswer}

INSTRUCTIONS:
1. Set "correct" to true ONLY if the student's answer expresses the same meaning as an accepted answer — a synonym, alternate notation, minor spelling error with clear meaning, or a longer phrasing that contains the accepted answer's meaning without contradicting it.
2. Set "correct" to false if the answer names a different concept, is only partially right, or is too vague to distinguish from a wrong answer.
3. "feedback": 1-2 sentences addressed directly to the student ("you"). If correct, briefly confirm why their phrasing is acceptable. If incorrect, explain what kind of answer was expected WITHOUT revealing the expected answer itself.`;

/**
 * Maximum characters summarized in a single call. Above this, the material is
 * summarized in batches and consolidated.
 */
const OUTLINE_DIRECT_MAX_CHARS = 100000;
/** Batch size when a material exceeds OUTLINE_DIRECT_MAX_CHARS. */
const OUTLINE_BATCH_CHARS = 80000;
/**
 * Coverage cap, so one pathological upload cannot run unbounded LLM calls.
 * Lowered from 8: at 8 batches a single outline ran to roughly 290k tokens —
 * more than four full question-generation batches — for one click on one
 * document.
 */
const OUTLINE_MAX_BATCHES = 3;
/**
 * The largest material one outline can cover, derived so the ceiling and the
 * batching that implements it cannot drift apart. Materials above this are
 * refused rather than summarized part-way: an outline that covers a fraction of
 * a document is worse than no outline, because learning objectives are
 * generated from it and questions from those objectives, so the unread tail
 * silently produces nothing while still costing full price to ingest and embed.
 * Split oversized material into chapters — each then fits, and each gets its own
 * full topic budget instead of sharing one.
 */
const OUTLINE_MAX_CONTENT_CHARS = OUTLINE_BATCH_CHARS * OUTLINE_MAX_BATCHES;

/** Caps on a stored outline, applied to model output and instructor edits alike. */
const MAX_OUTLINE_TOPICS = 40;
const MAX_OUTLINE_KEY_POINTS = 20;
const MAX_OUTLINE_CHARS = 20000;

const MATERIAL_OUTLINE_PROMPT = `You are an expert educational content designer. Summarize the following course material into a structured outline that captures everything a set of learning objectives would need to cover.

COURSE MATERIAL:
{materialContent}

INSTRUCTIONS:
1. Identify the distinct topics the material teaches, in the order the material presents them.
2. For each topic, list the key points a student is expected to learn — concepts, definitions, relationships, methods, and worked results.
3. Use the material's own terminology. Do not introduce topics the material does not cover.
4. Do not editorialize about the material's quality, and do not add study advice.
5. If the material is not teachable course content (a receipt, a syllabus administrative page, navigation text, personal notes), say so plainly in notes and return the few topics that are genuinely present.
6. Use notes only for caveats about the material itself — for example sparse text from a scan, or content that appears truncated. Leave notes as an empty string when there is nothing to report.
7. CRITICAL LaTeX FORMATTING: enclose all mathematical notation and chemical formulas in \\\\( and \\\\) for inline math (e.g. \\\\( x^2 \\\\) or \\\\( H_2O \\\\)). Do NOT use parentheses () or $ for math delimiters.
8. Produce at most {maxTopics} topics and at most {maxKeyPoints} key points per topic. Keep the outline concise — merge or drop the least important material rather than exceeding these limits.`;

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
  objectiveGenerationManual: OBJECTIVE_GENERATION_MANUAL_PROMPT,
  powerPointImageDescription: POWERPOINT_IMAGE_DESCRIPTION_PROMPT,
  openEndedGrading: OPEN_ENDED_GRADING_PROMPT,
  fillInTheBlankGrading: FILL_IN_THE_BLANK_GRADING_PROMPT,
  materialOutline: MATERIAL_OUTLINE_PROMPT,
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

/**
 * Maximum course materials an instructor can attach to one meta learning
 * objective. A product guardrail rather than a technical limit: retrieval splits
 * a fixed chunk budget across however many materials are attached, so raising
 * this does not raise token cost. Objectives created before the cap existed may
 * exceed it — reads tolerate that, writes do not.
 */
const MAX_MATERIALS_PER_OBJECTIVE = 3;

module.exports = {
  QUESTION_GENERATION_PROMPT,
  QUESTION_REVIEW_PROMPT,
  QUESTION_FIX_PROMPT,
  OBJECTIVE_GENERATION_AUTO_PROMPT,
  OBJECTIVE_GENERATION_MANUAL_PROMPT,
  POWERPOINT_IMAGE_DESCRIPTION_PROMPT,
  OPEN_ENDED_GRADING_PROMPT,
  FILL_IN_THE_BLANK_GRADING_PROMPT,
  MATERIAL_OUTLINE_PROMPT,
  OUTLINE_DIRECT_MAX_CHARS,
  OUTLINE_BATCH_CHARS,
  OUTLINE_MAX_BATCHES,
  OUTLINE_MAX_CONTENT_CHARS,
  MAX_OUTLINE_TOPICS,
  MAX_OUTLINE_KEY_POINTS,
  MAX_OUTLINE_CHARS,
  BLOOM_LEVELS,
  QUESTION_TYPES,
  DEFAULT_PROMPTS,
  DEFAULT_BLOOM_TYPE_PREFERENCES,
  MAX_MATERIALS_PER_OBJECTIVE,
};
