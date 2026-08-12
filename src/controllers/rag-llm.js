// Server-side LLM endpoint using UBC GenAI Toolkit
// Routes only - all RAG initialization and operations are handled by the RAG service

// Import RAG service (singleton)
const ragService = require('../services/rag');
const llmService = require('../services/llm');
const databaseService = require('../services/database');
const { ObjectId } = require('mongodb');

// Import services
const { getMaterialCourseId, getMaterialBySourceId } = require('../services/material');
const outlineService = require('../services/material-outline');
const { renderOutlineBlock } = require('../utils/outline-text');
const { hasStaffAccessInCourse } = require('../utils/course-access');
const { assertCoInstructorPermission, PERMISSION_KEYS } = require('../utils/co-instructor-permissions');
const { assertTaPermission, TA_PERMISSION_KEYS } = require("../utils/ta-permissions");
const { getLLMModel, getReviewModel, getLLMProvider } = require('../utils/llm-provider');
const { generateStructured } = require('../utils/structured-llm');
const { OBJECTIVES_SCHEMA, QUESTION_REVIEW_SCHEMA } = require('../constants/llm-schemas');
const { resolveGenerationQuestionType } = require('../utils/question-type-selection');
const settingsService = require('../services/settings');
const questionService = require('../services/question');
const QuestionFactory = require('../models/questions/QuestionFactory');
const {
  buildExistingQuestionsContext,
  getGeneratedQuestionText,
  normalizeQuestionText,
} = require('../utils/question-generation');
const { DEFAULT_PROMPTS, BLOOM_LEVELS, DEFAULT_BLOOM_TYPE_PREFERENCES, QUESTION_TYPES, QUESTION_REVIEW_PROMPT, QUESTION_FIX_PROMPT } = require('../constants/app-constants');

/**
 * Objective-generation context size that warrants a warning. Not a limit:
 * RAG_OBJECTIVE_CHUNK_LIMIT already bounds the context (that many chunks, each
 * capped at 1000 chars by the chunker), so at the default of 200 the context
 * tops out around 200k chars. Exceeding this means the limit was raised well
 * past its default, which is worth surfacing rather than silently trimming.
 */
const OBJECTIVE_CONTEXT_WARN_CHARS = 300000;

// Pricing per 1M tokens (input / output) for known models
const MODEL_PRICING = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.5': { input: 75.00, output: 150.00 },
  'gpt-5.4': { input: 2.50, output: 10.00 },
  'gpt-5.4-mini': { input: 0.15, output: 0.60 },
};

function calcCost(model, promptTokens, completionTokens) {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  return (promptTokens / 1_000_000) * pricing.input + (completionTokens / 1_000_000) * pricing.output;
}

function logCostSummary(label, model, promptTokens, completionTokens) {
  const cost = calcCost(model, promptTokens, completionTokens);
  const costStr = cost !== null ? `  estimated cost: $${cost.toFixed(6)}` : '  (no pricing data for model)';
  console.log(`💰 ${label} [${model}] — input: ${promptTokens} tokens, output: ${completionTokens} tokens,${costStr}`);
}

// Simple error response function
function returnErrorResponse(res, error, details = null) {
  console.error("Question generation failed:", error);
  res.status(500).json({
    success: false,
    error: "Question generation service is currently unavailable",
    details: details || error.message,
  });
}

/**
 * Parse JSON response from LLM
 * The LLM should return valid JSON with properly escaped LaTeX.
 * This function provides minimal fallback handling for edge cases.
 * @param {string|Object} jsonInput - The JSON string to parse, or already parsed object
 * @returns {Object} Parsed JSON object
 */
function extractBalancedFrom(str, start) {
  if (str[start] !== "{") {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        return str.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Try each `{` position: parse balanced span; accept first object with a non-empty "question" or
 * "stem" string (calculation questions use "stem" as the primary field).
 * Skips spurious `{` from LaTeX (e.g. \\boxed{0}) that are not full question JSON.
 */
function tryParseQuestionJsonFromLaxText(jsonString) {
  let pos = 0;
  while (pos < jsonString.length) {
    const start = jsonString.indexOf("{", pos);
    if (start === -1) {
      break;
    }
    const balanced = extractBalancedFrom(jsonString, start);
    if (balanced) {
      try {
        const obj = JSON.parse(balanced);
        if (obj && typeof obj === "object") {
          const hasQuestion = typeof obj.question === "string" && obj.question.trim();
          const hasStem = typeof obj.stem === "string" && obj.stem.trim();
          if (hasQuestion || hasStem) {
            return obj;
          }
        }
      } catch (_) {
        /* try next { */
      }
    }
    pos = start + 1;
  }
  return null;
}

function safeJsonParse(jsonInput) {
  // If it's already an object, return it
  if (typeof jsonInput === 'object' && jsonInput !== null && !Array.isArray(jsonInput)) {
    return jsonInput;
  }

  // If it's not a string, convert it
  let jsonString = typeof jsonInput === 'string' ? jsonInput : String(jsonInput);

  /**
   * Internal helper to extract JSON and attempt parsing
   * @param {string} str 
   */
  const attemptParse = (str) => {
    try {
      return JSON.parse(str);
    } catch (error) {
      // Try extracting from markdown code blocks (object or array)
      const codeBlockMatch = str.match(/```(?:json)?\s*([\[{][\s\S]*?[\]}])\s*```/);
      if (codeBlockMatch) {
        try {
          return JSON.parse(codeBlockMatch[1]);
        } catch (e) {
          // If code block also fails, continue to other fixes
        }
      }

      const fromLax = tryParseQuestionJsonFromLaxText(jsonString);
      if (fromLax) {
        return fromLax;
      }

      // Try to extract the first JSON array [ ... ] or object { ... }
      const arrayMatch = str.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try {
          return JSON.parse(arrayMatch[0]);
        } catch (e) {
          // continue
        }
      }

      const jsonMatch = str.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e) {
          // continue
        }
      }

      throw error;
    }
  };

  try {
    // 1. Try standard parse
    return attemptParse(jsonString);
  } catch (initialError) {
    try {
      // 2. Try fixing unescaped backslashes (very common with LaTeX)
      // We look for backslashes that are NOT followed by valid JSON escape characters
      // Valid: ", \, /, b, f, n, r, t, uXXXX
      // Note: We skip escaping if it's already a double backslash
      console.warn("Initial JSON parse failed. Attempting to fix unescaped backslashes...");

      // Fix: Escape backslashes that aren't valid JSON escapes
      // This handles things like \( and \) which the LLM often fails to escape properly
      const fixedBackslashes = jsonString.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, "\\\\");

      return attemptParse(fixedBackslashes);
    } catch (secondError) {
      // 3. Last resort: if it failed due to a specific character like \r or \n inside a string
      // sometimes the LLM sends literal newlines inside strings
      try {
        console.warn("Second parse attempt failed. Attempting to fix literal newlines...");
        const fixedNewlines = jsonString.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
        return attemptParse(fixedNewlines);
      } catch (thirdError) {
        // If all attempts fail, throw original error with a helpful message
        throw new Error(`Invalid JSON response from LLM. The response must be valid JSON with properly escaped LaTeX backslashes (use \\\\ for each \\ in LaTeX). Original error: ${initialError.message}`);
      }
    }
  }
}

