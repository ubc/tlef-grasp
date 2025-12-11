// RAG Service - Singleton pattern
// Handles all RAG initialization and provides helper functions

// Import Qdrant patch to fix Float32Array issue
require("../utils/qdrant-patch");

class RAGService {
  constructor() {
    if (RAGService.instance) {
      return RAGService.instance;
    }

    // Import UBC GenAI Toolkit (server-side)
    this.LLMModule = null;
    this.RAGModule = null;
    this.ConsoleLogger = null;
    this.EmbeddingsModule = null;
    this.globalRAGInstance = null;
    this.initializationPromise = null;

    // Initialize on first instantiation
    this.initializationPromise = this.initializeUBCToolkit();

    RAGService.instance = this;
  }

  async initializeUBCToolkit() {
    try {
      console.log("Initializing UBC GenAI Toolkit on server...");

      // Import modules
      const llmModule = await import("ubc-genai-toolkit-llm");
      const ragModule = await import("ubc-genai-toolkit-rag");
      const coreModule = await import("ubc-genai-toolkit-core");
      const embeddingsModule = await import("ubc-genai-toolkit-embeddings");

      console.log("LLM Module keys:", Object.keys(llmModule));
      console.log("RAG Module keys:", Object.keys(ragModule));

      // Try different ways to access the modules
      this.LLMModule =
        llmModule.LLMModule || llmModule.default?.LLMModule || llmModule.default;
      this.RAGModule =
        ragModule.RAGModule || ragModule.default?.RAGModule || ragModule.default;
      this.ConsoleLogger =
        coreModule.ConsoleLogger ||
        coreModule.default?.ConsoleLogger ||
        coreModule.default;
      this.EmbeddingsModule =
        embeddingsModule.EmbeddingsModule ||
        embeddingsModule.default?.EmbeddingsModule ||
        embeddingsModule.default;

      // If still not found, try direct access
      if (!this.LLMModule && llmModule.default) {
        this.LLMModule = llmModule.default;
      }
      if (!this.RAGModule && ragModule.default) {
        this.RAGModule = ragModule.default;
      }
      if (!this.ConsoleLogger && coreModule.default) {
        this.ConsoleLogger = coreModule.default;
      }
      if (!this.EmbeddingsModule && embeddingsModule.default) {
        this.EmbeddingsModule = embeddingsModule.default;
      }

      console.log("LLMModule:", typeof this.LLMModule);
      console.log("RAGModule:", typeof this.RAGModule);

      // Test if the modules have the create method
      if (this.LLMModule) {
        console.log("LLMModule.create:", typeof this.LLMModule.create);
        console.log("LLMModule methods:", Object.getOwnPropertyNames(this.LLMModule));
        console.log(
          "LLMModule prototype:",
          Object.getOwnPropertyNames(this.LLMModule.prototype)
        );
      }
      if (this.RAGModule) {
        console.log("RAGModule.create:", typeof this.RAGModule.create);
        console.log("RAGModule methods:", Object.getOwnPropertyNames(this.RAGModule));

        // Initialize global RAG instance
        try {
          console.log("Initializing global RAG instance...");

          // Create logger instance
          const logger = this.ConsoleLogger ? new this.ConsoleLogger() : null;

          // Build LLM configuration from environment variables
          const llmConfig = {
            provider: process.env.LLM_PROVIDER || "openai",
            apiKey: process.env.OPENAI_API_KEY,
            defaultModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
            temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.7,
            maxTokens: parseInt(process.env.LLM_MAX_TOKENS) || 1000,
            debug: process.env.DEBUG === "true",
          };

          // Add embedding-specific configuration
          const embeddingConfig = {
            providerType: "ubc-genai-toolkit-llm",
            logger: logger,
            llmConfig: {
              ...llmConfig,
              embeddingModel: process.env.LLM_EMBEDDING_MODEL,
              // Drop unsupported parameters when talking to OpenAI
              litellm: {
                drop_params: true,
              },
            },
          };

          console.log("Embedding config:", {
            providerType: embeddingConfig.providerType,
            embeddingModel: embeddingConfig.llmConfig.embeddingModel,
            llmProvider: embeddingConfig.llmConfig.provider,
          });

          // Initialize embeddings service
          let embeddingsInstance = null;
          try {
            if (this.EmbeddingsModule) {
              embeddingsInstance = await this.EmbeddingsModule.create(embeddingConfig);
              console.log("✅ Successfully initialized embeddings service");
            }
          } catch (embeddingError) {
            console.error(
              "❌ Failed to initialize embeddings service:",
              embeddingError
            );
            throw new Error(
              `Embeddings initialization error: ${embeddingError.message}`
            );
          }

          // Create RAG instance with embeddings configuration
          const qdrantUrl = process.env.QDRANT_URL;
          const qdrantApiKey = process.env.QDRANT_API_KEY;
          const collectionName =
            process.env.QDRANT_COLLECTION_NAME ||
            "question-generation-collection";
          const vectorSize =
            parseInt(process.env.QDRANT_VECTOR_SIZE || process.env.VECTOR_SIZE) ||
            768;

          if (qdrantUrl) {
            try {
              console.log(
                `Attempting to connect to remote Qdrant at ${qdrantUrl}...`
              );
              const qdrantTestResponse = await fetch(
                `${qdrantUrl}/collections`,
                {
                  method: "GET",
                  headers: qdrantApiKey ? { "api-key": qdrantApiKey } : {},
                  signal: AbortSignal.timeout(5000), // 5 second timeout
                }
              );
              if (qdrantTestResponse.ok) {
                console.log("✅ Qdrant is reachable");
              } else {
                throw new Error(
                  `Remote Qdrant returned status ${qdrantTestResponse.status}`
                );
              }
            } catch (remoteError) {
              console.error(
                `❌ Remote Qdrant also failed: ${remoteError.message}`
              );
              throw new Error(
                `Both local and remote Qdrant connections failed. Last error: ${remoteError.message}`
              );
            }
          } else {
            throw new Error("QDRANT_URL is not set");
          }

          // Build Qdrant config
          const qdrantConfig = {
            url: qdrantUrl,
            collectionName: collectionName,
            vectorSize: vectorSize,
            distanceMetric: process.env.DISTANCE_METRIC || "Cosine",
            apiKey: qdrantApiKey,
          };

          console.log(
            `Initializing RAG with Qdrant at ${qdrantUrl}...`
          );

          this.globalRAGInstance = await this.RAGModule.create({
            provider: "qdrant",
            qdrantConfig: qdrantConfig,
            embeddingsConfig: embeddingConfig,
            chunkingConfig: {
              strategy: "simple",
              chunkSize: parseInt(process.env.CHUNK_SIZE) || 1000,
              overlap: parseInt(process.env.CHUNK_OVERLAP) || 100,
            },
            debug: process.env.DEBUG === "true",
          });
          console.log(
            `✅ Global RAG instance initialized successfully with Qdrant`
          );
        } catch (ragError) {
          console.error(
            "❌ Failed to initialize global RAG instance:",
            ragError.message
          );
          console.error("Error details:", {
            message: ragError.message,
            cause: ragError.cause?.message || ragError.cause?.code,
          });
          console.log(
            "⚠️  Server will continue without RAG functionality. Question generation will work but without vector search capabilities."
          );
          this.globalRAGInstance = null;
        }
      }

      console.log("✅ UBC GenAI Toolkit initialized successfully");
      return true;
    } catch (error) {
      console.error("❌ Failed to initialize UBC GenAI Toolkit:", error);
      console.error("Error details:", error.message);
      console.error(
        "This is expected if UBC toolkit dependencies are not available"
      );
      this.LLMModule = null;
      this.RAGModule = null;
      return false;
    }
  }

