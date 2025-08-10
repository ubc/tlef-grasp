const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const router = express.Router();

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

    res.json({
      success: true,
      message: "Text content received successfully",
      data: textData,
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

module.exports = router;
