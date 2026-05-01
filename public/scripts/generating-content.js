// Generating Content Module
// Handles RAG-based content processing and summary generation

// RAG Module Integration
// Content Processing Class
class ContentGenerator {
  constructor() {
    this.pdfService = new PDFParsingService();
  }

  async addDocumentToKnowledgeBase(content, metadata = {}) {
    // Use server-side RAG processing
    try {
      console.log("=== ADDING DOCUMENT TO SERVER-SIDE RAG ===");
      console.log("Content length:", content.length);
      console.log("Metadata:", metadata);

      const response = await fetch("/api/rag-llm/add-document", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: content,
          metadata: metadata,
          courseId: metadata.courseId || null,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();
      console.log("✅ Document added to server-side RAG:", data);
      return data;
    } catch (error) {
      console.error("❌ Failed to add document to server-side RAG:", error);

      console.warn("No RAG system available");
      return [];
    }
  }

  async searchKnowledgeBase(query, limit = 5, courseId = null) {
    // Use server-side RAG search
    try {
      console.log("=== SEARCHING SERVER-SIDE RAG ===");
      console.log("Query:", query);
      console.log("Limit:", limit);

      const response = await fetch("/api/rag-llm/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: query,
          limit: limit,
          courseId: courseId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();
      console.log(
        "✅ Server-side RAG search results:",
        data.results?.length || 0
      );
      return data.results || [];
    } catch (error) {
      console.error("❌ Failed to search server-side RAG:", error);

      console.warn("No RAG system available for search");
      return [];
    }
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
          file.name.toLowerCase().endsWith(".pdf")
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
        } else if (
          file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          file.name.toLowerCase().endsWith(".docx")
        ) {
          // Use Mammoth.js for DOCX parsing
          try {
            if (typeof window !== "undefined" && window.mammoth) {
              const arrayBuffer = await file.arrayBuffer();
              const result = await window.mammoth.extractRawText({ arrayBuffer: arrayBuffer });
              console.log(`DOCX content extracted: ${result.value.length} characters`);
              if (result.messages && result.messages.length > 0) {
                console.warn("DOCX parsing warnings:", result.messages);
              }
              if (result.value && result.value.length > 0) {
                resolve(result.value);
              } else {
                throw new Error("No content extracted from DOCX file");
              }
            } else {
              throw new Error("Mammoth.js library not available. Please ensure mammoth.js is loaded.");
            }
          } catch (error) {
            console.error("DOCX parsing failed:", error);
            resolve(
              `DOCX file: ${file.name}\nError: ${error.message}\n\nNote: DOCX content could not be extracted.`
            );
          }
        } else if (
          file.type === "application/msword" ||
          file.name.toLowerCase().endsWith(".doc")
        ) {
          // DOC files (older format) - limited browser support
          resolve(
            `DOC file: ${file.name}\n\nNote: DOC files (older Word format) have limited browser support. Please convert to DOCX format for better compatibility.`
          );
        } else {
          resolve(`File: ${file.name} (${file.type})`);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  async processFileForRAG(file, course, sourceId = null) {
    console.log("Processing file for RAG:", file, course, sourceId);
    try {
      const content = await this.extractTextFromFile(file);

      if (content) {
        return await this.addDocumentToKnowledgeBase(content, {
          course: course.name,
          courseId: course.id || course._id,
          sourceId: sourceId,
        });
      }
    } catch (error) {
      console.error("Error processing file for RAG:", error);
      return `File: ${file.name} (content could not be extracted)`;
    }
  }

  async processUrlForRAG(url, course, sourceId = null, documentTitle = null) {
    try {
      console.log("=== PROCESSING URL FOR RAG ===");
      console.log("URL:", url);

      // Fetch and extract content from URL via server-side proxy (to bypass CORS)
      let content = `URL: ${url}`;

      try {
        // Use server-side endpoint to fetch URL content (bypasses CORS)
        const response = await fetch("/api/material/fetch-url-content", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: url }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.content && data.content.length > 0) {
            content = data.content;
            console.log(`✅ Fetched and cleaned ${data.content.length} characters from URL`);
          } else {
            console.warn("No content extracted from URL, using URL string");
          }
        } else {
          const errorData = await response.json().catch(() => ({}));
          console.warn(`Failed to fetch URL content: ${response.status}`, errorData.error || "");
        }
      } catch (fetchError) {
        // Network or other errors - use URL as fallback
        console.warn("Could not fetch URL content:", fetchError.message);
        console.log("Using URL string as content");
      }

      // Add cleaned content to knowledge base
      await this.addDocumentToKnowledgeBase(content, {
        source: url,
        type: "url",
        course: course.name,
        courseId: course.id || course._id,
        sourceId: sourceId,
        documentTitle: documentTitle || "",
      });

      return content;
    } catch (error) {
      console.error("Error processing URL for RAG:", error);
      throw error;
    }
  }

  async processTextForRAG(text, course, sourceId = null, documentTitle = null) {
    try {
      return await this.addDocumentToKnowledgeBase(text, {
        source: "",
        type: "text",
        course: course.name,
        courseId: course.id || course._id,
        sourceId: sourceId,
        documentTitle: documentTitle || "",
      });
    } catch (error) {
      console.error("Error processing text for RAG:", error);
    }
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