const addDocumentToRagHandler = async (req, res) => {
  try {
    const { content, metadata, courseId } = req.body;
    const cid = courseId || metadata?.courseId || null;

    const chunkIds = await ragService.addDocumentToRAG(content, metadata, cid);

    res.json({
      success: true,
      chunkIds: chunkIds,
      message: `Document added with ${chunkIds.length} chunks`,
    });
  } catch (error) {
    console.error("Failed to add document to RAG:", error);
    res.status(500).json({
      error: "Failed to add document to RAG",
      details: error.message,
    });
  }
};

const searchRagHandler = async (req, res) => {
  try {
    const { query, limit = 5, courseId } = req.body;

    console.log("=== RAG SEARCH REQUEST ===");
    console.log("Query:", query);
    console.log("Limit:", limit);
    console.log("Course ID:", courseId);

    // Get RAG instance for specific course
    const ragInstance = await ragService.getOrCreateInstance(courseId);

    if (!ragInstance) {
      console.error("❌ Failed to get RAG instance");
      return res.status(500).json({
        error: "Failed to get RAG instance",
        fallback: "Use client-side RAG",
      });
    }

    console.log("=== SEARCHING SERVER-SIDE RAG ===");

    // Use RAG instance
    const results = await ragInstance.retrieveContext(query, { limit });

    console.log(`✅ Found ${results.length} relevant chunks`);

    res.json({
      success: true,
      results: results,
      count: results.length,
    });
  } catch (error) {
    console.error("Failed to search RAG:", error);
    res.status(500).json({
      error: "Failed to search RAG",
      details: error.message,
    });
  }
};

