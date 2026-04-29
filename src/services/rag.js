// RAG Service - Singleton pattern
// Handles all RAG initialization and provides helper functions
const { getObjectiveWithMaterials } = require('./objective');

class RAGService {
  constructor() {
    if (RAGService.instance) {
      return RAGService.instance;
    }

    // Import UBC GenAI Toolkit (server-side)
    // Map of collectionName -> RAGInstance
    this.instances = new Map();
    this.RAGModule = null;
    this.ConsoleLogger = null;
    
    // Config templates
    this.baseConfig = null;
    
    // Global initialization (loading modules)
    this.initializationPromise = this.initializeBase();

    RAGService.instance = this;
  }

  async initializeBase() {
    try {
      console.log("Loading UBC GenAI Toolkit modules...");
      const ragModule = await import("ubc-genai-toolkit-rag");
      const coreModule = await import("ubc-genai-toolkit-core");

      this.RAGModule = ragModule.RAGModule || ragModule.default?.RAGModule || ragModule.default;
      this.ConsoleLogger = coreModule.ConsoleLogger || coreModule.default?.ConsoleLogger || coreModule.default;

      if (!this.RAGModule || !this.ConsoleLogger) {
        throw new Error("Failed to load RAGModule or ConsoleLogger");
      }

      this.baseConfig = {
        provider: "qdrant",
        qdrantConfig: {
          url: process.env.QDRANT_URL || "http://localhost:6333",
          vectorSize: parseInt(process.env.QDRANT_VECTOR_SIZE) || 768,
          distanceMetric: 'Cosine',
          apiKey: process.env.QDRANT_API_KEY
        },
        embeddingsConfig: {
          providerType: process.env.EMBEDDING_PROVIDER,
          model: process.env.LLM_EMBEDDING_MODEL,
          llmConfig: {
            provider: process.env.LLM_PROVIDER,
            defaultModel: process.env.OPENAI_MODEL,
            apiKey: process.env.OPENAI_API_KEY
          },
        }
      };
      
      console.log("✅ RAG Base initialized");
    } catch (err) {
      console.error("❌ Failed to initialize RAG Base:", err);
      throw err;
    }
  }

  /**
   * Standardize collection name for a course
   */
  getCollectionName(courseId) {
    if (!courseId) return process.env.QDRANT_COLLECTION_NAME || "question-generation-collection";
    // Normalize string ID
    const cid = typeof courseId === 'string' ? courseId : courseId.toString();
    return `grasp_course_${cid}`;
  }

  async getOrCreateInstance(courseId) {
    await this.initializationPromise;
    
    const collectionName = this.getCollectionName(courseId);
    
    if (this.instances.has(collectionName)) {
      return this.instances.get(collectionName);
    }

    console.log(`Creating RAG instance for collection: ${collectionName}`);
    
    const ragConfig = {
      ...this.baseConfig,
      qdrantConfig: {
        ...this.baseConfig.qdrantConfig,
        collectionName: collectionName
      },
      chunkingConfig: (content) => {
        const chunks = [];
        const chunkSize = 1000;
        const overlap = 200;
        
        let i = 0;
        while (i < content.length) {
          const end = Math.min(i + chunkSize, content.length);
          chunks.push(content.substring(i, end));
          if (end === content.length) break;
          i += chunkSize - overlap;
        }
        return chunks;
      },
      logger: new this.ConsoleLogger(`RAG-${collectionName}`)
    };

    try {
      const instance = await this.RAGModule.create(ragConfig);
      this.instances.set(collectionName, instance);
      console.log(`✅ initialized RAG instance for ${collectionName}`);
      return instance;
    } catch (err) {
      console.error(`❌ Failed to create RAG instance for ${collectionName}:`, err);
      // If course-specific fails, we might still want to return null and let the caller handle it
      return null;
    }
  }

  // Compatibility getter for existing code that expects a single instance
  getRAGInstance() {
    // Return the default collection's instance if it exists, or create it
    const defaultCollection = process.env.QDRANT_COLLECTION_NAME || "question-generation-collection";
    if (this.instances.has(defaultCollection)) {
      return this.instances.get(defaultCollection);
    }
    // Note: this is async-ish because of initializationPromise, but if called early it might be null
    // Ideally we should move away from this getter
    return this.instances.values().next().value || null;
  }

  async addDocumentToRAG(content, metadata = {}, courseId = null) {
    const instance = await this.getOrCreateInstance(courseId);
    if (!instance) {
      throw new Error("RAG instance is not initialized for this course");
    }

    console.log("=== ADDING DOCUMENT TO SERVER-SIDE RAG ===");
    console.log("Content length:", content.length);
    console.log("Metadata:", metadata);

    // Sanitize content to remove all surrogate characters.
    // This prevents the RAG chunker from slicing surrogate pairs in half and crashing Qdrant.
    const sanitizeText = (str) => {
      if (typeof str !== 'string') return str;
      return str.replace(/[\uD800-\uDFFF]/g, '');
    };

    const sanitizedContent = sanitizeText(content);

    // Add content to RAG
    const chunkIds = await instance.addDocument(sanitizedContent, {
      ...metadata,
      timestamp: new Date().toISOString(),
    });

    console.log(`✅ Added ${chunkIds.length} chunks to RAG`);
    return chunkIds;
  }

  async deleteDocumentFromRAG(sourceId, courseId = null) {
    const instance = await this.getOrCreateInstance(courseId);
    if (!instance) {
      throw new Error("RAG instance is not initialized for this course");
    }

    console.log("=== DELETING DOCUMENT FROM SERVER-SIDE RAG ===");
    console.log("Source ID:", sourceId);

    // Delete documents matching the sourceId in metadata
    await instance.deleteDocumentsByMetadata({
      sourceId: sourceId,
    });

    console.log(`✅ Document with sourceId ${sourceId} deleted successfully`);
  }

  async getLearningObjectiveRagContent(objectiveId, query, courseId = null) {
    const instance = await this.getOrCreateInstance(courseId);
    if (!instance) {
      throw new Error("RAG instance is not initialized for this course");
    }

    if (!query) {
      throw new Error("Query parameter is required");
    }

    const objective = await getObjectiveWithMaterials(objectiveId);
    console.log("Objective:", objective);
    if (!objective) {
      throw new Error(`Objective with ID ${objectiveId} not found`);
    }

    // Use provided query for RAG search
    let ragChunks = await instance.retrieveContext(query, {
      limit: 50,
      filter: {
        must: [
          {
            key: "sourceId",
            match: {
              any: objective.materials.map((material) => material.sourceId)
            }
          }
        ]
      }
    });

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
  async getRagContentFromMaterials(sourceIds, query = "course content", limit = 50, courseId = null) {
    const instance = await this.getOrCreateInstance(courseId);
    if (!instance) {
      throw new Error("RAG instance is not initialized for this course");
    }

    if (!sourceIds || sourceIds.length === 0) {
      throw new Error("At least one sourceId is required");
    }

    // Use provided query for RAG search
    let ragChunks = await instance.retrieveContext(query, {
      limit: limit,
      filter: {
        must: [
          {
            key: "sourceId",
            match: {
              any: sourceIds
            }
          }
        ]
      }
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

