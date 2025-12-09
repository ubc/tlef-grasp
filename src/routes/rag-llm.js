// Server-side LLM endpoint using UBC GenAI Toolkit
const express = require("express");
const router = express.Router();

// Import Qdrant patch to fix Float32Array issue
require("../utils/qdrant-patch");

// Import UBC GenAI Toolkit (server-side)
let LLMModule = null;
let RAGModule = null;
let ConsoleLogger = null;
let EmbeddingsModule = null;

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
    const embeddingsModule = await import("ubc-genai-toolkit-embeddings");

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
    EmbeddingsModule =
      embeddingsModule.EmbeddingsModule ||
      embeddingsModule.default?.EmbeddingsModule ||
      embeddingsModule.default;

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
    if (!EmbeddingsModule && embeddingsModule.default) {
      EmbeddingsModule = embeddingsModule.default;
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

        // Create logger instance
        const logger = ConsoleLogger ? new ConsoleLogger() : null;

        // Build LLM configuration from environment variables
        const llmConfig = {
          provider: process.env.LLM_PROVIDER || "openai",
          apiKey: process.env.OPENAI_API_KEY,
          defaultModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
          temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.7,
          maxTokens: parseInt(process.env.LLM_MAX_TOKENS) || 1000,
          debug: process.env.DEBUG === "true",
        };

        // Add embedding-specific configuration
        const embeddingConfig = {
          providerType: "ubc-genai-toolkit-llm",
          logger: logger,
          llmConfig: {
            ...llmConfig,
            embeddingModel: process.env.LLM_EMBEDDING_MODEL,
            // Drop unsupported parameters when talking to OpenAI
            litellm: {
              drop_params: true,
            },
          },
        };

        console.log("Embedding config:", {
          providerType: embeddingConfig.providerType,
          embeddingModel: embeddingConfig.llmConfig.embeddingModel,
          llmProvider: embeddingConfig.llmConfig.provider,
        });

        // Initialize embeddings service
        let embeddingsInstance = null;
        try {
          if (EmbeddingsModule) {
            embeddingsInstance = await EmbeddingsModule.create(embeddingConfig);
            console.log("✅ Successfully initialized embeddings service");
          }
        } catch (embeddingError) {
          console.error(
            "❌ Failed to initialize embeddings service:",
            embeddingError
          );
          throw new Error(
            `Embeddings initialization error: ${embeddingError.message}`
          );
        }

        // Create RAG instance with embeddings configuration
        const qdrantUrl = process.env.QDRANT_URL;
        const qdrantApiKey = process.env.QDRANT_API_KEY;
        const collectionName =
          process.env.QDRANT_COLLECTION_NAME ||
          "question-generation-collection";
        const vectorSize =
          parseInt(process.env.QDRANT_VECTOR_SIZE || process.env.VECTOR_SIZE) ||
          768;

        let lastError = null;

        if (qdrantUrl) {
          try {
            console.log(
              `Attempting to connect to remote Qdrant at ${qdrantUrl}...`
            );
            const qdrantTestResponse = await fetch(
              `${qdrantUrl}/collections`,
              {
                method: "GET",
                headers: qdrantApiKey ? { "api-key": qdrantApiKey } : {},
                signal: AbortSignal.timeout(5000), // 5 second timeout
              }
            );
            if (qdrantTestResponse.ok) {
              console.log("✅ Qdrant is reachable");
            } else {
              throw new Error(
                `Remote Qdrant returned status ${qdrantTestResponse.status}`
              );
            }
          } catch (remoteError) {
            console.error(
              `❌ Remote Qdrant also failed: ${remoteError.message}`
            );
            lastError = remoteError;
            throw new Error(
              `Both local and remote Qdrant connections failed. Last error: ${remoteError.message}`
            );
          }
        } else {
          throw new Error(
            `Qdrant connection failed. Error: ${localError.message}`
          );
        }

        // Build Qdrant config
        const qdrantConfig = {
          url: qdrantUrl,
          collectionName: collectionName,
          vectorSize: vectorSize,
          distanceMetric: process.env.DISTANCE_METRIC || "Cosine",
          apiKey: qdrantApiKey,
        };

        console.log(
          `Initializing RAG with Qdrant at ${qdrantUrl}...`
        );

        globalRAGInstance = await RAGModule.create({
          provider: "qdrant",
          qdrantConfig: qdrantConfig,
          embeddingsConfig: embeddingConfig,
          chunkingConfig: {
            strategy: "simple",
            chunkSize: parseInt(process.env.CHUNK_SIZE) || 1000,
            overlap: parseInt(process.env.CHUNK_OVERLAP) || 100,
          },
          debug: process.env.DEBUG === "true",
        });
        console.log(
          `✅ Global RAG instance initialized successfully with Qdrant`
        );
      } catch (ragError) {
        console.error(
          "❌ Failed to initialize global RAG instance:",
          ragError.message
        );
        console.error("Error details:", {
          message: ragError.message,
          cause: ragError.cause?.message || ragError.cause?.code,
        });
        console.log(
          "⚠️  Server will continue without RAG functionality. Question generation will work but without vector search capabilities."
        );
        globalRAGInstance = null;
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
  await ensureRAGInitialized();

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

    // Add content to RAG
    const chunkIds = await globalRAGInstance.addDocument(content, {
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
  await ensureRAGInitialized();

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

// Simple error response function
function returnErrorResponse(res, error, details = null) {
  console.error("Question generation failed:", error);
  res.status(500).json({
    success: false,
    error: "Question generation service is currently unavailable",
    details: details || error.message,
  });
}

// Generate questions using RAG + LLM
router.post("/generate-with-rag", express.json(), async (req, res) => {
  await ensureRAGInitialized();
  
  try {
    const { objective, content, bloomLevel, course } = req.body;

    console.log("=== RAG + LLM GENERATION REQUEST ===");
    console.log("Objective:", objective);
    console.log("Content length:", content?.length || 0);
    console.log("Bloom level:", bloomLevel);
    console.log("Course:", course);
    console.log("LLMModule available:", !!LLMModule);
    console.log("RAGModule available:", !!RAGModule);

    // Validate required parameters
    if (!objective || !content || !bloomLevel) {
      return res.status(400).json({
        error: "Missing required parameters",
        details: "objective, content, and bloomLevel are required",
      });
    }

    // If UBC toolkit is not available, return error
    if (!LLMModule) {
      console.log("UBC toolkit not available");
      return returnErrorResponse(
        res,
        new Error("UBC toolkit not initialized"),
        "RAG toolkit is not properly configured"
      );
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
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${LLM_CONFIG.apiKey}`,
            },
            body: JSON.stringify({
              model: LLM_CONFIG.defaultModel,
              messages: [
                {
                  role: "user",
                  content: `Please summarize the following content in exactly ${maxContentLength} characters or less, preserving the most important information, key concepts, and main points:\n\n${content}`,
                },
              ],
              max_tokens: maxContentLength,
              temperature: LLM_CONFIG.temperature,
            }),
          }
        );

        if (!summaryResponse.ok) {
          throw new Error(
            `OpenAI API error: ${summaryResponse.status} ${summaryResponse.statusText}`
          );
        }

        const summaryData = await summaryResponse.json();
        ragContext =
          summaryData.choices?.[0]?.message?.content ||
          content.substring(0, maxContentLength);
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
      // Check if LLMModule has the expected constructor
      if (
        typeof LLMModule !== "function" &&
        typeof LLMModule.create !== "function"
      ) {
        throw new Error("LLMModule is not properly initialized");
      }

      // Initialize LLM module - try both constructor patterns
      let llmModule;
      if (typeof LLMModule.create === "function") {
        llmModule = await LLMModule.create(LLM_CONFIG);
      } else {
        llmModule = new LLMModule(LLM_CONFIG);
      }

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
      console.log(
        "Response format:",
        typeof response,
        response ? Object.keys(response) : "null"
      );

      // Extract content from response
      let responseContent;
      if (response && typeof response === "object") {
        responseContent =
          response.content || response.text || response.message || response;
      } else {
        responseContent = response;
      }

      console.log("Response content:", responseContent);

      if (!responseContent) {
        throw new Error("Empty response from LLM");
      }

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
          method: "RAG + UBC Toolkit + OpenAI",
        });
      } catch (parseError) {
        // If JSON parsing fails, return the raw response
        res.json({
          success: true,
          question: {
            question: response,
            options: ["Option A", "Option B", "Option C", "Option D"],
            correctAnswer: 0,
            explanation: "Generated using RAG + UBC Toolkit + OpenAI",
          },
          ragChunks: ragChunks,
          method: "RAG + UBC Toolkit + OpenAI (Raw Response)",
        });
      }
    } catch (llmError) {
      console.error("❌ UBC toolkit LLM failed:", llmError.message);
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
});

// Health check endpoint for debugging
router.get("/health", async (req, res) => {
  try {
    const health = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      services: {
        openai: {
          provider: LLM_CONFIG.provider,
          model: LLM_CONFIG.defaultModel,
          status: "unknown",
        },
        qdrant: {
          url: process.env.QDRANT_URL || "http://localhost:6333",
          collection:
            process.env.QDRANT_COLLECTION_NAME ||
            "question-generation-collection",
          status: "unknown",
        },
        ubcToolkit: {
          llmModule: !!LLMModule,
          ragModule: !!RAGModule,
          globalRAGInstance: !!globalRAGInstance,
        },
      },
    };

    // Test OpenAI connectivity
    try {
      const openaiResponse = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${LLM_CONFIG.apiKey}`,
        },
      });
      health.services.openai.status = openaiResponse.ok
        ? "healthy"
        : "unhealthy";
    } catch (error) {
      health.services.openai.status = "unreachable";
      health.services.openai.error = error.message;
    }

    // Test Qdrant connectivity
    try {
      const qdrantResponse = await fetch(
        `${health.services.qdrant.url}/collections`,
        {
          method: "GET",
          timeout: 3000,
        }
      );
      health.services.qdrant.status = qdrantResponse.ok
        ? "healthy"
        : "unhealthy";
    } catch (error) {
      health.services.qdrant.status = "unreachable";
      health.services.qdrant.error = error.message;
    }

    res.json({
      success: true,
      health: health,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
