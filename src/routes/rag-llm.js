// Server-side LLM endpoint using UBC GenAI Toolkit
const express = require("express");
const router = express.Router();

// Import Qdrant patch to fix Float32Array issue
require("../utils/qdrant-patch");

// Import UBC GenAI Toolkit (server-side)
let LLMModule = null;
let RAGModule = null;
let ConsoleLogger = null;

// Global RAG instance (initialized once)
let globalRAGInstance = null;

// Initialize UBC toolkit
async function initializeUBCToolkit() {
  try {
    console.log("Initializing UBC GenAI Toolkit on server...");

    // Import modules
    const llmModule = await import("ubc-genai-toolkit-llm");
    const ragModule = await import("ubc-genai-toolkit-rag");
    const coreModule = await import("ubc-genai-toolkit-core");

    console.log("LLM Module keys:", Object.keys(llmModule));
    console.log("RAG Module keys:", Object.keys(ragModule));

    // Try different ways to access the modules
    LLMModule =
      llmModule.LLMModule || llmModule.default?.LLMModule || llmModule.default;
    RAGModule =
      ragModule.RAGModule || ragModule.default?.RAGModule || ragModule.default;
    ConsoleLogger =
      coreModule.ConsoleLogger ||
      coreModule.default?.ConsoleLogger ||
      coreModule.default;

    // If still not found, try direct access
    if (!LLMModule && llmModule.default) {
      LLMModule = llmModule.default;
    }
    if (!RAGModule && ragModule.default) {
      RAGModule = ragModule.default;
    }
    if (!ConsoleLogger && coreModule.default) {
      ConsoleLogger = coreModule.default;
    }

    console.log("LLMModule:", typeof LLMModule);
    console.log("RAGModule:", typeof RAGModule);

    // Test if the modules have the create method
    if (LLMModule) {
      console.log("LLMModule.create:", typeof LLMModule.create);
      console.log("LLMModule methods:", Object.getOwnPropertyNames(LLMModule));
      console.log(
        "LLMModule prototype:",
        Object.getOwnPropertyNames(LLMModule.prototype)
      );
    }
    if (RAGModule) {
      console.log("RAGModule.create:", typeof RAGModule.create);
      console.log("RAGModule methods:", Object.getOwnPropertyNames(RAGModule));

      // Initialize global RAG instance
      try {
        console.log("Initializing global RAG instance...");
        globalRAGInstance = await RAGModule.create({
          provider: "qdrant",
          qdrantConfig: {
            url: process.env.QDRANT_URL || "http://localhost:6333",
            collectionName:
              process.env.QDRANT_COLLECTION_NAME ||
              "question-generation-collection",
            vectorSize: parseInt(process.env.VECTOR_SIZE) || 384,
            distanceMetric: process.env.DISTANCE_METRIC || "Cosine",
          },
          embeddingsConfig: {
            providerType: "fastembed",
            fastembedConfig: {
              model: process.env.EMBEDDINGS_MODEL || "fast-bge-small-en-v1.5",
            },
          },
          chunkingConfig: {
            strategy: "simple",
            chunkSize: 1000, // Increased from default 300 to 1000 characters
            overlap: 100, // Increased from default 50 to 100 characters
          },
          debug: process.env.DEBUG === "true",
        });
        console.log("✅ Global RAG instance initialized successfully");
      } catch (ragError) {
        console.error("❌ Failed to initialize global RAG instance:", ragError);
      }
    }

    console.log("✅ UBC GenAI Toolkit initialized successfully");
    return true;
  } catch (error) {
    console.error("❌ Failed to initialize UBC GenAI Toolkit:", error);
    console.error("Error details:", error.message);
    console.error(
      "This is expected if UBC toolkit dependencies are not available"
    );
    LLMModule = null;
    RAGModule = null;
    return false;
  }
}

// Initialize on startup
let initializationPromise = initializeUBCToolkit();

// Wait for initialization to complete before handling requests
async function ensureRAGInitialized() {
  if (!globalRAGInstance) {
    console.log("RAG not initialized, waiting for initialization...");
    try {
      await initializationPromise;
      console.log("RAG initialization completed");
    } catch (error) {
      console.error("RAG initialization failed:", error);
    }
  }
  return globalRAGInstance;
}

