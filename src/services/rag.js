// RAG Service - Singleton pattern
// Handles all RAG initialization and provides helper functions
const { getObjectiveWithMaterials } = require('./objective');

class RAGService {
  constructor() {
    if (RAGService.instance) {
      return RAGService.instance;
    }

    // Import UBC GenAI Toolkit (server-side)
    this.RAGInstance = null;
    this.RAGModule = null;
    // Initialize on first instantiation
    this.initializationPromise = this.initializeRAG();

    RAGService.instance = this;
  }

  async initializeRAG() {
    try {
      console.log("Initializing UBC GenAI Toolkit on server...");

      // Import modules
      const ragModule = await import("ubc-genai-toolkit-rag");
      const coreModule = await import("ubc-genai-toolkit-core");

      // Extract RAGModule from the imported module
      this.RAGModule =
        ragModule.RAGModule || ragModule.default?.RAGModule || ragModule.default;

      // Extract ConsoleLogger
      const ConsoleLogger =
        coreModule.ConsoleLogger ||
        coreModule.default?.ConsoleLogger ||
        coreModule.default;

      if (!this.RAGModule) {
        throw new Error("RAGModule not found in ubc-genai-toolkit-rag");
      }

      if (!ConsoleLogger) {
        throw new Error("ConsoleLogger not found in ubc-genai-toolkit-core");
      }

      // Initialize global RAG instance
      console.log("Initializing global RAG instance...");

      const ragConfig = {
        provider: "qdrant",
        qdrantConfig: {
          url: process.env.QDRANT_URL || "http://localhost:6333",
          collectionName: process.env.QDRANT_COLLECTION_NAME || "question-generation-collection",
          vectorSize: parseInt(process.env.QDRANT_VECTOR_SIZE) || 768,
          distanceMetric: 'Cosine',
        },
        embeddingsConfig: {
          providerType: process.env.EMBEDDING_PROVIDER,
          model: process.env.LLM_EMBEDDING_MODEL,
          llmConfig: {
            provider: process.env.LLM_PROVIDER,
            defaultModel: process.env.OPENAI_MODEL,
          },
        },
        logger: new ConsoleLogger('RAG'),
      };

      if (process.env.QDRANT_API_KEY) {
        ragConfig.qdrantConfig.apiKey = process.env.QDRANT_API_KEY;
        ragConfig.embeddingsConfig.llmConfig.apiKey = process.env.OPENAI_API_KEY;
      }

      try {
        this.RAGInstance = await this.RAGModule.create(ragConfig);
        console.log("✅ Successfully initialized RAG instance");
      } catch (ragError) {
        console.error("❌ Failed to initialize RAG instance:", ragError);
        throw new Error(`RAG initialization error: ${ragError.message}`);
      }

      // Testing Qdrant connection
      if (ragConfig.qdrantConfig.url) {
        try {
          console.log(`Attempting to connect to remote Qdrant at ${ragConfig.qdrantConfig.url}...`);
          const qdrantTestResponse = await fetch(`${ragConfig.qdrantConfig.url}/collections`, {
            method: "GET",
            headers: ragConfig.qdrantConfig.apiKey ? { "api-key": ragConfig.qdrantConfig.apiKey } : {},
            signal: AbortSignal.timeout(5000), // 5 second timeout
          });
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

      console.log(
        `Initializing RAG with Qdrant at ${ragConfig.qdrantConfig.url}...`
      );

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
      this.RAGInstance = null;
    }
  }

  getRAGInstance() {
    return this.RAGInstance;
  }

  async addDocumentToRAG(content, metadata = {}) {

    if (!this.RAGInstance) {
      throw new Error("RAG instance is not initialized");
    }

    console.log("=== ADDING DOCUMENT TO SERVER-SIDE RAG ===");
    console.log("Content length:", content.length);
    console.log("Metadata:", metadata);

    // Add content to RAG
    const chunkIds = await this.RAGInstance.addDocument(content, {
      ...metadata,
      timestamp: new Date().toISOString(),
    });

    console.log(`✅ Added ${chunkIds.length} chunks to RAG`);
    return chunkIds;
  }

  async deleteDocumentFromRAG(sourceId) {

    if (!this.RAGInstance) {
      throw new Error("RAG instance is not initialized");
    }

    console.log("=== DELETING DOCUMENT FROM SERVER-SIDE RAG ===");
    console.log("Source ID:", sourceId);

    // Delete documents matching the sourceId in metadata
    await this.RAGInstance.deleteDocumentsByMetadata({
      sourceId: sourceId,
    });

    console.log(`✅ Document with sourceId ${sourceId} deleted successfully`);
  }

  async getLearningObjectiveRagContent(objectiveId, query) {
    if (!this.RAGInstance) {
      throw new Error("RAG instance is not initialized");
    }

    if (!query) {
      throw new Error("Query parameter is required");
    }

    const objective = await getObjectiveWithMaterials(objectiveId);
    if (!objective) {
      throw new Error(`Objective with ID ${objectiveId} not found`);
    }

    // Use provided query for RAG search
    let ragChunks = await this.RAGInstance.retrieveContext(query, {
      limit: 50,
    });

    // Get materials source IDs, filter out chunks that are not in the materials
    const materialsSourceIds = objective.materials.map((material) => material.sourceId);
    ragChunks = ragChunks.filter((chunk) => materialsSourceIds.includes(chunk.metadata.sourceId));

    console.log("RAG context:", ragChunks);

    if (ragChunks && ragChunks.length > 0) {
      const ragChunksCount = ragChunks.length;
      console.log(`✅ Found ${ragChunksCount} relevant chunks from RAG`);
      const ragContext = ragChunks.map((chunk) => chunk.content).join("\n\n");
      console.log("RAG context length:", ragContext.length);
      return ragContext;
    } else {
      console.log(
        "⚠️ No relevant chunks found in RAG, using provided content"
      );
      return '';
    }
  }

  /**
   * Get RAG content from multiple materials by sourceIds
   * @param {Array<string>} sourceIds - Array of material sourceIds
   * @param {string} query - Query string for RAG search
   * @param {number} limit - Maximum number of chunks to retrieve (default: 100)
   * @returns {Promise<string>} Combined RAG context from all materials
   */
  async getRagContentFromMaterials(sourceIds, query = "course content", limit = 100) {
    if (!this.RAGInstance) {
      throw new Error("RAG instance is not initialized");
    }

    if (!sourceIds || sourceIds.length === 0) {
      throw new Error("At least one sourceId is required");
    }

    // Use provided query for RAG search
    let ragChunks = await this.RAGInstance.retrieveContext(query, {
      limit: limit,
    });

    // Filter chunks to only include those from the specified materials
    ragChunks = ragChunks.filter((chunk) => {
      const chunkSourceId = chunk.metadata?.sourceId;
      return chunkSourceId && sourceIds.includes(chunkSourceId);
    });

    console.log(`✅ Found ${ragChunks.length} relevant chunks from ${sourceIds.length} materials`);

    if (ragChunks && ragChunks.length > 0) {
      const ragContext = ragChunks.map((chunk) => chunk.content).join("\n\n");
      console.log("RAG context length:", ragContext.length);
      return ragContext;
    } else {
      console.log("⚠️ No relevant chunks found in RAG for selected materials");
      return '';
    }
  }
}

// Export singleton instance
const ragService = new RAGService();

module.exports = ragService;

