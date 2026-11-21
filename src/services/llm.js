// LLM Service - Singleton pattern
// Handles all LLM operations for question generation

const { getLLMProvider, getModelForProvider } = require("../utils/llm-provider");

// Model used when OPENAI_LLM_MODEL / OLLAMA_LLM_MODEL is unset. The sandbox's
// default lives in getModelForProvider, so the usage log sees it too.
const FALLBACK_MODELS = {
  openai: "gpt-4o-mini",
  ollama: "llama3.1:8b",
};

// The newer OpenAI models reject an explicit `temperature` (only the default is
// allowed) and expose `reasoning_effort` instead, so nothing on the OpenAI path
// sends a temperature. generateStructured resolves effort per operation; this
// covers the callers that build an instance directly (the document parsers),
// which have no operation label of their own.
const { resolveEffort } = require("../utils/llm-effort");

class LLMService {
  constructor() {
    if (LLMService.instance) {
      return LLMService.instance;
    }

    this.LLMModule = null;
    this.isInitialized = false;
    this.initializationPromise = null;

    // Initialize on first instantiation
    this.initializationPromise = this.initializeLLM();

    LLMService.instance = this;
  }

  async initializeLLM() {
    try {
      console.log("Initializing LLM Service on server...");

      // The toolkit is CommonJS, so a plain require works (and, unlike a
      // dynamic import, can be mocked by the unit tests).
      const llmModule = require("ubc-genai-toolkit-llm");

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
   * @param {string|null} [overrideModel=null] - Optional model to override the default model
   * @param {object} [overrideOptions={}] - Options merged over the defaults; a null value removes that option
   * @param {string} [provider] - "openai" | "ollama" | "ubc-llm-sandbox"; defaults to LLM_PROVIDER.
   *                              generateStructured passes the provider for its operation, so grading
   *                              can go to GRADING_LLM_PROVIDER.
   * @returns {Promise<Object>} LLM instance
   */
  async getLLMInstance(overrideModel = null, overrideOptions = {}, provider = getLLMProvider()) {
    if (!this.isInitialized) {
      await this.initializationPromise;
    }

    if (!this.isInitialized || !this.LLMModule) {
      throw new Error("LLM service not initialized");
    }

    const { ConsoleLogger } = require("ubc-genai-toolkit-core");

    // Build config based on provider
    let llmConfig;
    const model = overrideModel || getModelForProvider(provider) || FALLBACK_MODELS[provider];

    // OpenAI and the UBC LLM Sandbox take the same OpenAI-style options. The
    // sandbox's toolkit provider translates them per model: for Qwen,
    // reasoning_effort "none" becomes enable_thinking: false, and other values
    // are forwarded (and currently ignored by the gateway).
    const openAIStyleOptions = () => {
      const opts = {
        reasoning_effort: resolveEffort(),
        max_completion_tokens: parseInt(process.env.LLM_MAX_TOKENS) || 2000,
        response_format: { type: 'json_object' },
        ...overrideOptions
      };
      Object.keys(opts).forEach(k => opts[k] === null && delete opts[k]);
      return opts;
    };

    if (provider === 'openai') {
      llmConfig = {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        defaultModel: model,
        defaultOptions: openAIStyleOptions(),
        logger: new ConsoleLogger('LLM'),
      };
    } else if (provider === 'ubc-llm-sandbox') {
      llmConfig = {
        provider: 'ubc-llm-sandbox',
        apiKey: process.env.UBC_LLM_SANDBOX_API_KEY,
        endpoint: process.env.UBC_LLM_SANDBOX_ENDPOINT,
        defaultModel: model,
        defaultOptions: openAIStyleOptions(),
        logger: new ConsoleLogger('LLM'),
      };
    } else {
      // Ollama (local LLM)
      llmConfig = {
        provider: 'ollama',
        endpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434',
        defaultModel: model,
        defaultOptions: (() => {
          const opts = {
            temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.7,
            maxTokens: parseInt(process.env.LLM_MAX_TOKENS) || 2000,
            format: 'json',
            ...overrideOptions
          };
          Object.keys(opts).forEach(k => opts[k] === null && delete opts[k]);
          return opts;
        })(),
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
