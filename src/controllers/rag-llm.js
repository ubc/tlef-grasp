// Server-side LLM endpoint using UBC GenAI Toolkit
// Routes only - all RAG initialization and operations are handled by the RAG service

// Import RAG service (singleton)
const ragService = require('../services/rag');

// Import LLM service (singleton)
const llmService = require('../services/llm');

// Import services
const { getMaterialCourseId } = require('../services/material');
const { isUserInCourse } = require('../services/user-course');
const settingsService = require('../services/settings');
const { DEFAULT_PROMPTS, BLOOM_LEVELS } = require('../constants/app-constants');

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
function resolveQuestionTypeFromPayload(data, requestedType) {
  const t = data?.type || data?.questionType;
  if (t === "fill-in-the-blank" || t === "multiple-choice") {
    return t;
  }
  return requestedType;
}

/** Map array shapes and letter-only `answer` to MC fields when possible. */
function normalizeMultipleChoiceAliases(data) {
  const d = { ...data };
  if (Array.isArray(d.choices) && d.choices.length >= 4) {
    d.options = {
      A: String(d.choices[0]),
      B: String(d.choices[1]),
      C: String(d.choices[2]),
      D: String(d.choices[3]),
    };
  }
  if (Array.isArray(d.options) && d.options.length >= 4) {
    d.options = {
      A: String(d.options[0]),
      B: String(d.options[1]),
      C: String(d.options[2]),
      D: String(d.options[3]),
    };
  }
  if (
    (d.correctAnswer == null || String(d.correctAnswer).trim() === "") &&
    typeof d.answer === "string" &&
    /^[ABCD]$/i.test(d.answer.trim())
  ) {
    d.correctAnswer = d.answer.trim().toUpperCase();
  }
  return d;
}

/**
 * Models often return { question, answer, explanation } for MC. If `answer` is the correct
 * option text (not A–D), synthesize A–D options and a matching correctAnswer letter.
 */
function repairLooseMultipleChoiceShape(data) {
  let d = normalizeMultipleChoiceAliases(data);
  const hasFullOptions =
    d.options &&
    typeof d.options === "object" &&
    !Array.isArray(d.options) &&
    ["A", "B", "C", "D"].every(
      (k) => d.options[k] != null && String(d.options[k]).trim()
    );
  if (hasFullOptions) {
    return d;
  }
  if (typeof d.answer !== "string" || !d.answer.trim()) {
    return d;
  }
  const correctText = d.answer.trim();
  if (/^[ABCD]$/i.test(correctText)) {
    return d;
  }
  const distractors = [
    "Divergent.",
    "Convergent only if extra conditions hold that are not stated.",
    "The usual convergence test does not apply to this series.",
    "The partial sums do not approach a finite limit.",
  ]
    .filter((x) => x.toLowerCase() !== correctText.toLowerCase())
    .slice(0, 3);
  while (distractors.length < 3) {
    distractors.push(`Incorrect alternative ${distractors.length + 1}.`);
  }
  const letters = ["A", "B", "C", "D"];
  const correctIdx = Math.floor(Math.random() * 4);
  const options = {};
  let u = 0;
  for (let i = 0; i < 4; i++) {
    options[letters[i]] = i === correctIdx ? correctText : distractors[u++];
  }
  return {
    ...d,
    type: d.type || "multiple-choice",
    options,
    correctAnswer: letters[correctIdx],
  };
}

/**
 * Validate LLM JSON for the requested question type and return a normalized object for the API.
 */
