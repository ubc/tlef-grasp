// Direct OpenAI API Service (Fallback)
// Uses fetch to call OpenAI directly without UBC toolkit

class DirectOpenAIService {
  constructor() {
    this.apiKey = window.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    this.model = window.OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
    this.temperature = parseFloat(window.LLM_TEMPERATURE || process.env.LLM_TEMPERATURE) || 0.7;
    this.maxTokens = parseInt(window.LLM_MAX_TOKENS || process.env.LLM_MAX_TOKENS) || 1000;
    this.isInitialized = !!this.apiKey;
    console.log("✅ Direct OpenAI Service initialized");
  }

  async generateQuestionWithRAG(prompt, ragContext = "") {
    try {
      console.log("=== DIRECT OPENAI API CALL ===");
      console.log("RAG Context length:", ragContext.length);
      console.log("Sending to OpenAI API...");

      const fullPrompt = `${ragContext}\n\n${prompt}`;

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: "user",
              content: fullPrompt,
            },
          ],
          temperature: this.temperature,
          max_tokens: this.maxTokens,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `OpenAI API error: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      const responseContent = data.choices?.[0]?.message?.content || "";
      console.log(
        "✅ OpenAI response received:",
        responseContent.substring(0, 200) + "..."
      );

      return responseContent;
    } catch (error) {
      console.error("❌ Direct OpenAI API failed:", error);
      throw error;
    }
  }

  async generateMultipleChoiceQuestion(objective, ragContent, bloomLevel) {
    const prompt = this.createQuestionPrompt(objective, bloomLevel);
    return await this.generateQuestionWithRAG(prompt, ragContent);
  }

  createQuestionPrompt(objective, bloomLevel) {
    return `You are an expert educational content creator. Generate a high-quality multiple-choice question based on the provided content.

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

IMPORTANT: Base your question on the specific details, examples, formulas, or concepts mentioned in the provided content. Don't create generic questions - make them specific to what's actually in the materials.`;
  }

  isAvailable() {
    return this.isInitialized;
  }
}

// Export for use in other files
window.DirectOpenAIService = DirectOpenAIService;
// Keep old name for backwards compatibility
window.DirectOllamaService = DirectOpenAIService;