// Add document to RAG
router.post("/add-document", express.json(), async (req, res) => {
  try {
    const { content, metadata } = req.body;

    if (!RAGModule) {
      return res.status(500).json({
        error: "RAG Module not initialized",
        fallback: "Use client-side RAG",
      });
    }

    console.log("=== ADDING DOCUMENT TO SERVER-SIDE RAG ===");
    console.log("Content length:", content.length);
    console.log("Metadata:", metadata);

    // Initialize RAG module
    const ragModule = await RAGModule.create(RAG_CONFIG);

    // Add content to RAG
    const chunkIds = await ragModule.addDocument(content, {
      ...metadata,
      timestamp: new Date().toISOString(),
    });

    console.log(`✅ Added ${chunkIds.length} chunks to RAG`);

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
});

// Search RAG knowledge base
router.post("/search", express.json(), async (req, res) => {
  try {
    const { query, limit = 5 } = req.body;

    console.log("=== RAG SEARCH REQUEST ===");
    console.log("Query:", query);
    console.log("Limit:", limit);

    // Ensure RAG is initialized
    const ragInstance = await ensureRAGInitialized();

    if (!ragInstance) {
      console.error("❌ Failed to initialize RAG instance");
      return res.status(500).json({
        error: "Failed to initialize RAG instance",
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
});

// RAG Configuration - Enabled with proper embeddings
const RAG_CONFIG = {
  provider: "qdrant",
  qdrantConfig: {
    url: "http://localhost:6333",
    collectionName: "question-generation-collection",
    vectorSize: 384,
    distanceMetric: "Cosine",
  },
  embeddingsConfig: {
    providerType: "fastembed",
    fastembedConfig: {
      model: "fast-bge-small-en-v1.5",
    },
  },
  debug: true,
};

// LLM Configuration
const LLM_CONFIG = {
  provider: "ollama",
  endpoint: (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, ""), // Remove trailing slash
  defaultModel: process.env.OLLAMA_MODEL || "llama3.2:latest",
  temperature: 0.7,
  maxTokens: 2000, // Increased for objective extraction
  debug: process.env.DEBUG === "true",
};

// Fallback function for direct Ollama API
async function generateWithDirectOllama(req, res) {
  try {
    const { objective, content, bloomLevel, course } = req.body;

    console.log("=== DIRECT OLLAMA FALLBACK GENERATION ===");
    console.log("Objective:", objective);
    console.log("Content length:", content.length);
    console.log("Bloom level:", bloomLevel);

    // Create prompt
    const prompt = `You are an expert educational content creator. Generate a high-quality multiple-choice question based on the provided content.

OBJECTIVE: ${objective}
BLOOM'S TAXONOMY LEVEL: ${bloomLevel}

INSTRUCTIONS:
1. Create a specific, detailed question that tests understanding of the objective
2. Use actual content from the materials - don't be generic
3. Include 4 answer options (A, B, C, D)
4. Make the correct answer clearly correct based on the content
5. Make incorrect answers plausible but clearly wrong
6. Focus on the specific concepts, examples, or details mentioned in the content
7. Format your response as JSON with this structure:
{
  "question": "Your specific question here",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "correctAnswer": 0,
  "explanation": "Why this answer is correct based on the content"
}

IMPORTANT: Base your question on the specific details, examples, formulas, or concepts mentioned in the provided content. Don't create generic questions - make them specific to what's actually in the materials.

CONTENT: ${content}`;

    // Call Ollama directly
    console.log("Sending prompt to Ollama...");
    const response = await fetch(`${LLM_CONFIG.endpoint}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: LLM_CONFIG.defaultModel,
        prompt: prompt,
        stream: false,
        options: {
          temperature: LLM_CONFIG.temperature,
          num_predict: LLM_CONFIG.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    console.log("✅ Ollama response received");

    // Try to parse JSON response
    try {
      let questionData;

      // First try to parse the response directly
      try {
        questionData = JSON.parse(data.response);
      } catch (directParseError) {
        // If direct parsing fails, try to extract JSON from the response
        const jsonMatch = data.response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          questionData = JSON.parse(jsonMatch[0]);
        } else {
          throw directParseError;
        }
      }

      res.json({
        success: true,
        question: questionData,
        ragChunks: 0,
        method: "Direct Ollama API (Fallback)",
      });
    } catch (parseError) {
      // If JSON parsing fails, return the raw response
      res.json({
        success: true,
        question: {
          question: data.response,
          options: ["Option A", "Option B", "Option C", "Option D"],
          correctAnswer: 0,
          explanation: "Generated using Direct Ollama API (Fallback)",
        },
        ragChunks: 0,
        method: "Direct Ollama API (Raw Response)",
      });
    }
  } catch (error) {
    console.error("Direct Ollama fallback failed:", error);
    res.status(500).json({
      error: "Question generation failed",
      details: error.message,
      fallback: "Use template system",
    });
  }
}

// Generate questions using RAG + LLM
router.post("/generate-with-rag", express.json(), async (req, res) => {
  try {
    const { objective, content, bloomLevel, course } = req.body;

    // If UBC toolkit is not available, fallback to direct Ollama
    if (!LLMModule) {
      console.log(
        "UBC toolkit not available, falling back to direct Ollama..."
      );
      return await generateWithDirectOllama(req, res);
    }

    console.log("=== SERVER-SIDE RAG + LLM GENERATION ===");
    console.log("Objective:", objective);
    console.log("Content length:", content.length);
    console.log("Bloom level:", bloomLevel);

    let ragContext = content; // Use full content as fallback
    let ragChunks = 0;

    // Try to use RAG for content retrieval
    try {
      console.log("=== USING GLOBAL RAG FOR CONTENT RETRIEVAL ===");

      if (!globalRAGInstance) {
        throw new Error("Global RAG instance not available");
      }

      // Search for relevant content based on the learning objective
      console.log("Searching for relevant content using objective:", objective);
      const ragResults = await globalRAGInstance.retrieveContext(objective, {
        limit: 3,
      });

      console.log("RAG results:", ragResults);

      if (ragResults && ragResults.length > 0) {
        console.log(`✅ Found ${ragResults.length} relevant chunks from RAG`);
        ragContext = ragResults.map((result) => result.content).join("\n\n");
        ragChunks = ragResults.length;
        console.log("RAG context length:", ragContext.length);
      } else {
        console.log(
          "⚠️ No relevant chunks found in RAG, using provided content"
        );
        ragContext = content;
        ragChunks = 0;
      }
    } catch (ragError) {
      console.error("❌ RAG retrieval failed:", ragError);
      console.error("Error message:", ragError.message);
      console.error("Error stack:", ragError.stack);
      console.log("💡 Falling back to provided content");
      ragContext = content;
      ragChunks = 0;
    }

    // Limit content length to prevent very long processing times
    const maxContentLength = 5000; // 5k characters for summary
    if (content.length > maxContentLength) {
      console.log(
        `Content too long (${content.length} chars), summarizing to ${maxContentLength} characters`
      );

      // Use LLM to summarize the entire content to 5000 characters
      console.log("Generating content summary...");
      try {
        const summaryResponse = await fetch(
          `${LLM_CONFIG.endpoint}/api/generate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: LLM_CONFIG.defaultModel,
              prompt: `Please summarize the following content in exactly ${maxContentLength} characters or less, preserving the most important information, key concepts, and main points:\n\n${content}`,
              stream: false,
            }),
          }
        );

        const summaryData = await summaryResponse.json();
        ragContext =
          summaryData.response || content.substring(0, maxContentLength);
        console.log(`✅ Content summarized to ${ragContext.length} characters`);
      } catch (error) {
        console.log(
          "❌ Summary failed, using first 5000 characters as fallback"
        );
        ragContext =
          content.substring(0, maxContentLength) +
          "\n\n[Content summary - first 5000 characters]";
      }
    } else if (ragChunks === 0) {
      // Only use content if RAG didn't provide context
      ragContext = content;
    }

    // Use UBC toolkit LLM for generation
    console.log("=== USING UBC TOOLKIT LLM FOR GENERATION ===");

    try {
      // Initialize LLM module
      const llmModule = new LLMModule(LLM_CONFIG);

      // Create prompt with RAG context
      const prompt = `You are an expert educational content creator. Generate a high-quality multiple-choice question based on the provided content.

OBJECTIVE: ${objective}
BLOOM'S TAXONOMY LEVEL: ${bloomLevel}

INSTRUCTIONS:
1. Create a specific, detailed question that tests understanding of the objective
2. Use actual content from the materials - don't be generic
3. Include 4 answer options (A, B, C, D)
4. Make the correct answer clearly correct based on the content
5. Make incorrect answers plausible but clearly wrong
6. Focus on the specific concepts, examples, or details mentioned in the content
7. Format your response as JSON with this structure:
{
  "question": "Your specific question here",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "correctAnswer": 0,
  "explanation": "Why this answer is correct based on the content"
}

IMPORTANT: Base your question on the specific details, examples, formulas, or concepts mentioned in the provided content. Don't create generic questions - make them specific to what's actually in the materials.

CONTENT: ${ragContext}`;

      console.log("Sending prompt to UBC toolkit LLM...");
      const response = await llmModule.sendMessage(prompt);

      console.log("✅ UBC toolkit LLM response received");
      console.log("Response format:", typeof response, Object.keys(response));

      // Extract content from response
      const responseContent = response.content || response;
      console.log("Response content:", responseContent);

      // Try to parse JSON response
      try {
        let questionData;

        // First try to parse the response content directly
        try {
          questionData = JSON.parse(responseContent);
        } catch (directParseError) {
          // If direct parsing fails, try to extract JSON from the response
          const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            questionData = JSON.parse(jsonMatch[0]);
          } else {
            throw directParseError;
          }
        }

        res.json({
          success: true,
          question: questionData,
          ragChunks: ragChunks,
          method: "RAG + UBC Toolkit + Ollama",
        });
      } catch (parseError) {
        // If JSON parsing fails, return the raw response
        res.json({
          success: true,
          question: {
            question: response,
            options: ["Option A", "Option B", "Option C", "Option D"],
            correctAnswer: 0,
            explanation: "Generated using RAG + UBC Toolkit + Ollama",
          },
          ragChunks: ragChunks,
          method: "RAG + UBC Toolkit + Ollama (Raw Response)",
        });
      }
    } catch (llmError) {
      console.error("❌ UBC toolkit LLM failed:", llmError.message);
      console.log("💡 Falling back to direct Ollama API");
      return await generateWithDirectOllama(req, res);
    }
  } catch (error) {
    console.error("RAG + LLM generation failed:", error);
    res.status(500).json({
      error: "Question generation failed",
      details: error.message,
      fallback: "Use direct Ollama API",
    });
  }
});