function validateAndNormalizeQuestionData(data, requestedType) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid question payload");
  }
  if (!data.question || typeof data.question !== "string" || !data.question.trim()) {
    throw new Error("Missing required field: question");
  }

  const resolvedType = resolveQuestionTypeFromPayload(data, requestedType);
  if (resolvedType !== requestedType) {
    throw new Error(
      `Response type "${resolvedType}" does not match requested questionType "${requestedType}"`
    );
  }

  if (resolvedType === "fill-in-the-blank") {
    const merged = { ...data };
    if (
      (merged.correctAnswer == null || String(merged.correctAnswer).trim() === "") &&
      typeof merged.answer === "string" &&
      merged.answer.trim()
    ) {
      merged.correctAnswer = merged.answer.trim();
    }
    const ca = merged.correctAnswer;
    if (ca === undefined || ca === null || String(ca).trim() === "") {
      throw new Error(
        "Missing required field: correctAnswer (expected short answer text for fill-in-the-blank)"
      );
    }
    const canonical = typeof ca === "string" ? ca.trim() : String(ca);
    let acceptable = merged.acceptableAnswers;
    if (!Array.isArray(acceptable) || acceptable.length === 0) {
      acceptable = [canonical];
    } else {
      acceptable = acceptable
        .map((a) => (typeof a === "string" ? a.trim() : String(a)))
        .filter(Boolean);
      if (acceptable.length === 0) {
        acceptable = [canonical];
      }
    }
    return {
      type: "fill-in-the-blank",
      questionType: "fill-in-the-blank",
      question: merged.question.trim(),
      correctAnswer: canonical,
      acceptableAnswers: acceptable,
      explanation: merged.explanation != null ? String(merged.explanation) : "",
      options: null,
    };
  }

  const mcData = repairLooseMultipleChoiceShape(data);

  if (!mcData.options || typeof mcData.options !== "object" || Array.isArray(mcData.options)) {
    throw new Error(
      'Missing required field: options (object with keys A, B, C, D). For multiple-choice do not use a single "answer" string instead of four options and correctAnswer A–D.'
    );
  }
  for (const key of ["A", "B", "C", "D"]) {
    const opt = mcData.options[key];
    if (opt === undefined || opt === null || String(opt).trim() === "") {
      throw new Error(`Missing or empty option ${key}`);
    }
  }
  let letter = mcData.correctAnswer;
  if (typeof letter === "number") {
    letter = ["A", "B", "C", "D"][letter];
  }
  if (typeof letter !== "string" || !/^[ABCD]$/i.test(letter.trim())) {
    throw new Error("correctAnswer must be A, B, C, or D for multiple-choice");
  }
  letter = letter.trim().toUpperCase();
  return {
    type: "multiple-choice",
    questionType: "multiple-choice",
    question: mcData.question.trim(),
    options: {
      A: String(mcData.options.A).trim(),
      B: String(mcData.options.B).trim(),
      C: String(mcData.options.C).trim(),
      D: String(mcData.options.D).trim(),
    },
    correctAnswer: letter,
    explanation: mcData.explanation != null ? String(mcData.explanation) : "",
  };
}