const generateQuestionsWithRagHandler = async (req, res) => {
  try {
    const { courseId, courseName, learningObjectiveId, learningObjectiveText, granularLearningObjectiveId, granularLearningObjectiveText, bloomLevels, materialIds, count, questionType: requestedQuestionType } = req.body;

    console.log("=== RAG + LLM GENERATION REQUEST ===");
    console.log("Course ID:", courseId);
    console.log("Course Name:", courseName);
    console.log("Learning Objective ID:", learningObjectiveId);
    console.log("Learning Objective Text:", learningObjectiveText);
    console.log("Granular Learning Objective ID:", granularLearningObjectiveId);
    console.log("Granular Learning Objective Text:", granularLearningObjectiveText);
    console.log("Bloom Levels:", bloomLevels);
    console.log("Requested Count:", count);

    // Validate required parameters
    if (!courseName || !learningObjectiveText || !granularLearningObjectiveText || !bloomLevels || !Array.isArray(bloomLevels)) {
      return res.status(400).json({
        error: "Missing required parameters",
        details: "courseName, learningObjectiveText, granularLearningObjectiveText, and bloomLevels array are required",
      });
    }
    if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_GENERATION))) return;
    if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.QUESTION_GENERATION))) return;

    // Ensure we have either an objective ID or material IDs for RAG context
    if (!learningObjectiveId && (!materialIds || !Array.isArray(materialIds) || materialIds.length === 0)) {
      return res.status(400).json({
        error: "Missing learning context",
        details: "Either learningObjectiveId or materialIds must be provided to retrieve relevant context for question generation",
      });
    }

    // Check if LLM service is available
    if (!llmService.isReady()) {
      console.log("LLM service not available");
      return returnErrorResponse(
        res,
        new Error("LLM service not initialized"),
        "LLM service is not properly configured"
      );
    }

    console.log("=== SERVER-SIDE RAG + LLM GENERATION ===");
    console.log("Course Name:", courseName);
    console.log("Learning Objective ID:", learningObjectiveId);
    console.log("Learning Objective Text:", learningObjectiveText);
    console.log("Granular Learning Objective Text:", granularLearningObjectiveText);
    console.log("Bloom Levels:", bloomLevels);
    console.log("Target Count:", count);

    // Try to use RAG for content retrieval
    console.log("=== USING getLearningObjectiveRagContent ===");
    // Use objective text as the query for RAG search
    // Fetch settings for prompt
    const settings = await settingsService.getSettings(courseId);
    const promptTemplate = settings?.prompts?.questionGeneration || DEFAULT_PROMPTS.questionGeneration;
    const existingQuestionTexts = granularLearningObjectiveId
      ? await questionService.getQuestionTextsByGranularObjective(
          courseId,
          granularLearningObjectiveId
        )
      : [];
    const existingQuestionsContext = buildExistingQuestionsContext(existingQuestionTexts);

    // Prepare RAG search query
    // Embedded and compared against chunks of course material, so it carries the
    // objective text and nothing else. Wrapper phrasing ("Get relevant content
    // about...", "for course: Biology") appears in no chunk and only drags the
    // query vector toward generic instructional language — which depressed the
    // scores enough that the threshold below filtered everything out and the
    // no-threshold fallback in rag-fanout became the real retrieval path. The
    // course is already implied: retrieval is filtered to this objective's own
    // materials.
    const searchQuery = [learningObjectiveText, granularLearningObjectiveText]
      .map((text) => String(text || '').trim())
      .filter(Boolean)
      .join('. ');

    // Both settings apply to question generation only — objective generation
    // uses RAG_OBJECTIVE_CHUNK_LIMIT and deliberately passes no score threshold.
    //
    // The chunk limit is the dominant cost in this pipeline: retrieved material
    // goes into the prefix that every request in a batch opens with, so each
    // chunk is paid for roughly once per question generated, plus once per fix.
    // At 50 (~12.5k tokens) that is around 80% of a batch's input.
    //
    // It is a TOTAL split evenly across the materials on an objective, up to
    // MAX_MATERIALS_PER_OBJECTIVE — so 50 is 50 chunks for one material but
    // ~17 each for three. Lowering it therefore bites hardest on the objectives
    // drawing on the most sources.
    //
    // It is a ceiling, not a target: only chunks clearing the threshold below
    // are retrieved, so a narrow objective costs less than a broad one without
    // this needing to change. That only holds while the threshold actually
    // discriminates — if rag-fanout starts logging "returned 0 chunks, retrying
    // without threshold" for most materials, the threshold is being bypassed,
    // every objective is paying the full ceiling, and the fix is to lower the
    // threshold (or check what is being embedded as the query), not this.
    const questionRagThreshold = parseFloat(process.env.RAG_QUESTION_SCORE_THRESHOLD) || 0.6;
    const questionRagLimit = parseInt(process.env.RAG_QUESTION_CHUNK_LIMIT) || 50;

    let ragContext = '';
    if (learningObjectiveId) {
      ragContext = await ragService.getLearningObjectiveRagContent(
        learningObjectiveId,
        searchQuery,
        courseId,
        questionRagThreshold,
        questionRagLimit
      );
    } else if (materialIds && materialIds.length > 0) {
      // Fallback to materials if objective is not yet in database
      ragContext = await ragService.getRagContentFromMaterials(
        materialIds,
        searchQuery,
        questionRagLimit,
        courseId,
        questionRagThreshold
      );
    }

    //console.log("RAG Context:", ragContext);

    // Use LLM service for generation
    const QUESTION_GEN_TEMPERATURE = 0.3;
    console.log("=== USING LLM SERVICE FOR GENERATION ===");
    console.log("Generation config:", {
      provider: getLLMProvider(),
      model: getLLMModel(),
      temperature: QUESTION_GEN_TEMPERATURE,
      maxTokens: "uncapped",
      structuredOutput: true,
    });

    try {
      // Determine question type for each bloom level using course settings
      const bloomTypePrefs = settings?.bloomTypePreferences || DEFAULT_BLOOM_TYPE_PREFERENCES;
      const targetCount = parseInt(count) || bloomLevels.length || 1;
      // When the caller pins a type (Question Bank wizard), honour it for every
      // question; otherwise fall back to the course's Bloom→type preferences.
      const questionTypeForIndex = (i) =>
        resolveGenerationQuestionType({
          requestedType: requestedQuestionType,
          bloomLevel: bloomLevels[i % bloomLevels.length] || 'Understand',
          bloomTypePreferences: bloomTypePrefs,
        });

      // The prefix every request in this batch opens with — the planner's and
      // each generator's — byte-for-byte identical, so the provider processes
      // the retrieved material once and the rest of the batch reads it from
      // cache. Anything that differs per question goes in the turn that follows
      // it, never in here.
      //
      // Every type's rules go in here, not into the individual turns. In a
      // conversation the opening message is sent once and re-read by every later
      // turn, so this is the one place they can sit without being restated —
      // and having all four present is what guarantees no question is ever asked
      // for with its rules absent, which is the bug that started this. The turn
      // itself names which type is in force.
      //
      // Content-bearing values are substituted via replacer functions: a plain
      // string replacement would interpret `$$`, `$&` and `` $` `` inside it, so
      // LaTeX in course material or objective text ("$$E = mc^2$$") would arrive
      // at the model corrupted.
      const allTypeInstructions = Object.values(QUESTION_TYPES)
        .map((type) => `--- Instructions for question type "${type}" ---\n${QuestionFactory.getModel(type).getPromptInstruction()}`)
        .join("\n\n");

      const buildSharedPrefix = () => {
        let filled = promptTemplate
          .replace('{courseName}', () => courseName || '')
          .replace('{learningObjectiveText}', () => learningObjectiveText || '')
          .replace('{granularLearningObjectiveText}', () => granularLearningObjectiveText || '')
          .replace('{bloomLevel}', 'stated per question below')
          .replace('{questionType}', 'stated per question below')
          .replace('{ragContext}', () => ragContext || '')
          .replace('{typeSpecificInstructions}', () => allTypeInstructions);
        // Instructors can replace this prompt from Settings, and a replacement
        // that drops the placeholder would send no type rules at all — while
        // every turn still points at "the instructions given at the start of
        // this conversation". Append them rather than let that dangle.
        if (!filled.includes(allTypeInstructions)) {
          filled = `${filled}\n\nUse ONLY the instructions for the question type named with each question below:\n${allTypeInstructions}`;
        }
        if (filled.includes('{existingQuestionsContext}')) {
          filled = filled.split('{existingQuestionsContext}').join(existingQuestionsContext);
        } else if (existingQuestionsContext) {
          filled = `${filled}\n\n${existingQuestionsContext}`;
        }
        return filled;
      };

      const sharedPrefix = buildSharedPrefix();

      const slotSpecs = Array.from({ length: targetCount }, (_, i) => ({
        index: i,
        bloomLevel: bloomLevels[i % bloomLevels.length] || "Understand",
        questionType: questionTypeForIndex(i),
      }));

      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      const maxRetries = 3;

      // A turn says which question it wants and nothing more. The rules are in
      // the opening message and the earlier questions are in the history, so
      // restating either would only pay for them twice.
      //
      // Naming the type on every turn is not decoration: with several types'
      // worked examples in the history, a turn that does not say which one it
      // wants leaves the model to infer it from what it can see — and what it
      // can see is the previous question, of whatever type that was.
      const buildTurn = (spec, { attempt = 1, lastError = null, withSiblingConstraint = true } = {}) => {
        let turn =
          `QUESTION ${spec.index + 1} OF ${targetCount}.\n`
          + `Write a ${spec.questionType.toUpperCase()} question at Bloom's Taxonomy Level: ${spec.bloomLevel}.\n`
          + `Follow the instructions for question type "${spec.questionType}" given at the start of this conversation, and ignore the instructions for the other types.\n`;
        if (spec.index > 0 && withSiblingConstraint) {
          turn += `It must test something different from the questions already written above — not a rephrasing, and not the same worked example, reaction, or scenario with different wording.\n`;
        }
        turn += `\nRespond with ONLY a single valid JSON object. No other text.`;
        if (attempt > 1) {
          turn += QuestionFactory.getModel(spec.questionType).getRetrySuffix(attempt, lastError);
        }
        return turn;
      };

      const seenQuestionTexts = new Set(
        existingQuestionTexts.map(normalizeQuestionText).filter(Boolean)
      );

      // One question, retried in place. Returns null when every attempt failed,
      // so one bad slot costs its own question and not the batch.
      const generateOneQuestion = async (spec, conversation) => {
        const model = QuestionFactory.getModel(spec.questionType);
        const attemptHistory = [];
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          let responseContent = null;
          const turnPrompt = buildTurn(spec, { attempt, lastError });
          try {
            const messages = [
              ...conversation,
              ...attemptHistory,
              { role: 'user', content: turnPrompt },
            ];

            console.log(`Sending prompt to LLM (Q${spec.index + 1}/${targetCount}, type=${spec.questionType}, bloom=${spec.bloomLevel}, attempt ${attempt}/${maxRetries})...`);

            // Schema-constrained decoding (Ollama) / json mode (OpenAI) for this
            // question type. Low temperature for focused, well-formed questions.
            const response = await generateStructured({
              messages,
              schema: model.getJsonSchema(),
              temperature: QUESTION_GEN_TEMPERATURE,
              operation: 'question-generate',
            });

            const qPrompt = response.usage?.promptTokens || 0;
            const qCompletion = response.usage?.completionTokens || 0;
            totalPromptTokens += qPrompt;
            totalCompletionTokens += qCompletion;
            console.log(`📊 Token Usage Q${spec.index + 1}: prompt=${qPrompt}, completion=${qCompletion}`);

            responseContent = response.content || "";
            if (!responseContent) throw new Error("Empty response from LLM");

            const parsed = safeJsonParse(responseContent);
            // Scramble here — on the raw parsed response, before anything (the
            // fix context, review, or the fix loop) ever sees a letter
            // assignment. Scrambling later would desync whichever letter a
            // reviewer's issue text names from what the instructor eventually
            // sees, since nothing re-derives that text after a later shuffle.
            scrambleMultipleChoiceOptions(parsed);
            const questionData = model.validateAndNormalize(parsed);

            const normalizedQuestionText = normalizeQuestionText(
              getGeneratedQuestionText(questionData)
            );
            if (normalizedQuestionText && seenQuestionTexts.has(normalizedQuestionText)) {
              throw new Error(
                "Generated question duplicates a question already used for this granular objective"
              );
            }
            questionData.bloomLevel = spec.bloomLevel;

            console.log(`✅ Successfully generated question ${spec.index + 1} (${spec.questionType})`);

            // The exact exchange that produced this question, kept so the fix
            // loop can reopen it later. It holds the scrambled version (not the
            // raw responseContent) so what the fixer sees matches what the
            // reviewer reasoned about. Nothing from a sibling question is in
            // here — that separation is the point of generating them apart.
            return {
              questionData,
              normalizedQuestionText,
              turnPrompt,
              rawAnswer: JSON.stringify(parsed),
              // Without the sibling constraint: the fix replays this question
              // alone, so "different from the questions already written above"
              // would point at a conversation the fixer cannot see.
              fixContext: [
                { role: 'user', content: sharedPrefix },
                { role: 'user', content: buildTurn(spec, { withSiblingConstraint: false }) },
                { role: 'assistant', content: JSON.stringify(parsed) },
              ],
            };
          } catch (error) {
            lastError = error;
            console.warn(`❌ Q${spec.index + 1} attempt ${attempt} failed:`, error.message);
            if (responseContent) {
              attemptHistory.push({ role: 'user', content: turnPrompt });
              attemptHistory.push({ role: 'assistant', content: responseContent });
            }
            if (attempt === maxRetries) {
              console.error(`Failed to generate question ${spec.index + 1} after ${maxRetries} attempts`);
            } else {
              console.log(`Retrying... (${attempt + 1}/${maxRetries})`);
            }
          }
        }
        return null;
      };

      // One conversation for the batch: the opening message, then a turn per
      // question, each seeing the answers before it.
      const conversation = [{ role: 'user', content: sharedPrefix }];
      let questionsData = [];
      const fixContexts = [];

      for (const spec of slotSpecs) {
        const result = await generateOneQuestion(spec, conversation);
        if (!result) continue;
        if (result.normalizedQuestionText) seenQuestionTexts.add(result.normalizedQuestionText);
        conversation.push({ role: 'user', content: result.turnPrompt });
        conversation.push({ role: 'assistant', content: result.rawAnswer });
        questionsData.push(result.questionData);
        fixContexts.push(result.fixContext);
      }

      const generationModel = getLLMModel() || 'unknown';
      logCostSummary(`Question generation (${questionsData.length} questions)`, generationModel, totalPromptTokens, totalCompletionTokens);

      if (questionsData.length === 0) {
        throw new Error(`Failed to generate any valid questions after trying all ${bloomLevels.length} bloom levels.`);
      }

      const reviewFixResult = await reviewAndFixQuestions(
        questionsData,
        courseName,
        fixContexts,
        learningObjectiveText,
        granularLearningObjectiveText
      );
      questionsData = reviewFixResult.questionsData;
      const { review: reviewTokens, fix: fixTokens } = reviewFixResult.tokenUsage;

      const generationTokens = { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens };
      res.json({
        success: true,
        questions: questionsData,
        method: "RAG + LLM Stateful Conversation",
        // Broken out by stage so cost attributable to the review-fix loop
        // (review + fix) can be tracked separately from generation.
        tokenUsage: {
          generation: generationTokens,
          review: reviewTokens,
          fix: fixTokens,
          total: {
            promptTokens: generationTokens.promptTokens + reviewTokens.promptTokens + fixTokens.promptTokens,
            completionTokens: generationTokens.completionTokens + reviewTokens.completionTokens + fixTokens.completionTokens,
          },
        },
      });
    } catch (llmError) {
      console.error("❌ LLM service failed:", llmError.message);
      return returnErrorResponse(res, llmError, "LLM service failed");
    }
  } catch (error) {
    console.error("RAG + LLM generation failed:", error);
    return returnErrorResponse(
      res,
      error,
      "Question generation service failed"
    );
  }
};