// Extract learning objectives from content using LLM
router.post("/extract-objectives", express.json(), async (req, res) => {
  try {
    // Wait for toolkit initialization to complete
    await initializationPromise;
    
    const { content, course } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        error: "Content is required for objective extraction",
      });
    }

    console.log("=== EXTRACTING LEARNING OBJECTIVES FROM CONTENT ===");
    console.log("Content length:", content.length);
    console.log("Course:", course || "Not specified");
    console.log("LLMModule available:", !!LLMModule);

    // First, try to find explicit learning objectives in the content
    const explicitObjectives = findExplicitLearningObjectives(content);
    
    if (explicitObjectives.length > 0) {
      console.log(`Found ${explicitObjectives.length} explicit learning objectives`);
      return res.json({
        success: true,
        objectives: explicitObjectives,
        method: "Pattern Matching",
      });
    }

    // If no explicit objectives found, use LLM to extract them
    console.log("No explicit objectives found, using LLM extraction...");

    // Truncate content if too long (LLM has token limits)
    const maxContentLength = 8000; // Keep reasonable size for LLM
    const contentToAnalyze = content.length > maxContentLength 
      ? content.substring(0, maxContentLength) + "\n\n[... content truncated ...]"
      : content;

    // Create prompt for LLM
    const prompt = `You are an expert educational content analyst. Analyze the following course material and extract the main learning objectives.

COURSE MATERIAL:
${contentToAnalyze}

INSTRUCTIONS:
1. Identify the main learning objectives or goals from this material
2. Extract 3-5 key learning objectives that students should achieve
3. For each objective, identify:
   - The main topic or concept
   - What students should be able to do (action verbs like understand, apply, analyze, etc.)
   - The Bloom's taxonomy level (Remember, Understand, Apply, Analyze, Evaluate, or Create)
4. Format your response as JSON with this structure:
{
  "objectives": [
    {
      "title": "Main topic or concept",
      "description": "What students should learn about this topic",
      "granularObjectives": [
        {
          "text": "Specific learning objective statement",
          "bloom": ["Understand", "Apply"],
          "minQuestions": 2,
          "count": 2
        }
      ]
    }
  ]
}

IMPORTANT: 
- Extract REAL learning objectives from the content, not generic placeholders
- Base objectives on actual topics, concepts, and skills mentioned in the material
- Use specific terminology from the content
- Create 2-3 granular objectives per main topic
- Return ONLY valid JSON, no additional text`;

    let llmResponse;

    // Try UBC toolkit LLM first
    if (LLMModule) {
      try {
        console.log("Using UBC toolkit LLM for extraction...");
        console.log("LLMModule type:", typeof LLMModule);
        console.log("LLM_CONFIG:", JSON.stringify(LLM_CONFIG, null, 2));
        
        // Try different ways to instantiate LLMModule
        let llmModule;
        if (typeof LLMModule.create === 'function') {
          console.log("Using LLMModule.create()");
          llmModule = await LLMModule.create(LLM_CONFIG);
        } else if (typeof LLMModule === 'function') {
          console.log("Using new LLMModule()");
          llmModule = new LLMModule(LLM_CONFIG);
        } else {
          throw new Error("LLMModule is not a constructor or doesn't have create method");
        }
        
        console.log("LLM module created, calling sendMessage...");
        const response = await llmModule.sendMessage(prompt);
        llmResponse = response.content || response;
        console.log("UBC toolkit LLM response received, length:", llmResponse?.length || 0);
      } catch (error) {
        console.error("UBC toolkit LLM failed:", error);
        console.error("Error stack:", error.stack);
        console.log("Falling back to direct Ollama...");
        try {
          llmResponse = await callDirectOllama(prompt);
        } catch (ollamaError) {
          console.error("Direct Ollama also failed:", ollamaError);
          console.error("Ollama error stack:", ollamaError.stack);
          // Fallback to pattern matching
          throw new Error(`LLM extraction failed: ${ollamaError.message}`);
        }
      }
    } else {
      console.log("UBC toolkit not available, using direct Ollama...");
      try {
        llmResponse = await callDirectOllama(prompt);
      } catch (ollamaError) {
        console.error("Direct Ollama failed:", ollamaError);
        console.error("Ollama error stack:", ollamaError.stack);
        // Fallback to pattern matching
        throw new Error(`LLM extraction failed: ${ollamaError.message}`);
      }
    }

    console.log("LLM response received, length:", llmResponse.length);

    // Parse JSON from response
    let objectivesData;
    try {
      // Try to extract JSON from response
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        objectivesData = JSON.parse(jsonMatch[0]);
      } else {
        objectivesData = JSON.parse(llmResponse);
      }
    } catch (parseError) {
      console.error("Failed to parse LLM response as JSON:", parseError);
      console.error("Response preview:", llmResponse.substring(0, 500));
      console.error("Full response length:", llmResponse.length);
      // Fallback to pattern-based extraction
      const fallbackObjectives = extractObjectivesFromContentPatterns(content);
      if (fallbackObjectives.length > 0) {
        return res.json({
          success: true,
          objectives: fallbackObjectives,
          method: "Pattern Matching (LLM Parse Failed)",
        });
      } else {
        // If pattern matching also fails, return error
        throw new Error("Failed to extract objectives: LLM response could not be parsed and pattern matching found no objectives");
      }
    }

    // Validate and format the response
    if (objectivesData.objectives && Array.isArray(objectivesData.objectives)) {
      // Ensure all required fields are present
      const formattedObjectives = objectivesData.objectives.map((obj, index) => ({
        title: obj.title || `Learning Objective ${index + 1}`,
        description: obj.description || `Master concepts related to ${obj.title}`,
        granularObjectives: (obj.granularObjectives || []).map((granular, gIndex) => ({
          text: granular.text || `Objective ${gIndex + 1}`,
          bloom: Array.isArray(granular.bloom) ? granular.bloom : [granular.bloom || "Understand"],
          minQuestions: granular.minQuestions || 2,
          count: granular.count || 2,
        })),
      }));

      console.log(`✅ Extracted ${formattedObjectives.length} learning objectives using LLM`);

      return res.json({
        success: true,
        objectives: formattedObjectives,
        method: "LLM Extraction",
      });
    } else {
      throw new Error("Invalid LLM response format");
    }
  } catch (error) {
    console.error("Error extracting learning objectives:", error);
    console.error("Error stack:", error.stack);
    
    // Try pattern matching as final fallback
    try {
      console.log("Attempting pattern matching fallback...");
      const fallbackObjectives = extractObjectivesFromContentPatterns(content);
      if (fallbackObjectives.length > 0) {
        console.log("Pattern matching fallback succeeded with", fallbackObjectives.length, "objectives");
        return res.json({
          success: true,
          objectives: fallbackObjectives,
          method: "Pattern Matching (Error Fallback)",
        });
      }
    } catch (fallbackError) {
      console.error("Pattern matching fallback also failed:", fallbackError);
    }
    
    res.status(500).json({
      error: "Failed to extract learning objectives",
      details: error.message,
      suggestion: "Please ensure Ollama is running and accessible, or try adding objectives manually",
    });
  }
});

