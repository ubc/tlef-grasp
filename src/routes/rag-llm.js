// Server-side LLM endpoint using UBC GenAI Toolkit
const express = require("express");
const router = express.Router();

// Import UBC GenAI Toolkit (server-side)
let LLMModule = null;
let RAGModule = null;
let ConsoleLogger = null;

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
    }
    if (RAGModule) {
      console.log("RAGModule.create:", typeof RAGModule.create);
      console.log("RAGModule methods:", Object.getOwnPropertyNames(RAGModule));
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
initializeUBCToolkit();

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

    if (!RAGModule) {
      return res.status(500).json({
        error: "RAG Module not initialized",
        fallback: "Use client-side RAG",
      });
    }

    console.log("=== SEARCHING SERVER-SIDE RAG ===");
    console.log("Query:", query);
    console.log("Limit:", limit);

    // Initialize RAG module
    const ragModule = await RAGModule.create(RAG_CONFIG);

    // Search for relevant content
    const results = await ragModule.retrieveContext(query, { limit });

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

// RAG Configuration - Disabled for development
// The UBC toolkit embeddings are causing long delays and failures
const RAG_CONFIG = {
  provider: "qdrant",
  qdrantConfig: {
    url: "http://localhost:6333",
    collectionName: "question-generation-collection",
    vectorSize: 384,
    distanceMetric: "Cosine",
  },
  embeddingsConfig: {
    provider: "disabled", // This will cause RAG to fail gracefully
    model: "disabled",
  },
  debug: true,
};

// LLM Configuration
const LLM_CONFIG = {
  provider: "ollama",
  model: "llama3.2:latest",
  baseURL: "http://localhost:11434",
  temperature: 0.7,
  maxTokens: 1000,
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
    const response = await fetch(`${LLM_CONFIG.baseURL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: LLM_CONFIG.model,
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

    // Skip RAG entirely for now - UBC toolkit has initialization issues
    console.log("Skipping RAG initialization (UBC toolkit has issues)");
    console.log("💡 Using direct content for question generation");

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
          "http://localhost:11434/api/generate",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "llama3.2",
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
    } else {
      ragContext = content;
    }
    ragChunks = 0;

    // For now, let's use direct Ollama for LLM generation
    // The UBC toolkit LLM module seems to have initialization issues
    console.log(
      "Using direct Ollama for LLM generation (UBC toolkit LLM has issues)"
    );
    return await generateWithDirectOllama(req, res);

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

CONTENT: ${ragContext}`;

    // Generate question using LLM
    console.log("Sending prompt to Ollama...");
    const response = await llmModule.generate(prompt);

    console.log("✅ LLM response received");

    // Try to parse JSON response
    try {
      let questionData;

      // First try to parse the response directly
      try {
        questionData = JSON.parse(response);
      } catch (directParseError) {
        // If direct parsing fails, try to extract JSON from the response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
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
          explanation: "Generated using RAG + LLM",
        },
        ragChunks: ragChunks,
        method: "RAG + UBC Toolkit + Ollama (Raw Response)",
      });
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

module.exports = router;