const deleteDocumentHandler = async (req, res) => {
  try {
    const { sourceId } = req.params;
    const userId = req.user.id;

    const courseId = await getMaterialCourseId(sourceId);
    if (!courseId) {
      return res.status(404).json({ error: "Course current material attached to not found" });
    }

    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({ error: "User is not in course" });
    }

    if (!sourceId) {
      return res.status(400).json({
        error: "sourceId is required",
      });
    }

    await ragService.deleteDocumentFromRAG(sourceId, courseId);

    res.json({
      success: true,
      message: "Document deleted successfully",
      sourceId: sourceId,
    });
  } catch (error) {
    console.error("Error deleting document:", error);
    res.status(500).json({
      error: "Failed to delete document",
      details: error.message,
    });
  }
};

const generateLearningObjectivesHandler = async (req, res) => {
  try {
    const { courseId, materialIds, courseName, userObjectives } = req.body;

    console.log("=== GENERATE LEARNING OBJECTIVES REQUEST ===");
    console.log("Course ID:", courseId);
    console.log("Material IDs:", materialIds);
    console.log("Course Name:", courseName);
    if (userObjectives && userObjectives.length > 0) {
      console.log("User Provided Objectives:", userObjectives);
    }

    // Validate input
    if (!courseId) {
      return res.status(400).json({
        success: false,
        error: "Course ID is required",
      });
    }

    if (!materialIds || !Array.isArray(materialIds) || materialIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "At least one material must be selected",
      });
    }

    // Check user permissions
    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({
        success: false,
        error: "User is not in course",
      });
    }
    if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_GENERATION))) return;
    if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.QUESTION_GENERATION))) return;

    // Get RAG instance for the course
    const ragInstance = await ragService.getOrCreateInstance(courseId);
    if (!ragInstance) {
      return res.status(500).json({
        success: false,
        error: "RAG instance is not initialized for this course",
      });
    }

    // Get RAG content from selected materials
    // Fetch settings for prompt
    const settings = await settingsService.getSettings(courseId);

    // Prepare RAG search query
    let searchQuery = `Identify the core knowledge areas, skills, competencies, theories, methodologies, 
and measurable learning outcomes that students are expected to master in ${courseName || ''}. 
Include foundational concepts, practical applications, and assessment criteria.`;
    if (userObjectives && userObjectives.length > 0) {
      searchQuery += `. Focused on: ${userObjectives.join(', ')}`;
    }

    // Objective generation is a coverage task, so it reads each material's
    // stored outline rather than a similarity ranking. It never generates one:
    // doing so here would put a multi-second summarization inside this click
    // for every material that does not have one yet.
    let ragContext = '';
    let usedOutlines = false;
    try {
      const blocks = [];
      for (const sourceId of materialIds) {
        const stored = await outlineService.getOutline(sourceId);
        if (!stored) {
          blocks.length = 0;
          break;
        }
        const material = await getMaterialBySourceId(sourceId);
        blocks.push(
          renderOutlineBlock({
            documentTitle: material?.documentTitle || '',
            sourceId,
            outline: stored.outline,
          })
        );
      }
      if (blocks.length === materialIds.length && blocks.length > 0) {
        ragContext = blocks.join('\n\n---\n\n');
        usedOutlines = true;
      }
    } catch (outlineError) {
      console.warn(
        '⚠️ Could not read material outlines; falling back to retrieval:',
        outlineError.message
      );
    }

    let objectiveRagLimit;
    if (!usedOutlines) {
      // Exactly today's behaviour, so a material without an outline generates
      // objectives no worse than it does now.
      objectiveRagLimit = parseInt(process.env.RAG_OBJECTIVE_CHUNK_LIMIT) || 200;
      console.log('Retrieving RAG content from selected materials (outline fallback)...');
      ragContext = await ragService.getRagContentFromMaterials(
        materialIds,
        searchQuery,
        objectiveRagLimit,
        courseId
      );
    }

    if ((!ragContext || ragContext.trim().length === 0) && (!userObjectives || userObjectives.length === 0)) {
      return res.status(400).json({
        success: false,
        error: "No content found in selected materials. Please ensure materials have been processed.",
      });
    }
    if (!ragContext || ragContext.trim().length === 0) {
      // Instructor-authored objectives remain useful even when an upload has no
      // extractable text. The manual prompt is expressly prohibited from
      // inventing material-derived additions.
      ragContext = "No usable material content was retrieved. Preserve the instructor-provided objectives without adding content.";
    }

    // Context size is bounded differently depending on the path. On the
    // retrieval fallback path (used when any material lacks an outline),
    // RAG_OBJECTIVE_CHUNK_LIMIT bounds it: the merge keeps at most that many
    // chunks and the chunker caps each at 1000 chars. On the outline path,
    // there is no chunk limit — size instead tracks however much text is in
    // the selected materials' outlines. This warns rather than truncates in
    // either case — a prompt this large is worth surfacing, and silently
    // cutting the context would hide that while also deleting whichever
    // materials sort last.
    if (ragContext.length > OBJECTIVE_CONTEXT_WARN_CHARS) {
      const bound = usedOutlines
        ? 'context was built from material outlines, not chunk retrieval'
        : `check RAG_OBJECTIVE_CHUNK_LIMIT (currently ${objectiveRagLimit})`;
      console.warn(
        `⚠️ Objective-generation context is ${ragContext.length} chars from ${materialIds.length} material(s) — ${bound}.`
      );
    }

    // Determine which prompt to use (Auto vs Manual)
    let promptTemplate;
    let fullPrompt;

    // Content-bearing values are substituted via replacer functions: a plain
    // string replacement would interpret `$$`, `$&` and `` $` `` inside it, so
    // LaTeX in course material ("$$E = mc^2$$") would arrive at the model
    // corrupted.
    if (userObjectives && userObjectives.length > 0) {
      promptTemplate = settings?.prompts?.objectiveGenerationManual || DEFAULT_PROMPTS.objectiveGenerationManual;
      const userList = userObjectives.map((obj) => `   - ${obj}`).join('\n');
      fullPrompt = promptTemplate
        .replace('{courseName}', () => courseName || "Course")
        .replace('{userObjectivesList}', () => userList)
        .replace('{ragContext}', () => ragContext);
    } else {
      promptTemplate = settings?.prompts?.objectiveGenerationAuto || DEFAULT_PROMPTS.objectiveGenerationAuto;
      fullPrompt = promptTemplate
        .replace('{courseName}', () => courseName || "Course")
        .replace('{sourceIdsList}', () => materialIds.join(', '))
        .replace('{ragContext}', () => ragContext);
    }

    // Lower temperature for faithful, well-structured objectives. Schema-
    // constrained decoding guarantees the response matches OBJECTIVES_SCHEMA.
    console.log("Sending prompt to LLM service...");
    const { content: responseContent } = await generateStructured({
      prompt: fullPrompt,
      schema: OBJECTIVES_SCHEMA,
      operation: 'objective-generate',
      temperature: 0.4,
    });
    console.log("Full Prompt: ", fullPrompt);

    console.log("✅ LLM service response received");

    if (!responseContent) {
      throw new Error("Empty response from LLM");
    }

    console.log("Response content:", responseContent.substring(0, 500));

    // Try to parse JSON response
    try {
      // Use safe JSON parser that handles LaTeX and other edge cases. The
      // structured-output schema guarantees the canonical objectives shape.
      const objectivesData = safeJsonParse(responseContent);

      // Validate the structure
      if (!objectivesData.objectives || !Array.isArray(objectivesData.objectives)) {
        throw new Error("Invalid response format: missing objectives array");
      }

      // With no instructor-supplied objectives, a negative relevance verdict is
      // a successful outcome: do not turn unrelated uploads into fabricated LOs.
      if ((!userObjectives || userObjectives.length === 0) && !objectivesData.materialIsRelevant) {
        return res.status(422).json({
          success: false,
          code: "MATERIAL_NOT_RELEVANT",
          error: "We couldn't find enough course-related content in this material to create learning objectives.",
          details: objectivesData.relevanceReason || "Try another course material, or add your own learning objectives.",
        });
      }

      // Clean and validate objectives
      const validBloomLevels = BLOOM_LEVELS;
      const cleanedObjectives = objectivesData.objectives
        .filter((obj) => obj.name && obj.name.trim() && obj.granularObjectives && Array.isArray(obj.granularObjectives))
        .map((obj) => {
          return {
            name: obj.name.trim(),
            granularObjectives: obj.granularObjectives
              .filter((go) => go && (typeof go === "string" ? go.trim() : (go.text && go.text.trim())))
              .map((go) => {
                const text = typeof go === "string" ? go.trim() : go.text.trim();
                let bloomTaxonomies = ["Understand"]; // default
                if (go.bloomTaxonomies && Array.isArray(go.bloomTaxonomies)) {
                  const mappedBlooms = go.bloomTaxonomies.filter(b => validBloomLevels.includes(b));
                  if (mappedBlooms.length > 0) bloomTaxonomies = mappedBlooms;
                }
                return { text, bloomTaxonomies };
              }),
          };
        })
        .filter((obj) => obj.granularObjectives.length > 0);

      if (cleanedObjectives.length === 0) {
        throw new Error("No valid objectives generated");
      }

      console.log(`✅ Generated ${cleanedObjectives.length} learning objectives`);

      res.json({
        success: true,
        objectives: cleanedObjectives,
      });
    } catch (parseError) {
      console.error("Error parsing LLM response:", parseError);
      console.error("Response content:", responseContent);
      return res.status(500).json({
        success: false,
        error: "Failed to parse generated objectives",
        details: parseError.message,
        rawResponse: responseContent.substring(0, 500),
      });
    }
  } catch (error) {
    console.error("Error generating learning objectives:", error);
    returnErrorResponse(res, error, error.message);
  }
};