// Helper function to call Ollama directly
async function callDirectOllama(prompt) {
  try {
    console.log("Calling Ollama at:", LLM_CONFIG.endpoint);
    console.log("Using model:", LLM_CONFIG.defaultModel);
    
    const response = await fetch(`${LLM_CONFIG.endpoint}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: LLM_CONFIG.defaultModel,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 2000, // More tokens for objective extraction
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      console.error("Ollama API error:", response.status, errorText);
      throw new Error(`Ollama API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.response) {
      console.error("Ollama response missing 'response' field:", data);
      throw new Error("Invalid response from Ollama: missing 'response' field");
    }
    
    return data.response;
  } catch (error) {
    console.error("Error calling Ollama:", error);
    if (error.message.includes("fetch failed") || error.message.includes("ECONNREFUSED")) {
      throw new Error("Cannot connect to Ollama. Please ensure Ollama is running at " + LLM_CONFIG.endpoint);
    }
    throw error;
  }
}

// Find explicit learning objectives in content (pattern matching)
function findExplicitLearningObjectives(content) {
  const objectives = [];
  const lines = content.split("\n");

  // Patterns to look for
  const objectivePatterns = [
    /learning\s+objective[s]?:?\s*(.+)/i,
    /objective[s]?:?\s*(.+)/i,
    /students?\s+will\s+be\s+able\s+to\s+(.+)/i,
    /students?\s+should\s+(.+)/i,
    /upon\s+completion[,\s]+students?\s+will\s+(.+)/i,
    /^\d+[\.\)]\s*(students?\s+will\s+be\s+able\s+to\s+.+)/i,
    /^\d+[\.\)]\s*(students?\s+should\s+.+)/i,
  ];

  const foundObjectives = new Set();

  lines.forEach((line, index) => {
    // Check if this line contains "learning objective" header
    if (line.toLowerCase().includes("learning objective")) {
      // Look for objectives in the next few lines
      for (let i = index + 1; i < Math.min(index + 20, lines.length); i++) {
        const nextLine = lines[i].trim();
        if (nextLine.length > 10 && nextLine.length < 200) {
          // Check if it looks like an objective
          if (
            nextLine.match(/^\d+[\.\)]/) ||
            nextLine.match(/^[•\-\*]/) ||
            nextLine.toLowerCase().includes("understand") ||
            nextLine.toLowerCase().includes("apply") ||
            nextLine.toLowerCase().includes("analyze") ||
            nextLine.toLowerCase().includes("explain")
          ) {
            const cleanObjective = nextLine
              .replace(/^\d+[\.\)]\s*/, "")
              .replace(/^[•\-\*]\s*/, "")
              .trim();
            if (cleanObjective.length > 10 && !foundObjectives.has(cleanObjective)) {
              foundObjectives.add(cleanObjective);
              objectives.push({
                text: cleanObjective,
                bloom: inferBloomLevel(cleanObjective),
              });
            }
          }
        }
      }
    }

    // Check each line for objective patterns
    objectivePatterns.forEach((pattern) => {
      const match = line.match(pattern);
      if (match && match[1]) {
        const objectiveText = match[1].trim();
        if (objectiveText.length > 10 && objectiveText.length < 200) {
          if (!foundObjectives.has(objectiveText)) {
            foundObjectives.add(objectiveText);
            objectives.push({
              text: objectiveText,
              bloom: inferBloomLevel(objectiveText),
            });
          }
        }
      }
    });
  });

  // Group objectives by topic if we found multiple
  if (objectives.length > 0) {
    // Try to identify topics from context
    const topics = extractTopicsFromContent(content);
    if (topics.length > 0) {
      return topics.slice(0, 3).map((topic, index) => ({
        title: topic.title,
        description: topic.description || `Master ${topic.title}`,
        granularObjectives: objectives
          .slice(index * 2, (index + 1) * 2)
          .map((obj) => ({
            text: obj.text,
            bloom: obj.bloom,
            minQuestions: 2,
            count: 2,
          })),
      }));
    } else {
      // Group objectives into topics
      return [
        {
          title: "Course Learning Objectives",
          description: "Key learning objectives from the course materials",
          granularObjectives: objectives.slice(0, 5).map((obj) => ({
            text: obj.text,
            bloom: obj.bloom,
            minQuestions: 2,
            count: 2,
          })),
        },
      ];
    }
  }

  return [];
}

