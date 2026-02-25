// Server-side LLM endpoint using UBC GenAI Toolkit
// Routes only - all RAG initialization and operations are handled by the RAG service

// Import RAG service (singleton)
const ragService = require('../services/rag');

// Import LLM service (singleton)
const llmService = require('../services/llm');

// Import services
const { getMaterialCourseId } = require('../services/material');
const { isUserInCourse } = require('../services/user-course');

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
    const { content, metadata } = req.body;

    const chunkIds = await ragService.addDocumentToRAG(content, metadata);

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
    const { query, limit = 5 } = req.body;

    console.log("=== RAG SEARCH REQUEST ===");
    console.log("Query:", query);
    console.log("Limit:", limit);

    // Get RAG instance
    const ragInstance = ragService.getRAGInstance();

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
    const { courseName, learningObjectiveId, learningObjectiveText, granularLearningObjectiveText, bloomLevel } = req.body;

    console.log("=== RAG + LLM GENERATION REQUEST ===");
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
    const ragContext = await ragService.getLearningObjectiveRagContent(
      learningObjectiveId,
      `Get relevant content about learning objective: ${learningObjectiveText}, Granular Learning Objective: ${granularLearningObjectiveText} for course: ${courseName}`
    );

    console.log("RAG Context:", ragContext);

    // Use LLM service for generation
    console.log("=== USING LLM SERVICE FOR GENERATION ===");

    try {
      // Get LLM instance from service
      const llmModule = await llmService.getLLMInstance();

      // Randomly determine which position will contain the correct answer (server-side)
      const correctPosition = Math.floor(Math.random() * 4); // 0, 1, 2, or 3
      const correctAnswerLetter = ['A', 'B', 'C', 'D'][correctPosition];
      
      console.log(`🎲 Randomly selected position: ${correctAnswerLetter} (index ${correctPosition})`);

      // Create prompt with RAG context
      const createPrompt = () => `You are an university instructor. Generate a high-quality multiple-choice question based on the provided content that effectively test students' understanding of the course learning objective.

Learning Objective: ${learningObjectiveText}
Granular Learning Objective: ${granularLearningObjectiveText}
Bloom's Taxonomy Level(s): ${bloomLevel}

Task: Create a multiple-choice question based on the provided content that effectively test students' understanding of the course learning objective.

PROCEDURE:
1. Create the question content
2. Generate 4 plausible answer options, placing the CORRECT answer text in position ${correctAnswerLetter}
3. Set correctAnswer to "${correctAnswerLetter}" (this is mandatory - do not use any other letter)
4. Write the explanation

The response format must be a valid JSON with the exact structure as follows:
{
  "question": "Your specific question here",
  "options": {
    "A": "First option text", // The first option
    "B": "Second option text", // The second option
    "C": "Third option text", // The third option
    "D": "Fourth option text", // The fourth option
  },
  "correctAnswer": "${correctAnswerLetter}", // The letter of the correct answer
  "explanation": "Why this answer is correct based on the content" // The explanation of why the correct answer is correct
}

CRITICAL FORMATTING REQUIREMENTS:
- Return ONLY valid JSON. Do NOT wrap the JSON in markdown code blocks (do not use triple backticks with json or triple backticks alone).
- Do NOT include any text before or after the JSON object.
- The response must start with { and end with }.
- Return pure JSON that can be directly parsed with JSON.parse().
- CRITICAL JSON ESCAPING: If your response includes LaTeX mathematical notation, you MUST properly escape all backslashes in the JSON string. In JSON, backslashes must be escaped as \\\\ (double backslash). For example:
  * LaTeX \\( should be written as \\\\( in JSON
  * LaTeX \\[ should be written as \\\\[ in JSON
  * LaTeX \\text should be written as \\\\text in JSON
  * LaTeX \\mathbb should be written as \\\\mathbb in JSON
  * Any other LaTeX command with a backslash must be escaped: \\command becomes \\\\command
  * Regular quotes must be escaped as \\"
  * The JSON must be valid and parseable - test that all backslashes are properly escaped.

The distractors (incorrect answers) should be plausible but subtly flawed, to effectively test students' understanding.

IMPORTANT: 
- CRITICAL: Always wrap any mathematical expressions in LaTeX delimiters that the Katex library can parse. My Katex config is:
      renderMathInElement(document.body, {
        delimiters: [
          { left: "\\\(", right: "\\\)", display: false },
          { left: "\\\\[", right: "\\\\]", display: true }
        ],
        throwOnError: false // prevents crashing on bad LaTeX
      });
  When including LaTeX in your JSON response, remember to escape backslashes: use \\\\( and \\\\) for inline math, and \\\\[ and \\\\] for display math.
- CRITICAL: Do NOT include letter prefixes (A), B), C), D) or A., B., C., D. or A , B , C , D ) in the option text. The options array should contain only the option text itself, without any letter labels, prefixes, or formatting. For example, use "The correct answer" NOT "A) The correct answer" or "A. The correct answer".

CONTENT: ${ragContext}`;

      // Retry logic: regenerate until we get valid JSON
      const maxRetries = 5;
      let questionData = null;
      let lastError = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`Sending prompt to LLM service (attempt ${attempt}/${maxRetries})...`);
          const response = await llmModule.sendMessage(createPrompt());

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

      // Override correctAnswer with the server-selected position to ensure proper distribution
      // We told the LLM which position to use, but we enforce it here to be safe
      if (questionData.correctAnswer !== correctAnswerLetter) {
        console.log(`⚠️ LLM returned correctAnswer="${questionData.correctAnswer}", but we're overriding it to "${correctAnswerLetter}" (server-selected position)`);
      }
      questionData.correctAnswer = correctAnswerLetter;
      
      // Verify that the correct answer text exists in the selected position
      if (questionData.options && questionData.options[correctAnswerLetter]) {
        console.log(`✅ Correct answer is in position ${correctAnswerLetter}: "${questionData.options[correctAnswerLetter].substring(0, 50)}..."`);
      } else {
        console.warn(`⚠️ Warning: No option found at position ${correctAnswerLetter}, but continuing anyway`);
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

    await ragService.deleteDocumentFromRAG(sourceId);

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
    const { courseId, materialIds, courseName, objectivesCount = 5 } = req.body;

    console.log("=== GENERATE LEARNING OBJECTIVES REQUEST ===");
    console.log("Course ID:", courseId);
    console.log("Material IDs:", materialIds);
    console.log("Course Name:", courseName);

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

    // Get RAG instance
    const ragInstance = ragService.getRAGInstance();
    if (!ragInstance) {
      return res.status(500).json({
        success: false,
        error: "RAG instance is not initialized",
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
    console.log("Retrieving RAG content from selected materials...");
    const ragContext = await ragService.getRagContentFromMaterials(
      materialIds,
      `course content learning objectives topics concepts from course: ${courseName}`,
      100
    );

    if (!ragContext || ragContext.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "No content found in selected materials. Please ensure materials have been processed.",
      });
    }

    // Create prompt for generating learning objectives
    const prompt = `You are an expert educational content designer. Based on the following course materials, generate learning objectives that are clear, measurable, and aligned with educational best practices.

COURSE: ${courseName || "Course"}

COURSE MATERIALS CONTENT:
${ragContext.substring(0, 8000)}${ragContext.length > 8000 ? "\n\n[... content truncated ...]" : ""}

INSTRUCTIONS:
1. Analyze the course materials and identify key topics, concepts, and learning outcomes
2. Generate exactly ${objectivesCount} main learning objectives that cover the major themes in the materials
3. For each main learning objective, generate 2-4 granular (sub) objectives that break it down into specific, measurable learning outcomes
4. Use clear, action-oriented language (e.g., "Students will be able to...")
5. Ensure objectives are specific to the content provided, not generic
6. Format your response as JSON with this structure:
{
  "objectives": [
    {
      "name": "Main learning objective title",
      "granularObjectives": [
        "Granular objective 1",
        "Granular objective 2",
        "Granular objective 3"
      ]
    },
    {
      "name": "Another main learning objective",
      "granularObjectives": [
        "Granular objective 1",
        "Granular objective 2"
      ]
    }
  ]
}

IMPORTANT:
- Base objectives on the actual content in the materials
- Make objectives specific and measurable
- Ensure granular objectives support their parent objective
- Return ONLY valid JSON, no additional text or markdown formatting`;

    console.log("Sending prompt to LLM service...");
    const response = await llmModule.sendMessage(prompt);

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
      const cleanedObjectives = objectivesData.objectives
        .filter((obj) => obj.name && obj.name.trim() && obj.granularObjectives && Array.isArray(obj.granularObjectives))
        .map((obj) => ({
          name: obj.name.trim(),
          granularObjectives: obj.granularObjectives
            .filter((go) => go && typeof go === "string" && go.trim())
            .map((go) => go.trim()),
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