async function rateQuestions(questions, courseName) {
  const formattedQuestions = questions.map(q => {
    // Determine the question stem based on type (MC vs others)
    const questionStem = (q.questionType === 'multiple-choice') ? (q.title || q.question) : (q.stem || q.question);

    const base = {
      id: q.id,
      questionType: q.questionType || 'multiple-choice',
      bloomLevel: q.bloomLevel,
      learningObjective: q.learningObjectiveText,
      granularObjective: q.granularObjectiveText,
      questionStem: questionStem
    };

    if (base.questionType === 'multiple-choice') {
      base.options = Object.fromEntries(
        Object.entries(q.options || {}).map(([k, v]) => [
          k,
          typeof v === 'string' ? { text: v, feedback: '' } : { text: v.text || '', feedback: v.feedback || '' }
        ])
      );
      base.correctAnswer = q.correctAnswer;
    } else if (base.questionType === 'fill-in-the-blank') {
      base.acceptableAnswers = q.acceptableAnswers || [];
    } else if (base.questionType === 'calculation') {
      base.formula = q.calculationFormula || '';
      base.variables = q.calculationVariables || [];
    } else if (base.questionType === 'open-ended') {
      base.sampleAnswer = q.openEndedSampleAnswer || '';
      base.gradingCriteria = q.openEndedGradingCriteria || '';
    }

    return base;
  });

  const prompt = QUESTION_REVIEW_PROMPT
    .replace('{courseName}', courseName || 'N/A')
    .replace('{questionsJson}', JSON.stringify(formattedQuestions, null, 2));

  // Low temperature for consistent, conservative reviewing. Schema-constrained
  // decoding guarantees the { ratings: [...] } shape.
  const { content: responseContent, usage } = await generateStructured({
    prompt,
    schema: QUESTION_REVIEW_SCHEMA,
    temperature: 0.1,
    operation: 'question-review',
    model: getReviewModel() || null,
  });
  if (usage) {
    const reviewModel = getReviewModel() || 'unknown';
    logCostSummary(`Question review (${questions.length} questions)`, reviewModel, usage.promptTokens || 0, usage.completionTokens || 0);
  }
  console.log("=== LLM REVIEW RESPONSE ===");
  console.log(responseContent);
  console.log("=== END LLM REVIEW RESPONSE ===");
  const parsed = safeJsonParse(responseContent);
  // The schema wraps the array as { ratings: [...] }; tolerate a bare array or a
  // single object too, in case the OpenAI (prompt-driven) path deviates.
  let ratings = parsed && parsed.ratings !== undefined ? parsed.ratings : parsed;
  if (!Array.isArray(ratings) && ratings && typeof ratings === 'object') {
    ratings = [ratings];
  }
  if (!Array.isArray(ratings)) throw new Error("Review response is not a JSON array");
  return {
    ratings,
    usage: { promptTokens: usage?.promptTokens || 0, completionTokens: usage?.completionTokens || 0 },
  };
}

