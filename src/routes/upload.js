const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const router = express.Router();

// Import Qdrant patch to fix Float32Array issue
require("../utils/qdrant-patch");

// Import UBC GenAI Toolkit for document processing
let RAGModule = null;
let ChunkingModule = null;

// Initialize UBC toolkit for document processing
async function initializeDocumentProcessing() {
  try {
    console.log("Initializing document processing modules...");

    const ragModule = await import("ubc-genai-toolkit-rag");
    const chunkingModule = await import("ubc-genai-toolkit-chunking");

    RAGModule =
      ragModule.RAGModule || ragModule.default?.RAGModule || ragModule.default;
    ChunkingModule =
      chunkingModule.ChunkingModule ||
      chunkingModule.default?.ChunkingModule ||
      chunkingModule.default;

    console.log("✅ Document processing modules initialized");
    return true;
  } catch (error) {
    console.error("❌ Failed to initialize document processing:", error);
    return false;
  }
}

// Initialize on startup
initializeDocumentProcessing();

// Function to process and store document content in RAG
async function processAndStoreDocument(content, metadata) {
  try {
    if (!RAGModule) {
      console.log("⚠️ RAG module not available, skipping document storage");
      return { success: false, reason: "RAG module not initialized" };
    }

    console.log("=== PROCESSING DOCUMENT FOR RAG STORAGE ===");
    console.log("Content length:", content.length);
    console.log("Metadata:", metadata);

    // Initialize RAG module
    const ragModule = await RAGModule.create(RAG_CONFIG);

    // Add document to RAG with metadata
    const chunkIds = await ragModule.addDocument(content, {
      ...metadata,
      timestamp: new Date().toISOString(),
      processed: true,
    });

    console.log(
      `✅ Document processed and stored with ${chunkIds.length} chunks`
    );

    return {
      success: true,
      chunkIds: chunkIds,
      chunksCount: chunkIds.length,
    };
  } catch (error) {
    console.error("❌ Failed to process document for RAG:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// RAG Configuration for document storage
const RAG_CONFIG = {
  provider: "qdrant",
  qdrantConfig: {
    url: "http://localhost:6333",
    collectionName: "question-generation-collection",
    vectorSize: 384,
    distanceMetric: "Cosine",
  },
  embeddingsConfig: {
    providerType: "fastembed",
    fastembedConfig: {
      model: "fast-bge-small-en-v1.5",
    },
  },
  chunkingConfig: {
    strategy: "simple",
    chunkSize: 1000, // Increased from default 300 to 1000 characters
    overlap: 100, // Increased from default 50 to 100 characters
  },
  debug: true,
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "../../uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    // Allow PDF, text, and image files
    const allowedTypes = [
      "application/pdf",
      "text/plain",
      "text/markdown",
      "image/jpeg",
      "image/png",
      "image/gif",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only PDF, text, and image files are allowed."
        ),
        false
      );
    }
  },
});

// Handle file upload
router.post("/files", upload.array("files", 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const uploadedFiles = req.files.map((file) => ({
      filename: file.filename,
      originalName: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      path: file.path,
    }));

    // Store file information in session or database
    if (req.session) {
      req.session.uploadedFiles = uploadedFiles;
    }

    res.json({
      success: true,
      message: `${uploadedFiles.length} file(s) uploaded successfully`,
      files: uploadedFiles,
    });
  } catch (error) {
    console.error("File upload error:", error);
    res.status(500).json({ error: "File upload failed" });
  }
});

// Handle text input
router.post("/text", express.json(), async (req, res) => {
  try {
    const { text, course, title } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Text content is required" });
    }

    // Store text content for processing
    const textData = {
      content: text,
      course: course || "General",
      title: title || "Untitled",
      timestamp: new Date().toISOString(),
    };

    if (req.session) {
      req.session.textContent = textData;
    }

    // Process and store in RAG
    console.log("=== PROCESSING TEXT FOR RAG STORAGE ===");
    const ragResult = await processAndStoreDocument(text, {
      course: course || "General",
      title: title || "Untitled",
      type: "text",
      source: "manual_input",
    });

    res.json({
      success: true,
      message: "Text content received and processed successfully",
      data: textData,
      ragProcessing: ragResult,
    });
  } catch (error) {
    console.error("Text processing error:", error);
    res.status(500).json({ error: "Text processing failed" });
  }
});

// Handle URL input
router.post("/url", express.json(), async (req, res) => {
  try {
    const { url, course, title } = req.body;

    if (!url || !url.trim()) {
      return res.status(400).json({ error: "URL is required" });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    const urlData = {
      url: url,
      course: course || "General",
      title: title || "Untitled",
      timestamp: new Date().toISOString(),
    };

    if (req.session) {
      req.session.urlContent = urlData;
    }

    res.json({
      success: true,
      message: "URL received successfully",
      data: urlData,
    });
  } catch (error) {
    console.error("URL processing error:", error);
    res.status(500).json({ error: "URL processing failed" });
  }
});

// Get uploaded files info
router.get("/files", (req, res) => {
  try {
    const files = req.session?.uploadedFiles || [];
    res.json({ files });
  } catch (error) {
    console.error("Error getting files:", error);
    res.status(500).json({ error: "Failed to retrieve files" });
  }
});

// Add document directly to RAG
router.post("/add-to-rag", express.json(), async (req, res) => {
  try {
    const { content, course, title, type } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: "Content is required" });
    }

    console.log("=== ADDING DOCUMENT TO RAG ===");
    const ragResult = await processAndStoreDocument(content, {
      course: course || "General",
      title: title || "Untitled",
      type: type || "manual",
      source: "api_add",
    });

    res.json({
      success: true,
      message: "Document added to RAG successfully",
      ragProcessing: ragResult,
    });
  } catch (error) {
    console.error("Error adding document to RAG:", error);
    res.status(500).json({ error: "Failed to add document to RAG" });
  }
});

// Check RAG collection status
router.get("/rag-status", async (req, res) => {
  try {
    // Check Qdrant collection status
    const response = await fetch(
      "http://localhost:6333/collections/question-generation-collection"
    );
    const collectionData = await response.json();

    res.json({
      success: true,
      collection: collectionData.result,
      ragModuleAvailable: RAGModule !== null,
      chunkingModuleAvailable: ChunkingModule !== null,
    });
  } catch (error) {
    console.error("Error checking RAG status:", error);
    res.status(500).json({
      error: "Failed to check RAG status",
      details: error.message,
    });
  }
});

module.exports = router;
