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
router.post("/generate-questions-with-rag", express.json(), async (req, res) => {
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
3. Include 4 answer options
4. Make the correct answer clearly correct based on the content
5. Make incorrect answers plausible but clearly wrong
6. Focus on the specific concepts, examples, or details mentioned in the content
7. Format your response as JSON with this structure:
{
  "question": "Your specific question here",
  "options": {
    "A": "First option text",
    "B": "Second option text",
    "C": "Third option text",
    "D": "Fourth option text"
  },
  "correctAnswer": "A",
  "explanation": "Why this answer is correct based on the content"
}

CRITICAL FORMATTING REQUIREMENTS:
- Return ONLY valid JSON. Do NOT wrap the JSON in markdown code blocks (do not use triple backticks with json or triple backticks alone).
- Do NOT include any text before or after the JSON object.
- The response must start with { and end with }.
- Return pure JSON that can be directly parsed with JSON.parse().

IMPORTANT: 
- Base your question on the specific details, examples, formulas, or concepts mentioned in the provided content. Don't create generic questions - make them specific to what's actually in the materials.
- CRITICAL: Use an object for options with keys "A", "B", "C", "D" (not an array). Place the correct answer at a random key (A, B, C, or D) and set correctAnswer to that exact key letter. For example, if the correct answer is in option "B", set correctAnswer to "B". This avoids array index confusion.
- CRITICAL: You MUST randomly choose which option (A, B, C, or D) contains the correct answer. Each letter should have an equal 25% chance of being the correct answer. Do NOT bias toward A, B, or C - ensure D is also used frequently. After placing the correct answer text in one of the four options, set correctAnswer to that exact letter. Use a random number generator or random selection - do NOT always use A, B, or C. Option D must be selected approximately 25% of the time.
- CRITICAL: Always wrap any mathematical expressions in LaTeX delimiters. You MUST use backslash-parenthesis \( ... \) for inline math (NOT plain parentheses). Examples:
  * CORRECT: \( \frac{3}{4} \) or \( x^2 + 5 = 10 \)
  * WRONG: (\frac{3}{4}) or (x^2 + 5 = 10) - these will NOT render as math
  * Use \[ ... \] for display math (block equations on their own line)
  * Do NOT use $ ... $ delimiters - only use \( ... \) for inline math and \[ ... \] for display math
  * The backslash before the parenthesis is REQUIRED - \( not just (
- CRITICAL: Do NOT include letter prefixes (A), B), C), D) or A., B., C., D. or A , B , C , D ) in the option text. The options object values should contain only the option text itself, without any letter labels, prefixes, or formatting. For example, use "The correct answer" NOT "A) The correct answer" or "A. The correct answer".

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