function firstWords(text, count) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).slice(0, count).join(" ");
}

// Shuffle an MCQ's option lettering so the correct answer isn't always in
// the same position. Must run immediately when a question (or a fix) is
// produced — before it's pushed to conversation history or reviewed — and
// never again after that. Scrambling later would desync whichever letter a
// reviewer's issue text names (shown to the instructor via reviewIssue /
// autoFixReason) from the lettering the instructor actually ends up seeing,
// since nothing re-derives that text after a later shuffle.
function scrambleMultipleChoiceOptions(questionData) {
  if (!questionData.options || !questionData.correctAnswer || !questionData.options[questionData.correctAnswer]) {
    return;
  }
  const optionKeys = ['A', 'B', 'C', 'D'].filter(k => questionData.options[k] !== undefined);
  const optionValues = optionKeys.map(k => questionData.options[k]);

  for (let j = optionValues.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [optionValues[j], optionValues[k]] = [optionValues[k], optionValues[j]];
  }

  const originalCorrectValue = questionData.options[questionData.correctAnswer];
  let newCorrectKey = questionData.correctAnswer;

  for (let j = 0; j < optionKeys.length; j++) {
    const key = optionKeys[j];
    questionData.options[key] = optionValues[j];
    if (optionValues[j] === originalCorrectValue) {
      newCorrectKey = key;
    }
  }

  const correctOptionLetter = questionData.correctAnswer;
  questionData.correctAnswer = newCorrectKey;
  console.log(`🔀 Programmatically shuffled correct answer from ${correctOptionLetter} to ${newCorrectKey}`);
}

