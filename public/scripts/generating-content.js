// Generating Content Module
// Handles RAG-based content processing and summary generation

// RAG Module Integration
let ragModule = null;
let clientRAG = null;
const RAG_CONFIG = {
  provider: "qdrant",
  qdrantConfig: {
    url: "http://localhost:6333", // Default Qdrant URL for development
    collectionName: "question-generation-collection",
    vectorSize: 384,
    distanceMetric: "Cosine",
  },
  embeddingsConfig: {
    provider: "fastembed",
    model: "bge-small-en-v1.5",
  },
  debug: true,
};

// Content Processing Class
class ContentGenerator {
  constructor() {
    this.isInitialized = false;
    this.pdfService = new PDFParsingService();
    this.initializeRAG();
    this.initializeClientRAG();
  }

  async initializeRAG() {
    try {
      // Import RAG module dynamically
      const { RAGModule } = await import("ubc-genai-toolkit-rag");

      ragModule = await RAGModule.create(RAG_CONFIG);
      console.log("RAG Module initialized successfully");
      this.isInitialized = true;
      return ragModule;
    } catch (error) {
      console.warn(
        "RAG Module not available (this is expected in development):",
        error.message
      );
      // Continue without RAG if initialization fails
      ragModule = null;
      this.isInitialized = false;
    }
  }

  initializeClientRAG() {
    try {
      if (window.ClientRAG) {
        clientRAG = new window.ClientRAG();
        console.log("Client RAG initialized successfully");
      } else {
        console.warn("ClientRAG class not available");
      }
    } catch (error) {
      console.error("Failed to initialize client RAG:", error);
    }
  }

  async addDocumentToKnowledgeBase(content, metadata = {}) {
    // Try server RAG first
    if (ragModule) {
      try {
        const chunkIds = await ragModule.addDocument(content, metadata);
        console.log(
          `Document added to server RAG with ${chunkIds.length} chunks`
        );
        return chunkIds;
      } catch (error) {
        console.error("Failed to add document to server RAG:", error);
      }
    }

    // Fallback to client RAG
    if (clientRAG) {
      try {
        const chunkIds = await clientRAG.addDocument(content, metadata);
        console.log(
          `Document added to client RAG with ${chunkIds.length} chunks`
        );
        return chunkIds;
      } catch (error) {
        console.error("Failed to add document to client RAG:", error);
        throw error;
      }
    }

    console.warn("No RAG system available");
    return [];
  }

  async searchKnowledgeBase(query, limit = 5) {
    // Try server RAG first
    if (ragModule) {
      try {
        const results = await ragModule.retrieveContext(query, { limit });
        console.log(`Server RAG search returned ${results.length} results`);
        return results;
      } catch (error) {
        console.error("Failed to search server RAG:", error);
      }
    }

    // Fallback to client RAG
    if (clientRAG) {
      try {
        const results = await clientRAG.retrieveContext(query, { limit });
        console.log(`Client RAG search returned ${results.length} results`);
        return results;
      } catch (error) {
        console.error("Failed to search client RAG:", error);
        return [];
      }
    }

    console.warn("No RAG system available for search");
    return [];
  }

  async processUploadedContent(files, urls, course) {
    console.log("=== PROCESSING UPLOADED CONTENT ===");
    console.log("Files to process:", files.length);
    console.log("URLs to process:", urls.length);
    console.log("RAG available:", this.isRAGAvailable());

    try {
      // Process uploaded files
      for (const file of files) {
        if (file.content) {
          console.log(
            `Adding file to RAG: ${file.name} (${file.content.length} chars)`
          );
          await this.addDocumentToKnowledgeBase(file.content, {
            source: file.name,
            type: "file",
            course: course,
          });
        } else {
          console.log(`Skipping file (no content): ${file.name}`);
        }
      }

      // Process URLs
      for (const url of urls) {
        console.log(`Adding URL to RAG: ${url.url}`);
        await this.addDocumentToKnowledgeBase(`URL: ${url.url}`, {
          source: url.url,
          type: "url",
          course: course,
        });
      }

      console.log("All uploaded content processed and added to knowledge base");
    } catch (error) {
      console.error("Error processing uploaded content:", error);
    }
  }

