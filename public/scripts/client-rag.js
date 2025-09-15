// Client-Side RAG Implementation
// Browser-compatible RAG system using Web APIs

class ClientRAG {
  constructor() {
    this.documents = [];
    this.embeddings = [];
    this.isInitialized = false;
    this.initializeEmbeddings();
  }

  async initializeEmbeddings() {
    try {
      // Use a client-side embedding service or implement simple text similarity
      console.log("Initializing client-side RAG system...");
      this.isInitialized = true;
      console.log("Client RAG initialized successfully");
    } catch (error) {
      console.error("Failed to initialize client RAG:", error);
      this.isInitialized = false;
    }
  }

  // Add document to knowledge base
  async addDocument(content, metadata = {}) {
    try {
      const document = {
        id: Date.now() + Math.random(),
        content: content,
        metadata: metadata,
        timestamp: new Date().toISOString(),
      };

      this.documents.push(document);

      // Create simple text-based embedding (word frequency vector)
      const embedding = this.createTextEmbedding(content);
      this.embeddings.push({
        id: document.id,
        embedding: embedding,
        content: content,
      });

      console.log(`Document added to client RAG: ${document.id}`);
      return [document.id];
    } catch (error) {
      console.error("Failed to add document:", error);
      throw error;
    }
  }

  // Create simple text embedding using word frequency
  createTextEmbedding(text) {
    // Simple word frequency-based embedding
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2);

    const wordFreq = {};
    words.forEach((word) => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });

    return wordFreq;
  }

  // Calculate similarity between two embeddings
  calculateSimilarity(embedding1, embedding2) {
    const words1 = Object.keys(embedding1);
    const words2 = Object.keys(embedding2);
    const allWords = new Set([...words1, ...words2]);

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (const word of allWords) {
      const freq1 = embedding1[word] || 0;
      const freq2 = embedding2[word] || 0;

      dotProduct += freq1 * freq2;
      norm1 += freq1 * freq1;
      norm2 += freq2 * freq2;
    }

    if (norm1 === 0 || norm2 === 0) return 0;

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  // Search for relevant content
  async retrieveContext(query, options = {}) {
    try {
      const limit = options.limit || 5;

      if (this.documents.length === 0) {
        console.log("No documents in knowledge base");
        return [];
      }

      // Create query embedding
      const queryEmbedding = this.createTextEmbedding(query);

      // Calculate similarities
      const similarities = this.embeddings.map((item) => ({
        id: item.id,
        content: item.content,
        similarity: this.calculateSimilarity(queryEmbedding, item.embedding),
      }));

      // Sort by similarity and return top results
      const results = similarities
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit)
        .filter((item) => item.similarity > 0.1) // Only return relevant results
        .map((item) => ({
          content: item.content,
          score: item.similarity,
          metadata:
            this.documents.find((doc) => doc.id === item.id)?.metadata || {},
        }));

      console.log(
        `Client RAG search returned ${results.length} results for query: "${query}"`
      );
      return results;
    } catch (error) {
      console.error("Failed to retrieve context:", error);
      return [];
    }
  }

  // Check if RAG is available
  isRAGAvailable() {
    return this.isInitialized && this.documents.length > 0;
  }

  // Get document count
  getDocumentCount() {
    return this.documents.length;
  }

  // Clear all documents
  clearDocuments() {
    this.documents = [];
    this.embeddings = [];
    console.log("Client RAG documents cleared");
  }
}

// Export for use in other files
window.ClientRAG = ClientRAG;