// Attempt a single targeted-patch fix for one flagged question, branching off
// its own slice of the original generation conversation. Never throws — a
// failed attempt (validation never succeeds within maxRetries) resolves with
// fixed: null so the caller can still account for the tokens spent and retry
// in a later cycle rather than losing the question.
async function attemptFix(questionData, rating, questionContext, maxRetries, temperature) {
  const questionType = questionData.questionType || questionData.type;
  const model = QuestionFactory.getModel(questionType);
  const questionExcerpt = firstWords(getGeneratedQuestionText(questionData), 12);

  let lastError = null;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  const localHistory = [];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const turnPrompt = attempt === 1
      ? QUESTION_FIX_PROMPT
          .replace("{questionType}", questionType)
          .replace("{questionExcerpt}", questionExcerpt)
          .replace("{issue}", rating?.issue || "(no issue text provided)")
          .replace("{reasoning}", rating?.reasoning || "(no reasoning provided)")
      : model.getRetrySuffix(attempt, lastError);

    const messages = [...questionContext, ...localHistory, { role: "user", content: turnPrompt }];
    let responseContent = null;
    try {
      const response = await generateStructured({ messages, schema: model.getJsonSchema(), temperature, operation: 'question-fix' });
      totalPromptTokens += response.usage?.promptTokens || 0;
      totalCompletionTokens += response.usage?.completionTokens || 0;
      responseContent = response.content || "";
      if (!responseContent) throw new Error("Empty response from LLM");

      const parsed = safeJsonParse(responseContent);
      // Scramble this fix's own output immediately too — same reasoning as
      // in the generation loop: it must happen before this ever gets
      // re-reviewed or shipped, and never again after.
      scrambleMultipleChoiceOptions(parsed);
      const fixed = model.validateAndNormalize(parsed);
      return { fixed, promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens };
    } catch (error) {
      lastError = error;
      console.warn(`Review-fix: fix attempt ${attempt}/${maxRetries} failed for a ${questionType} question:`, error.message);
      if (responseContent) {
        localHistory.push({ role: "user", content: turnPrompt });
        localHistory.push({ role: "assistant", content: responseContent });
      }
    }
  }

  return { fixed: null, promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens };
}

// Apply a batch of review ratings onto questionsData (by request-scoped index
// id) and return which of the given indices are still flagged. Mutates
// questionsData in place for reviewFlag/reviewIssue, same as generation does
// for bloomLevel elsewhere in this file.
function applyRatings(questionsData, ratings, indices) {
  const byIndex = new Map();
  (ratings || []).forEach((r) => {
    const idx = parseInt(r.questionId, 10);
    if (Number.isInteger(idx)) byIndex.set(idx, r);
  });
  const stillFlagged = [];
  for (const i of indices) {
    const rating = byIndex.get(i);
    if (rating && rating.flagged) {
      questionsData[i].reviewFlag = true;
      questionsData[i].reviewIssue = rating.issue || "";
      stillFlagged.push(i);
    } else {
      questionsData[i].reviewFlag = false;
      questionsData[i].reviewIssue = "";
    }
  }
  return { byIndex, stillFlagged };
}

/**
 * Bounded review→fix loop: review the freshly generated batch, and for
 * whatever gets flagged, attempt a targeted-patch fix (branching off that
 * question's own slice of the generation conversation) followed by a full
 * independent re-review of just the fixed subset — up to MAX_CYCLES times.
 * Whatever is still flagged after the cap ships to the instructor exactly as
 * before this feature existed: not a new failure mode, just reached after
 * more attempts. See the "Bounded Review→Fix Loop" plan for the full design
 * rationale (review must stay independent; fixes must be targeted patches,
 * not full regenerations; the loop bound is code-controlled, not model-decided).
 */