  async generateContentSummary(course, files, urls) {
    try {
      console.log("=== GENERATING CONTENT SUMMARY ===");
      console.log("Course:", course);
      console.log("Files:", files.length);
      console.log("URLs:", urls.length);

      // First, ensure all uploaded content is processed
      await this.processUploadedContent(files, urls, course);

      // Generate summary using RAG (server or client)
      if (this.isRAGAvailable()) {
        console.log("RAG is available, generating RAG-enhanced summary");

        // Search for relevant content to create a comprehensive summary
        const summaryQuery = `Summarize the main topics and key concepts covered in the uploaded materials for ${course}`;
        console.log("Summary query:", summaryQuery);

        const relevantChunks = await this.searchKnowledgeBase(summaryQuery, 10);
        console.log("Relevant chunks found:", relevantChunks.length);

        if (relevantChunks.length > 0) {
          // Combine relevant chunks to create a comprehensive summary
          const combinedContent = relevantChunks
            .map((chunk) => chunk.content)
            .join("\n\n");

          console.log("Combined content length:", combinedContent.length);
          // Generate RAG-enhanced summary locally
          return this.generateRAGSummary(course, combinedContent);
        } else {
          console.log("No RAG chunks found, using fallback summary");
          // Fallback to basic content preparation if no RAG results
          return this.generateFallbackSummary(course, files, urls);
        }
      } else {
        console.log("RAG not available, using fallback summary");
        // Fallback when RAG is not available
        return this.generateFallbackSummary(course, files, urls);
      }
    } catch (error) {
      console.error("Summary generation failed:", error);
      // Always fall back to local summary generation
      return this.generateFallbackSummary(course, files, urls);
    }
  }

  prepareContentForSummary(files, urls) {
    let content = "";

    // Add file contents
    files.forEach((file) => {
      if (file.content) {
        content += file.content + "\n\n";
      }
    });

    // Add URLs
    urls.forEach((url) => {
      content += `URL: ${url.url}\n\n`;
    });

    return content;
  }

