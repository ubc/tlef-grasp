// Server-side LLM endpoint using UBC GenAI Toolkit
// Routes only - all RAG initialization and operations are handled by the RAG service

const express = require("express");
const router = express.Router();

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

// Add document to RAG
router.post(
  "/add-document",
  express.json({ limit: "50mb" }),  // allow up to 50 MB
  express.urlencoded({ limit: "50mb", extended: true }),
  async (req, res) => {
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
});

// Search RAG knowledge base
router.post("/search", express.json(), async (req, res) => {
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
});

// Generate questions using RAG + LLM
router.post("/generate-with-rag", express.json(), async (req, res) => {
  try {
    const { objective, content, bloomLevel, course } = req.body;

    console.log("=== RAG + LLM GENERATION REQUEST ===");
    console.log("Objective:", objective);
    console.log("Content length:", content?.length || 0);
    console.log("Bloom level:", bloomLevel);
    console.log("Course:", course);

    // Validate required parameters
    if (!objective || !content || !bloomLevel) {
      return res.status(400).json({
        error: "Missing required parameters",
        details: "objective, content, and bloomLevel are required",
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
    console.log("Objective:", objective);
    console.log("Content length:", content.length);
    console.log("Bloom level:", bloomLevel);

    let ragContext = content; // Use full content as fallback
    let ragChunks = 0;

    // Try to use RAG for content retrieval
    try {
      console.log("=== USING GLOBAL RAG FOR CONTENT RETRIEVAL ===");

      const ragInstance = ragService.getRAGInstance();

      if (!ragInstance) {
        throw new Error("Global RAG instance not available");
      }

      // Search for relevant content based on the learning objective
      console.log("Searching for relevant content using objective:", objective);
      const ragResults = await ragInstance.retrieveContext(objective, {
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
        const LLM_CONFIG = {
          apiKey: process.env.OPENAI_API_KEY,
          defaultModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
          temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.7,
        };

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

    // Use LLM service for generation
    console.log("=== USING LLM SERVICE FOR GENERATION ===");

    try {
      // Get LLM instance from service
      const llmModule = await llmService.getLLMInstance();

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

      console.log("Sending prompt to LLM service...");
      const response = await llmModule.sendMessage(prompt);

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
          method: "RAG + LLM Service",
        });
      } catch (parseError) {
        // If JSON parsing fails, return the raw response
        res.json({
          success: true,
          question: {
            question: response,
            options: ["Option A", "Option B", "Option C", "Option D"],
            correctAnswer: 0,
            explanation: "Generated using RAG + LLM Service",
          },
          ragChunks: ragChunks,
          method: "RAG + LLM Service (Raw Response)",
        });
      }
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
});

// Health check endpoint for debugging
router.get("/health", async (req, res) => {
  try {
    const ragInstance = ragService.getRAGInstance();
    const llmReady = llmService.isReady();

    const health = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      services: {
        openai: {
          provider: process.env.LLM_PROVIDER || "openai",
          model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
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
          llmService: llmReady,
          ragInstance: !!ragInstance,
        },
      },
    };

    // Test OpenAI connectivity
    try {
      const openaiResponse = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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

// Fetch and extract text from URL (server-side proxy to bypass CORS)
router.post("/fetch-url-content", express.json(), async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !url.trim()) {
      return res.status(400).json({
        error: "URL is required",
      });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({
        error: "Invalid URL format",
      });
    }

    console.log("=== FETCHING URL CONTENT (SERVER-SIDE) ===");
    console.log("URL:", url);

    // Fetch the webpage - use built-in fetch (Node.js 18+) or node-fetch
    let fetchFn;
    try {
      // Try built-in fetch first (Node.js 18+)
      fetchFn = globalThis.fetch || fetch;
      if (!fetchFn) {
        // Fallback to node-fetch if available
        const nodeFetch = await import("node-fetch");
        fetchFn = nodeFetch.default;
      }
    } catch (e) {
      throw new Error("Fetch is not available. Please use Node.js 18+ or install node-fetch");
    }

    const response = await fetchFn(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();

    // Extract and clean text from HTML using Cheerio
    let cheerio;
    try {
      cheerio = require("cheerio");
    } catch (e) {
      throw new Error("cheerio is required for HTML parsing. Please install it: npm install cheerio");
    }

    const $ = cheerio.load(html);

    // Remove unwanted elements (scripts, styles, navigation, ads, etc.)
    const unwantedSelectors = [
      "script",
      "style",
      "nav",
      "header",
      "footer",
      "aside",
      ".ad",
      ".ads",
      ".advertisement",
      ".sidebar",
      ".menu",
      ".navigation",
      ".nav",
      ".header",
      ".footer",
      "[role='navigation']",
      "[role='banner']",
      "[role='complementary']",
      ".social-share",
      ".share-buttons",
      ".comments",
      ".comment-section",
      "noscript",
      "iframe",
      "embed",
      "object",
    ];

    unwantedSelectors.forEach((selector) => {
      try {
        $(selector).remove();
      } catch (e) {
        // Ignore invalid selectors
      }
    });

    // Try to find main content area (prioritize semantic HTML)
    let mainContent;
    if ($("main").length > 0) {
      mainContent = $("main").first();
    } else if ($("article").length > 0) {
      mainContent = $("article").first();
    } else if ($('[role="main"]').length > 0) {
      mainContent = $('[role="main"]').first();
    } else if ($(".content").length > 0) {
      mainContent = $(".content").first();
    } else if ($("#content").length > 0) {
      mainContent = $("#content").first();
    } else if ($(".main-content").length > 0) {
      mainContent = $(".main-content").first();
    } else if ($("#main-content").length > 0) {
      mainContent = $("#main-content").first();
    } else {
      mainContent = $("body");
    }

    // Extract text from main content
    let text = mainContent.text() || "";

    // Clean up the text
    text = text
      .replace(/\s+/g, " ") // Replace multiple whitespace with single space
      .replace(/\n\s*\n/g, "\n") // Remove empty lines
      .replace(/^\s+|\s+$/gm, "") // Trim each line
      .trim();

    // Limit text length to prevent issues
    const maxLength = 100000; // 100k characters
    if (text.length > maxLength) {
      text = text.substring(0, maxLength) + "... [Content truncated due to length]";
    }

    // Get title if available
    const title = $("title").text() || url;

    console.log(`✅ Extracted ${text.length} characters from URL`);

    res.json({
      success: true,
      content: text,
      title: title,
      url: url,
      length: text.length,
    });
  } catch (error) {
    console.error("Error fetching URL content:", error);
    res.status(500).json({
      error: "Failed to fetch URL content",
      details: error.message,
    });
  }
});

router.delete("/delete-document/:sourceId", async (req, res) => {
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
});

module.exports = router;
