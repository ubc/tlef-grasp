// RAG Service - Singleton pattern
// Handles all RAG initialization and provides helper functions
const { getObjectiveWithMaterials } = require('./objective');
const { getLLMProvider, getEmbeddingModel, getQdrantVectorSize } = require('../utils/llm-provider');
const {
  retrieveChunksPerMaterial,
  formatChunksByMaterial,
} = require('./rag-fanout');

/** Qdrant collection vector size; must match the embedding model output. */
function resolveQdrantVectorSize() {
  return getQdrantVectorSize();
}

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

      const llmProvider = getLLMProvider();
      const embeddingModel = getEmbeddingModel();
      const embeddingLlmConfig =
        llmProvider === 'openai'
          ? {
            provider: 'openai',
            defaultModel: embeddingModel,
            apiKey: process.env.OPENAI_API_KEY,
          }
          : {
            provider: 'ollama',
            endpoint:
              process.env.OLLAMA_ENDPOINT || 'http://localhost:11434',
            defaultModel: embeddingModel,
          };

      this.baseConfig = {
        provider: "qdrant",
        qdrantConfig: {
          url: process.env.QDRANT_URL || "http://localhost:6333",
          vectorSize: resolveQdrantVectorSize(),
          distanceMetric: 'Cosine',
          apiKey: process.env.QDRANT_API_KEY
        },
        embeddingsConfig: {
          providerType: process.env.EMBEDDING_PROVIDER,
          model: embeddingModel,
          llmConfig: embeddingLlmConfig,
        }
      };

      console.log("✅ RAG Base initialized");
    } catch (err) {
      console.error("❌ Failed to initialize RAG Base:", err);
      throw err;
    }
  }

  /**
   * Standardize collection name for a course.
   * Includes vector size so changing the embedding dimension (or switching
   * stage) uses a new Qdrant collection — Qdrant cannot alter vector dimension
   * on an existing collection.
   *
   * OpenAI keeps the original, unsuffixed name (`grasp_course_<id>`) for
   * backward compatibility with collections created before the vector-size
   * suffix was introduced.
   */
  getCollectionName(courseId) {
    if (!courseId) return process.env.QDRANT_COLLECTION_NAME || "question-generation-collection";
    // Normalize string ID
    const cid = typeof courseId === 'string' ? courseId : courseId.toString();

    if (getLLMProvider() === 'openai') {
      return `grasp_course_${cid}`;
    }

    const dim = resolveQdrantVectorSize();
    return `grasp_course_${cid}_v${dim}`;
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
        const overlap = 150;

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

  async getLearningObjectiveRagContent(objectiveId, query, courseId = null, scoreThreshold = undefined, limit = 20) {
    const instance = await this.getOrCreateInstance(courseId);
    if (!instance) {
      throw new Error("RAG instance is not initialized for this course");
    }

    if (!query) {
      throw new Error("Query parameter is required");
    }

    const objective = await getObjectiveWithMaterials(objectiveId);

    if (!objective) {
      throw new Error(`Objective with ID ${objectiveId} not found`);
    }

    const sourceIds = objective.materials.map((material) => material.sourceId);
    if (sourceIds.length === 0) {
      console.log("⚠️ Objective has no attached materials");
      return '';
    }

    // One search per material, each guaranteed a share of `limit`, so a dense
    // material cannot crowd out the others.
    const chunks = await retrieveChunksPerMaterial(instance, sourceIds, query, {
      totalLimit: limit,
      scoreThreshold,
    });

    // Plain join, no per-material headers: the question-generation prompt has
    // always received context in this shape.
    return chunks.map((chunk) => chunk.content).join("\n\n");
  }

  /**
   * Get RAG content from multiple materials by sourceIds, grouped by material.
   * @param {Array<string>} sourceIds - Array of material sourceIds
   * @param {string} query - Query string for RAG search
   * @param {number} limit - Total chunk budget, split across the materials
   * @returns {Promise<string>} Combined RAG context, grouped per material
   */
  async getRagContentFromMaterials(sourceIds, query = "course content", limit = 50, courseId = null, scoreThreshold = undefined) {
    const instance = await this.getOrCreateInstance(courseId);
    if (!instance) {
      throw new Error("RAG instance is not initialized for this course");
    }

    if (!sourceIds || sourceIds.length === 0) {
      throw new Error("At least one sourceId is required");
    }

    const chunks = await retrieveChunksPerMaterial(instance, sourceIds, query, {
      totalLimit: limit,
      scoreThreshold,
    });

    return formatChunksByMaterial(chunks);
  }
}

// Export singleton instance
const ragService = new RAGService();

module.exports = ragService;

