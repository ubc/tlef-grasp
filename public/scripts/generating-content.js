// Generating Content Module
// Handles RAG-based content processing and summary generation

// RAG Module Integration
// Content Processing Class
class ContentGenerator {
  constructor() {
    // PDF parsing is now handled by the backend
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

// Export for use in other files
window.ContentGenerator = ContentGenerator;
