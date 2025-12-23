// LLM Service for Question Generation
// Interfaces with OpenAI through UBC GenAI Toolkit

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

      // Configure for OpenAI
      const llmConfig = {
        provider: "openai",
        apiKey: window.OPENAI_API_KEY || process.env.OPENAI_API_KEY,
        model: window.OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: parseFloat(window.LLM_TEMPERATURE || process.env.LLM_TEMPERATURE) || 0.7,
        maxTokens: parseInt(window.LLM_MAX_TOKENS || process.env.LLM_MAX_TOKENS) || 1000,
      };

      console.log("Creating LLM module with config:", {
        provider: llmConfig.provider,
        model: llmConfig.model,
        hasApiKey: !!llmConfig.apiKey,
      });
      this.llmModule = await LLMModule.create(llmConfig);
      this.isInitialized = true;
      console.log("✅ LLM Service initialized with OpenAI successfully");
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
      console.log("Sending to OpenAI...");

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
    return `You are an university instructor. Generate a high-quality multiple-choice question based on the provided content that effectively test students’ understanding of the course learning objective.

OBJECTIVE: ${objective}
BLOOM'S TAXONOMY LEVEL: ${bloomLevel}

Task: 
Create a multiple-choice question on based on the provided content that effectively test students’ understanding of the learning objective.
Use actual content from the materials - don't be generic

Format:
Each question must have four answer choices, with only one correct answer. Label each answer choice (A, B, C, D)
the response format must be a valid JSON with the exact structure as follows:
{
  "question": "Your specific question here",
  "options": {
    "A": "First option text", // The first option
    "B": "Second option text", // The second option
    "C": "Third option text", // The third option
    "D": "Fourth option text", // The fourth option
  },
  "correctAnswer": "A", // The letter of the correct answer
  "explanation": "Why this answer is correct based on the content" // The explanation of why the correct answer is correct
}

The distractors (incorrect answers) should be plausible but subtly flawed, to effectively test students' understanding.

IMPORTANT: 
- CRITICAL: Always wrap any mathematical expressions in LaTeX delimiters. You MUST use backslash-parenthesis \( ... \) for inline math (NOT plain parentheses). Examples:
  * CORRECT: \( \frac{3}{4} \) or \( x^2 + 5 = 10 \)
  * WRONG: (\frac{3}{4}) or (x^2 + 5 = 10) - these will NOT render as math
  * Use \[ ... \] for display math (block equations on their own line)
  * Do NOT use $ ... $ delimiters - only use \( ... \) for inline math and \[ ... \] for display math
  * The backslash before the parenthesis is REQUIRED - \( not just (
- CRITICAL: Do NOT include letter prefixes (A), B), C), D) or A., B., C., D. or A , B , C , D ) in the option text. The options object values should contain only the option text itself, without any letter labels, prefixes, or formatting. For example, use "The correct answer" NOT "A) The correct answer" or "A. The correct answer".`;
  }

  isAvailable() {
    return this.isInitialized && this.llmModule !== null;
  }
}

// Export for use in other files
window.LLMService = LLMService;