  async ensureRAGInitialized() {
    if (!this.globalRAGInstance) {
      console.log("RAG not initialized, waiting for initialization...");
      try {
        await this.initializationPromise;
        console.log("RAG initialization completed");
      } catch (error) {
        console.error("RAG initialization failed:", error);
      }
    }
    return this.globalRAGInstance;
  }

  getRAGInstance() {
    return this.globalRAGInstance;
  }

  getLLMModule() {
    return this.LLMModule;
  }

  async addDocumentToRAG(content, metadata = {}) {
    await this.ensureRAGInitialized();

    if (!this.globalRAGInstance) {
      throw new Error("RAG instance is not initialized");
    }

    console.log("=== ADDING DOCUMENT TO SERVER-SIDE RAG ===");
    console.log("Content length:", content.length);
    console.log("Metadata:", metadata);

    // Add content to RAG
    const chunkIds = await this.globalRAGInstance.addDocument(content, {
      ...metadata,
      timestamp: new Date().toISOString(),
    });

    console.log(`✅ Added ${chunkIds.length} chunks to RAG`);
    return chunkIds;
  }

  async deleteDocumentFromRAG(sourceId) {
    await this.ensureRAGInitialized();

    if (!this.globalRAGInstance) {
      throw new Error("RAG instance is not initialized");
    }

    console.log("=== DELETING DOCUMENT FROM SERVER-SIDE RAG ===");
    console.log("Source ID:", sourceId);

    // Delete documents matching the sourceId in metadata
    await this.globalRAGInstance.deleteDocumentsByMetadata({
      sourceId: sourceId,
    });

    console.log(`✅ Document with sourceId ${sourceId} deleted successfully`);
  }
}

// Export singleton instance
const ragService = new RAGService();

module.exports = ragService;

