// Direct Ollama API Service (Fallback)
// Uses fetch to call Ollama directly without UBC toolkit

class DirectOllamaService {
  constructor() {
    this.baseURL = "http://localhost:11434";
    this.model = "llama3.2:latest";
    this.isInitialized = true;
    console.log("✅ Direct Ollama Service initialized");
  }

  async generateQuestionWithRAG(prompt, ragContext = "") {
    try {
      console.log("=== DIRECT OLLAMA API CALL ===");
      console.log("RAG Context length:", ragContext.length);
      console.log("Sending to Ollama API...");

      const fullPrompt = `${ragContext}\n\n${prompt}`;

      const response = await fetch(`${this.baseURL}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          prompt: fullPrompt,
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 1000,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Ollama API error: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      console.log(
        "✅ Ollama response received:",
        data.response.substring(0, 200) + "..."
      );

      return data.response;
    } catch (error) {
      console.error("❌ Direct Ollama API failed:", error);
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
window.DirectOllamaService = DirectOllamaService;