  async extractTextFromFile(file) {
    return new Promise(async (resolve, reject) => {
      try {
        if (file.type === "text/plain" || file.name.endsWith(".txt")) {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = (e) => reject(e);
          reader.readAsText(file);
        } else if (
          file.type === "application/pdf" ||
          file.name.endsWith(".pdf")
        ) {
          // Use PDF parsing service
          try {
            const pdfText = await this.pdfService.parsePDFToText(file);
            resolve(pdfText);
          } catch (error) {
            console.error("PDF parsing failed:", error);
            resolve(
              `PDF file: ${file.name}\nError: ${error.message}\n\nNote: PDF content could not be extracted.`
            );
          }
        } else {
          resolve(`File: ${file.name} (${file.type})`);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  async processFileForRAG(file, course) {
    try {
      const content = await this.extractTextFromFile(file);

      if (content) {
        await this.addDocumentToKnowledgeBase(content, {
          source: file.name,
          type: "file",
          course: course,
        });
        return content;
      }
    } catch (error) {
      console.error("Error processing file for RAG:", error);
      return `File: ${file.name} (content could not be extracted)`;
    }
  }

  async processUrlForRAG(url, course) {
    try {
      await this.addDocumentToKnowledgeBase(`URL: ${url}`, {
        source: url,
        type: "url",
        course: course,
      });
    } catch (error) {
      console.error("Error processing URL for RAG:", error);
    }
  }

  async processTextForRAG(text, course) {
    try {
      await this.addDocumentToKnowledgeBase(text, {
        source: "Text Content",
        type: "text",
        course: course,
      });
    } catch (error) {
      console.error("Error processing text for RAG:", error);
    }
  }

  // Get RAG-enhanced content for specific queries
  async getRelevantContent(query, limit = 5) {
    if (!ragModule) {
      return [];
    }

    try {
      const results = await this.searchKnowledgeBase(query, limit);
      return results.map((chunk) => ({
        content: chunk.content,
        score: chunk.score,
        metadata: chunk.metadata,
      }));
    } catch (error) {
      console.error("Error getting relevant content:", error);
      return [];
    }
  }

  // Check if RAG is available
  isRAGAvailable() {
    return (
      (this.isInitialized && ragModule !== null) ||
      (clientRAG && clientRAG.isRAGAvailable())
    );
  }

  // Main summary generation method
  async generateSummary(course, files = [], urls = []) {
    console.log("ContentGenerator.generateSummary called with:", {
      course,
      files,
      urls,
    });

    try {
      // Generate summary using RAG-enhanced content
      const summary = await this.generateContentSummary(course, files, urls);
      console.log("RAG summary generated:", summary);
      return summary;
    } catch (error) {
      console.error("Summary generation failed:", error);
      // Fallback to content-based summary
      const fallbackSummary = this.generateFallbackSummary(course, files, urls);
      console.log("Fallback summary generated:", fallbackSummary);
      return fallbackSummary;
    }
  }

  generateRAGSummary(course, combinedContent) {
    return `RAG-Enhanced Summary for ${course}:\n\nBased on the analyzed content from uploaded materials:\n\n${combinedContent}\n\nThis content has been processed using RAG (Retrieval-Augmented Generation) to identify key concepts and learning objectives suitable for question generation.`;
  }

  generateFallbackSummary(course, files, urls) {
    let summary = `Content Summary for ${course}\n\n`;

    if (files.length > 0) {
      summary += `Uploaded Files (${files.length}):\n`;
      files.forEach((file) => {
        summary += `• ${file.name} (${file.type})\n`;
        if (file.content && file.content.length > 0) {
          // Show full content for complete summary
          summary += `  Full Content:\n  ${file.content}\n\n`;
        }
      });
    }

    if (urls.length > 0) {
      summary += `Referenced URLs (${urls.length}):\n`;
      urls.forEach((url) => {
        summary += `• ${url.url}\n`;
      });
      summary += `\n`;
    }

    if (files.length === 0 && urls.length === 0) {
      summary += `No materials have been uploaded yet. Please upload files or add URLs to generate a meaningful summary.`;
    } else {
      summary += `This content has been processed and is ready for objective creation and question generation. The uploaded materials contain relevant information that can be used to create targeted educational questions.`;
    }

    return summary;
  }
}

// PDF Parsing Service
class PDFParsingService {
  constructor() {
    this.isInitialized = false;
    this.initializePDFJS();
  }

  async initializePDFJS() {
    try {
      // Configure PDF.js worker
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        this.isInitialized = true;
        console.log("PDF.js initialized successfully");
      } else {
        console.warn("PDF.js library not loaded");
      }
    } catch (error) {
      console.error("Failed to initialize PDF.js:", error);
    }
  }

  async parsePDF(file) {
    if (!this.isInitialized || !window.pdfjsLib) {
      throw new Error("PDF.js not initialized");
    }

    try {
      console.log("Parsing PDF:", file.name);

      // Convert file to ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();

      // Load PDF document
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer })
        .promise;

      let fullText = "";
      const numPages = pdf.numPages;

      console.log(`PDF has ${numPages} pages`);

      // Extract text from each page
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();

        // Combine text items and clean up formatting
        const pageText = textContent.items
          .map((item) => item.str)
          .join(" ")
          .replace(/\s+/g, " ") // Replace multiple spaces with single space
          .replace(/\n\s*\n/g, "\n") // Remove empty lines
          .trim();

        if (pageText) {
          fullText += `Page ${pageNum}:\n${pageText}\n\n`;
        }
      }

      console.log(`Extracted ${fullText.length} characters from PDF`);

      return {
        success: true,
        text: fullText.trim(),
        pageCount: numPages,
        fileName: file.name,
        fileSize: file.size,
      };
    } catch (error) {
      console.error("Error parsing PDF:", error);
      return {
        success: false,
        error: error.message,
        fileName: file.name,
      };
    }
  }

  async parsePDFToText(file) {
    const result = await this.parsePDF(file);
    if (result.success) {
      return result.text;
    } else {
      throw new Error(`PDF parsing failed: ${result.error}`);
    }
  }
}

// Export for use in other files
window.ContentGenerator = ContentGenerator;
window.PDFParsingService = PDFParsingService;
