// LLM Service - Singleton pattern
// Handles all LLM operations for question generation

class LLMService {
  constructor() {
    if (LLMService.instance) {
      return LLMService.instance;
    }

    this.LLMModule = null;
    this.isInitialized = false;
    this.initializationPromise = null;
    this.provider = process.env.LLM_PROVIDER || 'ollama';

    // Initialize on first instantiation
    this.initializationPromise = this.initializeLLM();

    LLMService.instance = this;
  }

  async initializeLLM() {
    try {
      console.log("Initializing LLM Service on server...");

      // Import LLM module dynamically
      const llmModule = await import("ubc-genai-toolkit-llm");

      // Try different ways to access the module
      this.LLMModule =
        llmModule.LLMModule || llmModule.default?.LLMModule || llmModule.default;

      if (!this.LLMModule) {
        throw new Error("LLMModule not found in ubc-genai-toolkit-llm");
      }

      console.log("✅ LLM Service initialized successfully");
      this.isInitialized = true;
    } catch (error) {
      console.error("❌ LLM Service initialization failed:", error);
      this.isInitialized = false;
      throw error;
    }
  }

  /**
   * Get LLM instance with proper configuration
   * @returns {Promise<Object>} LLM instance
   */
  async getLLMInstance() {
    if (!this.isInitialized) {
      await this.initializationPromise;
    }

    if (!this.isInitialized || !this.LLMModule) {
      throw new Error("LLM service not initialized");
    }

    // Import ConsoleLogger for LLM config
    const coreModule = await import("ubc-genai-toolkit-core");
    const ConsoleLogger =
      coreModule.ConsoleLogger ||
      coreModule.default?.ConsoleLogger ||
      coreModule.default;

    // Build config based on provider
    let llmConfig;
    
    if (this.provider === 'openai') {
      llmConfig = {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        defaultOptions: {
          temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.7,
          maxTokens: parseInt(process.env.LLM_MAX_TOKENS) || 2000
        },
        logger: new ConsoleLogger('LLM'),
      };
    } else {
      // Ollama (local LLM)
      llmConfig = {
        provider: 'ollama',
        endpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434',
        defaultModel: process.env.OLLAMA_MODEL || 'llama3.1:8b',
        defaultOptions: {
          temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.7,
          maxTokens: parseInt(process.env.LLM_MAX_TOKENS) || 2000
        },
        logger: new ConsoleLogger('LLM'),
      };
    }

    // LLMModule uses constructor, not static create method
    return new this.LLMModule(llmConfig);
  }  

  /**
   * Check if the service is initialized
   * @returns {boolean}
   */
  isReady() {
    return this.isInitialized && !!this.LLMModule;
  }
}

// Export singleton instance
module.exports = new LLMService();