/**
 * Balanced {...} from str[start] where str[start] === "{" (respects JSON strings).
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
 * Try each `{` position: parse balanced span; accept first object with a non-empty "question" string.
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
        if (
          obj &&
          typeof obj === "object" &&
          typeof obj.question === "string" &&
          obj.question.trim()
        ) {
          return obj;
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
  const jsonString = typeof jsonInput === 'string' ? jsonInput : String(jsonInput);
  
  try {
    // Try direct parsing - the LLM should return valid JSON
    return JSON.parse(jsonString);
  } catch (error) {
    // Fallback: try extracting JSON from markdown code blocks if present
    try {
      const codeBlockMatch = jsonString.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        return JSON.parse(codeBlockMatch[1]);
      }

      const fromLax = tryParseQuestionJsonFromLaxText(jsonString);
      if (fromLax) {
        return fromLax;
      }
      
      throw error;
    } catch (fallbackError) {
      // If parsing fails, the LLM response was invalid JSON
      // This should not happen if the LLM follows the prompt instructions
      throw new Error(`Invalid JSON response from LLM. The response must be valid JSON with properly escaped LaTeX backslashes (use \\\\ for each \\ in LaTeX). Original error: ${error.message}`);
    }
  }
}

function jsonOnlyRetrySuffix(attempt, questionType) {
  const mcSchema = `For multiple-choice, required keys are exactly: "type":"multiple-choice", "question", "options" (object with four string values for keys "A","B","C","D" only), "correctAnswer" (one letter: A, B, C, or D), "explanation". Do NOT use a top-level "answer" field instead of "options" + "correctAnswer".`;
  const fibSchema = `For fill-in-the-blank: "question" must be one unfinished declarative sentence (not What/Which/How), with exactly one blank written as _________ (nine underscores). Include "correctAnswer", "acceptableAnswers" array, "explanation". No "options".`;
  const schema = questionType === "multiple-choice" ? mcSchema : fibSchema;
  return `

---
REGENERATION (attempt ${attempt}): Previous output was invalid JSON or the wrong shape.
${schema}
Reply with ONE raw JSON object only. Forbidden: markdown, headings, lists, prose outside JSON, code fences.
Your entire message must start with { and end with }.`;
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
    const { courseId, courseName, learningObjectiveId, learningObjectiveText, granularLearningObjectiveText, bloomLevel, questionType } = req.body;

    console.log("=== RAG + LLM GENERATION REQUEST ===");
    console.log("Course ID:", courseId);
    console.log("Course Name:", courseName);
    console.log("Learning Objective ID:", learningObjectiveId);
    console.log("Learning Objective Text:", learningObjectiveText);
    console.log("Granular Learning Objective Text:", granularLearningObjectiveText);
    console.log("Bloom Level:", bloomLevel);
    console.log("Question Type:", questionType);

    // Validate required parameters
    if (!courseName || !learningObjectiveId || !learningObjectiveText || !granularLearningObjectiveText || !bloomLevel) {
      return res.status(400).json({
        error: "Missing required parameters",
        details: "courseName, learningObjectiveId, learningObjectiveText, granularLearningObjectiveText, and bloomLevel are required",
      });
    }

    // Validate question types
    const ALLOWED_QUESTION_TYPES = ["multiple-choice", "fill-in-the-blank"];
    if (!questionType || !ALLOWED_QUESTION_TYPES.includes(questionType)) {
      return res.status(400).json({
        error: "Invalid or missing questionType",
        details: `questionType must be one of: ${ALLOWED_QUESTION_TYPES.join(", ")}`,
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
    console.log("Bloom Level:", bloomLevel);

    // Try to use RAG for content retrieval
    console.log("=== USING getLearningObjectiveRagContent ===");
    // Use objective text as the query for RAG search
      // Fetch settings for prompt
      const settings = await settingsService.getSettings(courseId);
      const promptTemplate = settings?.prompts?.questionGeneration || DEFAULT_PROMPTS.questionGeneration;

      // Prepare RAG search query
      const searchQuery = `Get relevant content about learning objective: ${learningObjectiveText || ''}, Granular Learning Objective: ${granularLearningObjectiveText || ''} for course: ${courseName || ''}`;

      const ragContext = await ragService.getLearningObjectiveRagContent(
        learningObjectiveId,
        searchQuery,
        courseId
      );

      console.log("RAG Context:", ragContext);

      // Use LLM service for generation
      console.log("=== USING LLM SERVICE FOR GENERATION ===");

      try {
        // Get LLM instance from service
        const llmModule = await llmService.getLLMInstance();

      // Create prompt with RAG context (optional retry suffix nudges small/local models toward JSON-only)
      const buildBasePrompt = () =>
        promptTemplate
          .replace('{learningObjectiveText}', learningObjectiveText || '')
          .replace('{granularLearningObjectiveText}', granularLearningObjectiveText || '')
          .replace('{bloomLevel}', bloomLevel || '')
          .replace('{questionType}', questionType || '')
          .replace('{ragContext}', ragContext || '');

      const createPrompt = (attempt) =>
        attempt > 1 ? buildBasePrompt() + jsonOnlyRetrySuffix(attempt, questionType) : buildBasePrompt();

      // Retry logic: regenerate until we get valid JSON
      const maxRetries = 5;
      let questionData = null;
      let lastError = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`Sending prompt to LLM service (attempt ${attempt}/${maxRetries})...`);
          const promptForAttempt = createPrompt(attempt);
          const response = await llmModule.sendMessage(promptForAttempt);
          console.log("Full Prompt: ", promptForAttempt);

          console.log("✅ LLM service response received");
          console.log(
            "Response format:",
            typeof response,
            response ? Object.keys(response) : "null"
          );
          console.log("[RAG-LLM] Raw LLM response object (first pass, before JSON extract):", response);

          // Extract content from response
          // sendMessage returns { content, model, usage, metadata }
          let responseContent;
          if (response && typeof response === "object") {
            responseContent =
              response.content || response.text || response.message || JSON.stringify(response);
          } else {
            responseContent = response;
          }

          const contentStr =
            typeof responseContent === "string"
              ? responseContent
              : String(responseContent ?? "");
          console.log(
            "[RAG-LLM] Extracted text length:",
            contentStr.length,
            "| starts with:",
            JSON.stringify(contentStr.slice(0, 120))
          );
          console.log("[RAG-LLM] Extracted text (full, for JSON debug):\n", contentStr);

          if (!responseContent) {
            throw new Error("Empty response from LLM");
          }

          // Try to parse JSON response
          try {
            // Use safe JSON parser that handles LaTeX and other edge cases
            const parsed = safeJsonParse(responseContent);
            questionData = validateAndNormalizeQuestionData(parsed, questionType);

            // If we got here, parsing was successful
            console.log(`✅ Successfully parsed JSON on attempt ${attempt}`);
            break;

          } catch (parseError) {
            lastError = parseError;
            console.warn(`❌ JSON parsing failed on attempt ${attempt}:`, parseError.message);
            console.warn(
              "[RAG-LLM] Parse failed — content length:",
              contentStr.length,
              "| snippet (0-400):",
              JSON.stringify(contentStr.slice(0, 400))
            );
            if (attempt < maxRetries) {
              console.log(`Retrying... (${attempt + 1}/${maxRetries})`);
              continue;
            } else {
              throw parseError;
            }
          }

        } catch (error) {
          lastError = error;
          console.warn(`❌ LLM call failed on attempt ${attempt}:`, error.message);
          if (attempt < maxRetries) {
            console.log(`Retrying... (${attempt + 1}/${maxRetries})`);
            continue;
          } else {
            throw error;
          }
        }
      }

      // If we still don't have valid questionData after all retries, throw error
      if (!questionData) {
        throw new Error(`Failed to generate valid JSON after ${maxRetries} attempts. Last error: ${lastError?.message || 'Unknown error'}`);
      }

      if (questionData.questionType === "multiple-choice") {
        const correctOptionLetter = questionData.correctAnswer;
        const optText = questionData.options?.[correctOptionLetter];
        if (optText) {
          console.log(
            `✅ Correct answer at position ${correctOptionLetter}: "${String(optText).substring(0, 50)}..."`
          );
        } else {
          console.warn(
            `⚠️ Warning: No option text at position ${correctOptionLetter}, but continuing anyway`
          );
        }
      }

      res.json({
        success: true,
        question: questionData,
        method: "RAG + LLM Service",
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

    if (!isUserInCourse(userId, courseId)) {
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
    if (!isUserInCourse(req.user.id, courseId)) {
      return res.status(403).json({
        success: false,
        error: "User is not in course",
      });
    }

    // Get RAG instance for the course
    const ragInstance = await ragService.getOrCreateInstance(courseId);
    if (!ragInstance) {
      return res.status(500).json({
        success: false,
        error: "RAG instance is not initialized for this course",
      });
    }

    // Get LLM instance
    const llmModule = await llmService.getLLMInstance();
    if (!llmModule) {
      return res.status(500).json({
        success: false,
        error: "LLM service is not initialized",
      });
    }

    // Get RAG content from selected materials
    // Fetch settings for prompt
    const settings = await settingsService.getSettings(courseId);

    // Prepare RAG search query
    const searchQuery = `course content learning objectives topics concepts from course: ${courseName || ''}`;

    console.log("Retrieving RAG content from selected materials...");
    const ragContext = await ragService.getRagContentFromMaterials(
      materialIds,
      searchQuery,
      100,
      courseId
    );

    if (!ragContext || ragContext.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "No content found in selected materials. Please ensure materials have been processed.",
      });
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
        .replace('{ragContext}', ragContext.substring(0, 8000) + (ragContext.length > 8000 ? "\n\n[... content truncated ...]" : ""));
    } else {
      promptTemplate = settings?.prompts?.objectiveGenerationAuto || DEFAULT_PROMPTS.objectiveGenerationAuto;
      fullPrompt = promptTemplate
        .replace('{courseName}', courseName || "Course")
        .replace('{ragContext}', ragContext.substring(0, 8000) + (ragContext.length > 8000 ? "\n\n[... content truncated ...]" : ""));
    }

    console.log("Sending prompt to LLM service...");
    const response = await llmModule.sendMessage(fullPrompt);
    console.log("Full Prompt: ", fullPrompt);

    console.log("✅ LLM service response received");

    // Extract content from response
    let responseContent;
    if (response && typeof response === "object") {
      responseContent =
        response.content || response.text || response.message || JSON.stringify(response);
    } else {
      responseContent = response;
    }

    if (!responseContent) {
      throw new Error("Empty response from LLM");
    }

    console.log("Response content:", responseContent.substring(0, 500));

    // Try to parse JSON response
    try {
      // Use safe JSON parser that handles LaTeX and other edge cases
      const objectivesData = safeJsonParse(responseContent);

      // Validate the structure
      if (!objectivesData.objectives || !Array.isArray(objectivesData.objectives)) {
        throw new Error("Invalid response format: missing objectives array");
      }

      // Clean and validate objectives
      const validBloomLevels = BLOOM_LEVELS;
      const cleanedObjectives = objectivesData.objectives
        .filter((obj) => obj.name && obj.name.trim() && obj.granularObjectives && Array.isArray(obj.granularObjectives))
        .map((obj) => ({
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
        }))
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

module.exports = {
  addDocumentToRagHandler,
  searchRagHandler,
  generateQuestionsWithRagHandler,
  deleteDocumentHandler,
  generateLearningObjectivesHandler
};
