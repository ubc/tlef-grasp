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
      
      // Try to extract JSON object from the string
      const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      throw error;
    } catch (fallbackError) {
      // If parsing fails, the LLM response was invalid JSON
      // This should not happen if the LLM follows the prompt instructions
      throw new Error(`Invalid JSON response from LLM. The response must be valid JSON with properly escaped LaTeX backslashes (use \\\\ for each \\ in LaTeX). Original error: ${error.message}`);
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
    const { courseId, courseName, learningObjectiveId, learningObjectiveText, granularLearningObjectiveText, bloomLevel } = req.body;

    console.log("=== RAG + LLM GENERATION REQUEST ===");
    console.log("Course ID:", courseId);
    console.log("Course Name:", courseName);
    console.log("Learning Objective ID:", learningObjectiveId);
    console.log("Learning Objective Text:", learningObjectiveText);
    console.log("Granular Learning Objective Text:", granularLearningObjectiveText);
    console.log("Bloom Level:", bloomLevel);

    // Validate required parameters
    if (!courseName || !learningObjectiveId || !learningObjectiveText || !granularLearningObjectiveText || !bloomLevel) {
      return res.status(400).json({
        error: "Missing required parameters",
        details: "courseName, learningObjectiveId, learningObjectiveText, granularLearningObjectiveText, and bloomLevel are required",
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

      // Create prompt with RAG context
      const createPrompt = () => promptTemplate
        .replace('{learningObjectiveText}', learningObjectiveText || '')
        .replace('{granularLearningObjectiveText}', granularLearningObjectiveText || '')
        .replace('{bloomLevel}', bloomLevel || '')
        .replace('{ragContext}', ragContext || '');

      // Retry logic: regenerate until we get valid JSON
      const maxRetries = 5;
      let questionData = null;
      let lastError = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`Sending prompt to LLM service (attempt ${attempt}/${maxRetries})...`);
          const response = await llmModule.sendMessage(createPrompt());
          console.log("Full Prompt: ", createPrompt());

          console.log("✅ LLM service response received");
          console.log(
            "Response format:",
            typeof response,
            response ? Object.keys(response) : "null"
          );

          // Extract content from response
          // sendMessage returns { content, model, usage, metadata }
          let responseContent;
          if (response && typeof response === "object") {
            responseContent =
              response.content || response.text || response.message || JSON.stringify(response);
          } else {
            responseContent = response;
          }

          console.log("Response content:", responseContent);

          if (!responseContent) {
            throw new Error("Empty response from LLM");
          }

          // Try to parse JSON response
          try {
            // Use safe JSON parser that handles LaTeX and other edge cases
            questionData = safeJsonParse(responseContent);

            // Validate that we have the required fields
            if (!questionData.question || !questionData.options || !questionData.correctAnswer) {
              throw new Error("Missing required fields in JSON response");
            }

            // If we got here, parsing was successful
            console.log(`✅ Successfully parsed JSON on attempt ${attempt}`);
            break;

          } catch (parseError) {
            lastError = parseError;
            console.warn(`❌ JSON parsing failed on attempt ${attempt}:`, parseError.message);
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

      // Verify that the correct answer text exists organically in the selected position
      const correctOptionLetter = questionData.correctAnswer;
      const correctOption = questionData.options ? questionData.options[correctOptionLetter] : null;
      if (correctOption) {
        const textToLog = typeof correctOption === 'string' ? correctOption : (correctOption.text || "");
        console.log(`✅ Correct answer organically located at position ${correctOptionLetter}: "${textToLog.substring(0, 50)}..."`);
      } else {
        console.warn(`⚠️ Warning: No option found at the LLM's selected position ${correctOptionLetter}, but continuing anyway`);
      }

      // Programmatically scramble the generated options to guarantee uniform true randomness 
      // and defeat the LLM's inherent statistical bias toward picking B or C before sending it 
      // back to the UI for preview.
      if (questionData.options && questionData.correctAnswer && questionData.options[questionData.correctAnswer]) {
        const optionKeys = ['A', 'B', 'C', 'D'].filter(k => questionData.options[k] !== undefined);
        const optionValues = optionKeys.map(k => questionData.options[k]);
        
        for (let i = optionValues.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [optionValues[i], optionValues[j]] = [optionValues[j], optionValues[i]];
        }
        
        const originalCorrectValue = questionData.options[questionData.correctAnswer];
        let newCorrectKey = questionData.correctAnswer;
        
        for (let i = 0; i < optionKeys.length; i++) {
          const key = optionKeys[i];
          questionData.options[key] = optionValues[i];
          if (optionValues[i] === originalCorrectValue) {
            newCorrectKey = key;
          }
        }
        
        questionData.correctAnswer = newCorrectKey;
        console.log(`🔀 Programmatically shuffled correct answer from ${correctOptionLetter} to ${newCorrectKey} to perfectly bypass LLM model bias`);
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