// Infer Bloom's taxonomy level from objective text
function inferBloomLevel(objectiveText) {
  const text = objectiveText.toLowerCase();
  if (text.match(/\b(remember|recall|identify|list|name|define|recognize)\b/)) {
    return ["Remember"];
  } else if (text.match(/\b(understand|explain|describe|summarize|interpret|classify)\b/)) {
    return ["Understand"];
  } else if (text.match(/\b(apply|use|implement|execute|solve|demonstrate)\b/)) {
    return ["Apply"];
  } else if (text.match(/\b(analyze|compare|contrast|examine|differentiate|organize)\b/)) {
    return ["Analyze"];
  } else if (text.match(/\b(evaluate|judge|critique|assess|justify|defend)\b/)) {
    return ["Evaluate"];
  } else if (text.match(/\b(create|design|construct|produce|invent|develop)\b/)) {
    return ["Create"];
  }
  return ["Understand", "Apply"]; // Default
}

// Extract topics from content (simplified version)
function extractTopicsFromContent(content) {
  const topics = [];
  const lines = content.split("\n").filter((line) => line.trim().length > 0);

  // Look for section headers
  const headers = lines.filter(
    (line) =>
      line.match(/^(Chapter|Section|Topic|Unit|Module|Lecture)\s+\d+/i) ||
      (line.length < 100 && line.match(/^[A-Z][A-Z\s]+$/)) ||
      line.match(/^\d+\.\s+[A-Z]/)
  );

  headers.slice(0, 5).forEach((header) => {
    const cleanHeader = header
      .replace(/^(Chapter|Section|Topic|Unit|Module|Lecture)\s+\d+[:\-\s]*/i, "")
      .replace(/^\d+\.\s*/, "")
      .trim();
    if (cleanHeader.length > 5 && cleanHeader.length < 100) {
      topics.push({
        title: cleanHeader,
        description: `Master concepts related to ${cleanHeader}`,
      });
    }
  });

  return topics;
}

// Fallback pattern-based extraction
function extractObjectivesFromContentPatterns(content) {
  const explicit = findExplicitLearningObjectives(content);
  if (explicit.length > 0) {
    return explicit;
  }

  // Extract key topics as fallback
  const topics = extractTopicsFromContent(content);
  if (topics.length > 0) {
    return topics.map((topic) => ({
      title: topic.title,
      description: topic.description,
      granularObjectives: [
        {
          text: `Understand key concepts in ${topic.title}`,
          bloom: ["Understand"],
          minQuestions: 2,
          count: 2,
        },
        {
          text: `Apply ${topic.title} concepts to solve problems`,
          bloom: ["Apply"],
          minQuestions: 2,
          count: 2,
        },
      ],
    }));
  }

  return [];
}

module.exports = router;
