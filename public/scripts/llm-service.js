// LLM Service for Question Generation
// Interfaces with Ollama through UBC GenAI Toolkit

// Import UBC GenAI Toolkit at the top level
import { LLMModule } from "ubc-genai-toolkit-llm";

class LLMService {
  constructor() {
    this.isInitialized = false;
    this.llmModule = null;
    this.initializeLLM();
  }

  async initializeLLM() {
    try {
      console.log("=== LLM SERVICE INITIALIZATION ===");
      console.log("UBC GenAI Toolkit imported successfully");

      // Configure for Ollama
      const llmConfig = {
        provider: "ollama",
        model: "llama3.2:latest", // Using your available model
        baseURL: "http://localhost:11434", // Default Ollama URL
        temperature: 0.7,
        maxTokens: 1000,
      };

      console.log("Creating LLM module with config:", llmConfig);
      this.llmModule = await LLMModule.create(llmConfig);
      this.isInitialized = true;
      console.log("✅ LLM Service initialized with Ollama successfully");
    } catch (error) {
      console.error("❌ LLM initialization failed:", error);
      console.error("Error details:", error.message);
      console.error("Stack trace:", error.stack);
      this.isInitialized = false;
    }
  }

  async generateQuestionWithRAG(prompt, ragContext = "") {
    if (!this.isInitialized || !this.llmModule) {
      throw new Error("LLM service not initialized");
    }

    try {
      // Combine RAG context with prompt
      const fullPrompt = `${ragContext}\n\n${prompt}`;

      console.log("=== LLM PROMPT DEBUG ===");
      console.log("RAG Context length:", ragContext.length);
      console.log("Full prompt length:", fullPrompt.length);
      console.log("Sending to Ollama...");

      const response = await this.llmModule.generate(fullPrompt);

      console.log("=== LLM RESPONSE DEBUG ===");
      console.log("Response length:", response.length);
      console.log("Response preview:", response.substring(0, 200) + "...");

      return response;
    } catch (error) {
      console.error("LLM generation failed:", error);
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
    return this.isInitialized && this.llmModule !== null;
  }
}

// Export for use in other files
window.LLMService = LLMService;
