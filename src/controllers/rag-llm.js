// Server-side LLM endpoint using UBC GenAI Toolkit
// Routes only - all RAG initialization and operations are handled by the RAG service

// Import RAG service (singleton)
const ragService = require('../services/rag');
const llmService = require('../services/llm');
const databaseService = require('../services/database');
const { ObjectId } = require('mongodb');

// Import services
const { getMaterialCourseId } = require('../services/material');
const { hasStaffAccessInCourse } = require('../utils/course-access');
const { assertCoInstructorPermission, PERMISSION_KEYS } = require('../utils/co-instructor-permissions');
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
const { DEFAULT_PROMPTS, BLOOM_LEVELS, QUESTION_TYPES, DEFAULT_BLOOM_TYPE_PREFERENCES, QUESTION_REVIEW_PROMPT } = require('../constants/app-constants');

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
    const searchQuery = `Get relevant content about learning objective: ${learningObjectiveText || ''}, Granular Learning Objective: ${granularLearningObjectiveText || ''} for course: ${courseName || ''}`;

    const questionRagThreshold = parseFloat(process.env.RAG_SCORE_THRESHOLD) || 0.6;
    const questionRagLimit = parseInt(process.env.RAG_CHUNK_LIMIT) || 50;

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

      // Build the first-turn prompt (includes full RAG context for prompt caching)
      const buildFirstPrompt = (bloomLevel, questionType) => {
        let filled = promptTemplate
          .replace('{courseName}', courseName || '')
          .replace('{learningObjectiveText}', learningObjectiveText || '')
          .replace('{granularLearningObjectiveText}', granularLearningObjectiveText || '')
          .replace('{bloomLevel}', bloomLevel || '')
          .replace('{questionType}', questionType || '')
          .replace('{ragContext}', ragContext || '')
          .replace(
            '{typeSpecificInstructions}',
            QuestionFactory.getModel(questionType).getPromptInstruction()
          );
        if (filled.includes('{existingQuestionsContext}')) {
          filled = filled.split('{existingQuestionsContext}').join(existingQuestionsContext);
        } else if (existingQuestionsContext) {
          filled = `${filled}\n\n${existingQuestionsContext}`;
        }
        return filled;
      };

      const questionsData = [];
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      const maxRetries = 3;
      // Conversation history of successful turns for context (enables prompt caching)
      const conversationHistory = [];
      const seenQuestionTexts = new Set(
        existingQuestionTexts.map(normalizeQuestionText).filter(Boolean)
      );

      for (let i = 0; i < targetCount; i++) {
        const currentBloomLevel = bloomLevels[i % bloomLevels.length] || "Understand";
        const currentQuestionType = questionTypeForIndex(i);
        let questionData = null;
        const currentQuestionHistory = [];
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          let responseContent = null;
          let turnPrompt = "";
          try {
            if (i === 0 && attempt === 1) {
              // First question, first attempt: full prompt with RAG context
              turnPrompt = buildFirstPrompt(currentBloomLevel, currentQuestionType);
            } else if (attempt > 1) {
              // Retry: add correction hint for the specific type
              turnPrompt = (i === 0 ? buildFirstPrompt(currentBloomLevel, currentQuestionType) : `Now generate another ${currentQuestionType} question for this granular learning objective targeting Bloom's Taxonomy Level: ${currentBloomLevel}.\nEnsure the question tests a completely different concept than previously generated questions.\nRespond with ONLY a single valid JSON object. No other text.`)
                + QuestionFactory.getModel(currentQuestionType).getRetrySuffix(attempt, lastError);
            } else {
              // Subsequent questions (i > 0), first attempt: include schema hint since
              // filterPromptToType stripped all other type schemas from the Q1 prompt.
              turnPrompt = `Now generate another ${currentQuestionType} question for this granular learning objective targeting Bloom's Taxonomy Level: ${currentBloomLevel}.\nEnsure the question tests a completely different concept or facet of the objective than the previously generated questions.`;
            }

            // Full message history (successful turns + this question's retries),
            // so the provider can reuse the cached prefix.
            const messages = [
              ...conversationHistory,
              ...currentQuestionHistory,
              { role: 'user', content: turnPrompt },
            ];

            console.log(`Sending prompt to LLM (Q${i + 1}/${targetCount}, type=${currentQuestionType}, bloom=${currentBloomLevel}, attempt ${attempt}/${maxRetries})...`);

            // Schema-constrained decoding (Ollama) / json mode (OpenAI) for this
            // question type. Low temperature for focused, well-formed questions.
            const response = await generateStructured({
              messages,
              schema: QuestionFactory.getModel(currentQuestionType).getJsonSchema(),
              temperature: QUESTION_GEN_TEMPERATURE,
            });

            const qPrompt = response.usage?.promptTokens || 0;
            const qCompletion = response.usage?.completionTokens || 0;
            totalPromptTokens += qPrompt;
            totalCompletionTokens += qCompletion;
            console.log(`📊 Token Usage Q${i + 1}: prompt=${qPrompt}, completion=${qCompletion}`);

            responseContent = response.content || "";
            if (!responseContent) throw new Error("Empty response from LLM");

            const parsed = safeJsonParse(responseContent);
            const candidateQuestion = QuestionFactory
              .getModel(currentQuestionType)
              .validateAndNormalize(parsed);

            const normalizedQuestionText = normalizeQuestionText(
              getGeneratedQuestionText(candidateQuestion)
            );
            if (normalizedQuestionText && seenQuestionTexts.has(normalizedQuestionText)) {
              throw new Error(
                "Generated question duplicates a question already used for this granular objective"
              );
            }
            questionData = candidateQuestion;

            console.log(`✅ Successfully generated question ${i + 1} (${currentQuestionType})`);

            // Save to conversation history so subsequent questions have context
            conversationHistory.push({ role: 'user', content: turnPrompt });
            conversationHistory.push({ role: 'assistant', content: responseContent });
            if (normalizedQuestionText) seenQuestionTexts.add(normalizedQuestionText);

            break; // Success

          } catch (error) {
            lastError = error;
            console.warn(`❌ Q${i + 1} attempt ${attempt} failed:`, error.message);
            if (responseContent) {
              currentQuestionHistory.push({ role: 'user', content: turnPrompt });
              currentQuestionHistory.push({ role: 'assistant', content: responseContent });
            }
            if (attempt === maxRetries) {
              console.error(`Failed to generate question ${i + 1} after ${maxRetries} attempts`);
            } else {
              console.log(`Retrying... (${attempt + 1}/${maxRetries})`);
            }
          }
        }

        if (questionData) {
          // Programmatically scramble the generated options 
          if (questionData.options && questionData.correctAnswer && questionData.options[questionData.correctAnswer]) {
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

          // Add the bloom level to the question data so the UI knows which level it belongs to
          questionData.bloomLevel = currentBloomLevel;

          questionsData.push(questionData);
        }
      }

      const generationModel = getLLMModel() || 'unknown';
      logCostSummary(`Question generation (${questionsData.length} questions)`, generationModel, totalPromptTokens, totalCompletionTokens);

      if (questionsData.length === 0) {
        throw new Error(`Failed to generate any valid questions after trying all ${bloomLevels.length} bloom levels.`);
      }

      res.json({
        success: true,
        questions: questionsData,
        method: "RAG + LLM Stateful Conversation",
        tokenUsage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
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

    console.log("Retrieving RAG content from selected materials...");
    let ragContext = await ragService.getRagContentFromMaterials(
      materialIds,
      searchQuery,
      200,
      courseId
    );

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

    // Determine which prompt to use (Auto vs Manual)
    let promptTemplate;
    let fullPrompt;

    if (userObjectives && userObjectives.length > 0) {
      promptTemplate = settings?.prompts?.objectiveGenerationManual || DEFAULT_PROMPTS.objectiveGenerationManual;
      const userList = userObjectives.map((obj) => `   - ${obj}`).join('\n');
      fullPrompt = promptTemplate
        .replace('{courseName}', courseName || "Course")
        .replace('{userObjectivesList}', userList)
        .replace('{ragContext}', ragContext.substring(0, 100000) + (ragContext.length > 100000 ? "\n\n[... content truncated ...]" : ""));
    } else {
      promptTemplate = settings?.prompts?.objectiveGenerationAuto || DEFAULT_PROMPTS.objectiveGenerationAuto;
      fullPrompt = promptTemplate
        .replace('{courseName}', courseName || "Course")
        .replace('{sourceIdsList}', materialIds.join(', '))
        .replace('{ragContext}', ragContext.substring(0, 100000) + (ragContext.length > 100000 ? "\n\n[... content truncated ...]" : ""));
    }

    // Lower temperature for faithful, well-structured objectives. Schema-
    // constrained decoding guarantees the response matches OBJECTIVES_SCHEMA.
    console.log("Sending prompt to LLM service...");
    const { content: responseContent } = await generateStructured({
      prompt: fullPrompt,
      schema: OBJECTIVES_SCHEMA,
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
  return ratings;
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

    console.log(`=== REVIEWING ${questions.length} QUESTIONS FOR COURSE: ${courseName} ===`);
    const ratings = await rateQuestions(questions, courseName);

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
