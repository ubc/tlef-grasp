// Simple Server-side OpenAI Integration
// Direct API calls to OpenAI without UBC toolkit

const express = require("express");
const router = express.Router();

// Simple OpenAI configuration
const OPENAI_CONFIG = {
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.7,
  maxTokens: parseInt(process.env.LLM_MAX_TOKENS) || 1000,
};

// Generate questions using direct OpenAI API
router.post("/generate-with-rag", express.json(), async (req, res) => {
  try {
    const { objective, content, bloomLevel, course } = req.body;

    console.log("=== DIRECT OPENAI GENERATION ===");
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

    // Call OpenAI directly
    console.log("Sending prompt to OpenAI...");
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_CONFIG.apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_CONFIG.model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: OPENAI_CONFIG.temperature,
        max_tokens: OPENAI_CONFIG.maxTokens,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    console.log("✅ OpenAI response received");

    // Extract response content
    const responseContent =
      data.choices?.[0]?.message?.content || data.response || "";

    // Try to parse JSON response
    try {
      const questionData = JSON.parse(responseContent);
      res.json({
        success: true,
        question: questionData,
        ragChunks: 0, // No RAG for now
        method: "Direct OpenAI API",
      });
    } catch (parseError) {
      // If JSON parsing fails, return the raw response
      res.json({
        success: true,
        question: {
          question: responseContent,
          options: ["Option A", "Option B", "Option C", "Option D"],
          correctAnswer: 0,
          explanation: "Generated using Direct OpenAI API",
        },
        ragChunks: 0,
        method: "Direct OpenAI API (Raw Response)",
      });
    }
  } catch (error) {
    console.error("Direct OpenAI generation failed:", error);
    res.status(500).json({
      error: "Question generation failed",
      details: error.message,
      fallback: "Use template system",
    });
  }
});

// Add document endpoint (placeholder for now)
router.post("/add-document", express.json(), async (req, res) => {
  try {
    const { content, metadata } = req.body;

    console.log("=== ADDING DOCUMENT (PLACEHOLDER) ===");
    console.log("Content length:", content.length);
    console.log("Metadata:", metadata);

    // For now, just return success without actual RAG processing
    res.json({
      success: true,
      chunkIds: ["placeholder-chunk-1"],
      message: "Document added (placeholder - no RAG processing)",
    });
  } catch (error) {
    console.error("Failed to add document:", error);
    res.status(500).json({
      error: "Failed to add document",
      details: error.message,
    });
  }
});

// Search endpoint (placeholder for now)
router.post("/search", express.json(), async (req, res) => {
  try {
    const { query, limit = 5 } = req.body;

    console.log("=== SEARCHING (PLACEHOLDER) ===");
    console.log("Query:", query);
    console.log("Limit:", limit);

    // For now, return empty results
    res.json({
      success: true,
      results: [],
      count: 0,
    });
  } catch (error) {
    console.error("Failed to search:", error);
    res.status(500).json({
      error: "Failed to search",
      details: error.message,
    });
  }
});

module.exports = router;
