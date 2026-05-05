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
      // Try extracting from markdown code blocks
      const codeBlockMatch = str.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        try {
          return JSON.parse(codeBlockMatch[1]);
        } catch (e) {
          // If code block also fails, continue to other fixes
        }
      }
      
      // Try to extract just the first object { ... }
      const jsonMatch = str.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e) {
          // If extraction fails, continue
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
    const { courseId, courseName, learningObjectiveId, learningObjectiveText, granularLearningObjectiveText, bloomLevels, materialIds } = req.body;

    console.log("=== RAG + LLM GENERATION REQUEST ===");
    console.log("Course ID:", courseId);
    console.log("Course Name:", courseName);
    console.log("Learning Objective ID:", learningObjectiveId);
    console.log("Learning Objective Text:", learningObjectiveText);
    console.log("Granular Learning Objective Text:", granularLearningObjectiveText);
    console.log("Bloom Levels:", bloomLevels);

    // Validate required parameters
    if (!courseName || !learningObjectiveText || !granularLearningObjectiveText || !bloomLevels || !Array.isArray(bloomLevels)) {
      return res.status(400).json({
        error: "Missing required parameters",
        details: "courseName, learningObjectiveText, granularLearningObjectiveText, and bloomLevels array are required",
      });
    }

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

    // Try to use RAG for content retrieval
    console.log("=== USING getLearningObjectiveRagContent ===");
    // Use objective text as the query for RAG search
      // Fetch settings for prompt
      const settings = await settingsService.getSettings(courseId);
      const promptTemplate = settings?.prompts?.questionGeneration || DEFAULT_PROMPTS.questionGeneration;

      // Prepare RAG search query
      const searchQuery = `Get relevant content about learning objective: ${learningObjectiveText || ''}, Granular Learning Objective: ${granularLearningObjectiveText || ''} for course: ${courseName || ''}`;

      let ragContext = '';
      if (learningObjectiveId) {
        ragContext = await ragService.getLearningObjectiveRagContent(
          learningObjectiveId,
          searchQuery,
          courseId
        );
      } else if (materialIds && materialIds.length > 0) {
        // Fallback to materials if objective is not yet in database
        ragContext = await ragService.getRagContentFromMaterials(
          materialIds,
          searchQuery,
          50, // limit
          courseId
        );
      }

      //console.log("RAG Context:", ragContext);

      // Use LLM service for generation
      console.log("=== USING LLM SERVICE FOR GENERATION ===");

      try {
        // Get LLM instance from service
        const llmModule = await llmService.getLLMInstance();

      // Create prompt with RAG context
      const createFirstPrompt = (bloomLevel) => {
        let p = promptTemplate
          .replace('{learningObjectiveText}', learningObjectiveText || '')
          .replace('{granularLearningObjectiveText}', granularLearningObjectiveText || '')
          .replace('{bloomLevel}', bloomLevel || '')
          .replace('{ragContext}', ragContext || '');

        // Fallback cleanup in case the database prompt still has the obsolete placeholder
        if (p.includes('{existingQuestionsContext}')) {
          p = p.replace('{existingQuestionsContext}', '');
        }
        
        return p;
      };

      const questionsData = [];
      const successfulHistory = []; // store {role, content} to rebuild conversation on retry
      const maxRetries = 3;

      for (let i = 0; i < bloomLevels.length; i++) {
        const currentBloomLevel = bloomLevels[i];
        let questionData = null;
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            // Build conversation from successful history
            const conversation = llmModule.createConversation();
            for (const msg of successfulHistory) {
              conversation.addMessage(msg.role, msg.content);
            }

            // Add the new prompt for this turn
            let turnPrompt;
            if (i === 0) {
               turnPrompt = createFirstPrompt(currentBloomLevel);
            } else {
               turnPrompt = `Now generate another question for this granular learning objective, but specifically targeting Bloom's Taxonomy Level: ${currentBloomLevel}. 
Ensure the question tests a completely different concept or facet of the objective than the previously generated questions. 
Respond with ONLY a single valid JSON object following the exact same structure. Do not include any other text or markdown blocks.`;
            }
            
            conversation.addMessage('user', turnPrompt);

            console.log(`Sending prompt to LLM service (Question ${i+1}/${bloomLevels.length}, attempt ${attempt}/${maxRetries})...`);
            
            // Send the request
            const response = await conversation.send();
            
            // Log Token Usage
            if (response.usage) {
              console.log(`📊 Token Usage for Question ${i+1}:`);
              console.log(`   - Prompt tokens: ${response.usage.promptTokens || 0}`);
              console.log(`   - Completion tokens: ${response.usage.completionTokens || 0}`);
              console.log(`   - Total tokens: ${response.usage.totalTokens || 0}`);
              
              // Note: ubc-genai-toolkit-llm normalizes usage to camelCase and drops provider-specific 
              // fields like 'cached_tokens'. The prompt caching is still happening on OpenAI's servers, 
              // but we can't log the exact "Saved" number here without modifying the toolkit itself.
            }
            
            let responseContent = response.content || response.text || response.message || JSON.stringify(response);
            
            if (!responseContent) throw new Error("Empty response from LLM");

            questionData = safeJsonParse(responseContent);

            if (!questionData.question || !questionData.options || !questionData.correctAnswer) {
              throw new Error("Missing required fields in JSON response");
            }

            console.log(`✅ Successfully generated question ${i+1}`);
            
            // Save to successful history
            successfulHistory.push({ role: 'user', content: turnPrompt });
            successfulHistory.push({ role: 'assistant', content: responseContent });
            
            break; // Success, break retry loop

          } catch (error) {
             lastError = error;
             console.warn(`❌ LLM call failed on attempt ${attempt}:`, error.message);
             if (attempt === maxRetries) {
                console.error(`Failed to generate question ${i+1} after all retries.`);
             } else {
                console.log(`Retrying... (${attempt + 1}/${maxRetries})`);
             }
          }
        }

        if (questionData) {
          // Programmatically scramble the generated options to guarantee uniform true randomness 
          // and defeat the LLM's inherent statistical bias toward picking B or C before sending it 
          // back to the UI for preview.
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

          questionsData.push(questionData);
        }
      }

      if (questionsData.length === 0) {
        throw new Error(`Failed to generate any valid questions after trying all ${bloomLevels.length} bloom levels.`);
      }

      res.json({
        success: true,
        questions: questionsData,
        method: "RAG + LLM Stateful Conversation",
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
    let searchQuery = `Identify the core knowledge areas, skills, competencies, theories, methodologies, 
and measurable learning outcomes that students are expected to master in ${courseName || ''}. 
Include foundational concepts, practical applications, and assessment criteria.`;
    if (userObjectives && userObjectives.length > 0) {
      searchQuery += `. Focused on: ${userObjectives.join(', ')}`;
    }

    console.log("Retrieving RAG content from selected materials...");
    const ragContext = await ragService.getRagContentFromMaterials(
      materialIds,
      searchQuery,
      200,
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
        .replace('{sourceIdsList}', materialIds.join(', '))
        .replace('{ragContext}', ragContext.substring(0, 100000) + (ragContext.length > 100000 ? "\n\n[... content truncated ...]" : ""));
    } else {
      promptTemplate = settings?.prompts?.objectiveGenerationAuto || DEFAULT_PROMPTS.objectiveGenerationAuto;
      fullPrompt = promptTemplate
        .replace('{courseName}', courseName || "Course")
        .replace('{sourceIdsList}', materialIds.join(', '))
        .replace('{ragContext}', ragContext.substring(0, 100000) + (ragContext.length > 100000 ? "\n\n[... content truncated ...]" : ""));
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
        .map((obj) => {
          console.log(`Objective "${obj.name}" sourceIds:`, obj.sourceIds);
          return {
            name: obj.name.trim(),
            sourceIds: Array.isArray(obj.sourceIds) ? obj.sourceIds : [],
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

module.exports = {
  addDocumentToRagHandler,
  searchRagHandler,
  generateQuestionsWithRagHandler,
  deleteDocumentHandler,
  generateLearningObjectivesHandler
};