async function reviewAndFixQuestions(
  questionsData,
  courseName,
  fixContexts,
  learningObjectiveText,
  granularLearningObjectiveText
) {
  // Each fix call replays its question's whole context — the opening message,
  // retrieved material and all — so this is the most expensive knob in the loop.
  //
  // Its value is currently capped by something else: a question only reaches a
  // second cycle if the re-review still flags it, and the re-review is a fresh
  // general pass with no memory of the original issue. So a patch that did not
  // actually resolve what was flagged is cleared anyway and exits after cycle 1.
  // Giving the re-review the original issue to verify is what would let a second
  // cycle act on the questions it was raised for.
  const MAX_CYCLES = parseInt(process.env.REVIEW_FIX_MAX_CYCLES) || 2;
  const MAX_FIX_RETRIES = 2;
  const FIX_TEMPERATURE = 0.3;

  // Tallied across every rateQuestions() call (initial + all re-reviews) and
  // every attemptFix() call (successful or not) in this loop, so the caller
  // can report the review-fix loop's cost separately from generation's.
  let reviewPromptTokens = 0;
  let reviewCompletionTokens = 0;
  let fixPromptTokens = 0;
  let fixCompletionTokens = 0;
  const tokenUsage = () => ({
    review: { promptTokens: reviewPromptTokens, completionTokens: reviewCompletionTokens },
    fix: { promptTokens: fixPromptTokens, completionTokens: fixCompletionTokens },
  });

  const forReview = (q, i) => ({
    ...q,
    id: String(i),
    learningObjectiveText,
    granularObjectiveText: granularLearningObjectiveText,
  });

  let ratings;
  try {
    const initialReview = await rateQuestions(questionsData.map(forReview), courseName);
    ratings = initialReview.ratings;
    reviewPromptTokens += initialReview.usage.promptTokens;
    reviewCompletionTokens += initialReview.usage.completionTokens;
  } catch (error) {
    console.error("Review-fix loop: initial review failed, shipping questions unreviewed:", error.message);
    return { questionsData, tokenUsage: tokenUsage() };
  }

  const allIndices = questionsData.map((_, i) => i);
  const { byIndex: initialRatingByIndex, stillFlagged: initialFlagged } = applyRatings(questionsData, ratings, allIndices);
  const initialFlaggedCount = initialFlagged.length;

  let flagged = initialFlagged;
  let issueByIndex = initialRatingByIndex;
  const cycleLog = [];

  for (let cycle = 1; cycle <= MAX_CYCLES && flagged.length > 0; cycle++) {
    const results = await Promise.all(
      flagged.map((i) =>
        attemptFix(
          questionsData[i],
          issueByIndex.get(i),
          fixContexts[i],
          MAX_FIX_RETRIES,
          FIX_TEMPERATURE
        )
      )
    );

    let cyclePromptTokens = 0;
    let cycleCompletionTokens = 0;
    const patched = [];
    const failedToFix = [];

    results.forEach((result, idx) => {
      const i = flagged[idx];
      cyclePromptTokens += result.promptTokens;
      cycleCompletionTokens += result.completionTokens;

      if (result.fixed) {
        const preservedBloom = questionsData[i].bloomLevel;
        const fixedIssueText = issueByIndex.get(i)?.issue || "an issue";
        questionsData[i] = result.fixed;
        questionsData[i].bloomLevel = preservedBloom;
        questionsData[i].autoFixLastIssue = fixedIssueText;
        patched.push(i);
      } else {
        failedToFix.push(i);
      }
    });

    fixPromptTokens += cyclePromptTokens;
    fixCompletionTokens += cycleCompletionTokens;
    const fixModel = getLLMModel() || "unknown";
    logCostSummary(`Question fix (cycle ${cycle}, ${patched.length}/${flagged.length} fixed)`, fixModel, cyclePromptTokens, cycleCompletionTokens);

    let stillFlaggedAfterFix = [];
    if (patched.length > 0) {
      let reReviewRatings = [];
      try {
        const reReview = await rateQuestions(patched.map((i) => forReview(questionsData[i], i)), courseName);
        reReviewRatings = reReview.ratings;
        reviewPromptTokens += reReview.usage.promptTokens;
        reviewCompletionTokens += reReview.usage.completionTokens;
      } catch (error) {
        console.error(`Review-fix loop: re-review failed in cycle ${cycle}, keeping fixed questions flagged as a precaution:`, error.message);
        for (const i of patched) {
          questionsData[i].reviewFlag = true;
          questionsData[i].reviewIssue = questionsData[i].autoFixLastIssue || questionsData[i].reviewIssue || "";
        }
        stillFlaggedAfterFix = [...patched];
      }
      if (reReviewRatings.length) {
        const { byIndex: reReviewByIndex, stillFlagged } = applyRatings(questionsData, reReviewRatings, patched);
        for (const i of patched) {
          if (!stillFlagged.includes(i)) {
            questionsData[i].wasAutoFixed = true;
            questionsData[i].autoFixReason = `Automatically fixed after an AI review found: ${questionsData[i].autoFixLastIssue || "an issue"}`;
          }
        }
        issueByIndex = new Map([...issueByIndex, ...reReviewByIndex]);
        stillFlaggedAfterFix = stillFlagged;
      }
    }

    cycleLog.push(`cycle ${cycle} fixed ${patched.length - stillFlaggedAfterFix.length}/${flagged.length}`);
    flagged = [...failedToFix, ...stillFlaggedAfterFix];
  }

  console.log(
    `🔧 Review-fix loop: ${initialFlaggedCount} flagged initially` +
      (cycleLog.length ? ` → ${cycleLog.join(" → ")}` : "") +
      ` → ${flagged.length} flagged, ${cycleLog.length} cycle(s) used`
  );

  for (const q of questionsData) {
    delete q.autoFixLastIssue;
  }

  return { questionsData, tokenUsage: tokenUsage() };
}

const reviewQuestionsHandler = async (req, res) => {
  try {
    console.log("=== REVIEW QUESTIONS HANDLER CALLED ===");
    console.log("Body keys:", Object.keys(req.body || {}));
    const { questions } = req.body;
    console.log("Questions received:", Array.isArray(questions) ? questions.length : typeof questions);
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      console.log("❌ Validation failed: questions array is missing or empty");
      return res.status(400).json({ success: false, error: "questions array is required" });
    }

    // Resolve Course Name from courseId
    const courseId = questions[0]?.courseId || null;
    let courseName = "N/A";
    if (courseId && ObjectId.isValid(courseId)) {
      try {
        const db = await databaseService.connect();
        const course = await db.collection('grasp_course').findOne({ _id: new ObjectId(courseId) });
        if (course) {
          courseName = course.courseName || course.name || "N/A";
        }
      } catch (dbErr) {
        console.warn("Failed to fetch course details for review:", dbErr.message);
      }
    }
    if (courseId && !(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_GENERATION))) return;
    if (courseId && !(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.QUESTION_GENERATION))) return;

    console.log(`=== REVIEWING ${questions.length} QUESTIONS FOR COURSE: ${courseName} ===`);
    const { ratings } = await rateQuestions(questions, courseName);

    const results = [];

    for (const q of questions) {
      const rating = ratings.find(r => r.questionId === q.id) || { flagged: false, issue: '' };
      console.log(`Question ${q.id}: flagged=${rating.flagged}`);

      results.push({
        originalId: q.id,
        replaced: false,
        flagged: !!rating.flagged,
        issue: rating.flagged ? (rating.issue || 'Blocked by reviewer') : '',
        question: null
      });
    }

    const flaggedCount = results.filter(r => r.flagged).length;
    console.log(`✅ Review complete: ${flaggedCount} flagged`);

    res.json({ success: true, results });
  } catch (error) {
    console.error('Error reviewing questions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  addDocumentToRagHandler,
  searchRagHandler,
  generateQuestionsWithRagHandler,
  deleteDocumentHandler,
  generateLearningObjectivesHandler,
  reviewQuestionsHandler
};
