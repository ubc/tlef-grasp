const { saveMaterial, getCourseMaterials, getMaterialCourseId, deleteMaterial, getMaterialBySourceId } = require('../services/material');
const { isUserInCourse } = require('../services/user-course');
const { getCourseById } = require('../services/course');
const ragService = require('../services/rag');
const databaseService = require('../services/database');
const { parsePdf } = require('../utils/pdf-parser');
const { parseDocx } = require('../utils/docx-parser');

const saveMaterialHandler = async (req, res) => {
    try {
        const { sourceId, courseId, materialData } = req.body;
        const userId = req.user.id;

        if (!isUserInCourse(userId, courseId)) {
            return res.status(403).json({ error: "User is not in course" });
        }

        await saveMaterial(sourceId, courseId, materialData);
        res.json({ success: true, message: "Material saved successfully" });
    } catch (error) {
        console.error("Error saving material:", error);
        res.status(500).json({ error: "Failed to save material" });
    }
};

const deleteMaterialHandler = async (req, res) => {
    try {
        const { sourceId } = req.params;
        const userId = req.user.id;
        const courseId = await getMaterialCourseId(sourceId);

        if (!courseId) {
            return res.status(404).json({ error: "Course current material attached to not found" });
        }

        if (!isUserInCourse(userId, courseId)) {
            return res.status(403).json({ error: "User is not in course" });
        }

        // Delete from RAG first
        try {
            await ragService.deleteDocumentFromRAG(sourceId, courseId);
        } catch (ragError) {
            console.error("Error deleting from RAG during material deletion:", ragError);
        }

        await deleteMaterial(sourceId);
        res.json({ success: true, message: "Material deleted successfully" });
    } catch (error) {
        console.error("Error deleting material:", error);
        res.status(500).json({ error: "Failed to delete material" });
    }
};

const getCourseMaterialsHandler = async (req, res) => {
    try {
        const { courseId } = req.params;
        const userId = req.user.id;
    
        if (!isUserInCourse(userId, courseId)) {
            return res.status(403).json({ error: "User is not in course" });
        }

        const materials = await getCourseMaterials(courseId);
        res.json({ success: true, materials: materials });
    } catch (error) {
        console.error("Error getting materials:", error);
        res.status(500).json({ error: "Failed to get materials" });
    }
};

const updateMaterialHandler = async (req, res) => {
    try {
        const { sourceId, courseId, documentType, documentData, documentTitle } = req.body;
        const userId = req.user.id;

        if (!sourceId) {
            return res.status(400).json({ error: "sourceId is required" });
        }

        if (!documentType) {
            return res.status(400).json({ error: "documentType is required" });
        }

        if (!documentData) {
            return res.status(400).json({ error: "documentData is required" });
        }

        // Get existing material to verify it exists and get course info
        const existingMaterial = await getMaterialBySourceId(sourceId);
        if (!existingMaterial) {
            return res.status(404).json({ error: "Material not found" });
        }

        const materialCourseId = existingMaterial.courseId || courseId;
        if (!materialCourseId) {
            return res.status(400).json({ error: "Course ID is required" });
        }

        if (!isUserInCourse(userId, materialCourseId)) {
            return res.status(403).json({ error: "User is not in course" });
        }

        // Validate required fields based on document type
        if (documentType === 'link') {
            if (!documentData.url) {
                return res.status(400).json({ error: "documentData.url is required for link type" });
            }
        } else if (documentType === 'text') {
            if (!documentData.textContent) {
                return res.status(400).json({ error: "documentData.textContent is required for text type" });
            }
        } else if (documentType === 'pdf') {
            // PDFs only need documentTitle update, no documentData required
        } else {
            return res.status(400).json({ error: "Invalid documentType. Must be 'link', 'text', or 'pdf'" });
        }

        // Use provided documentTitle or fall back to existing one
        const updatedDocumentTitle = documentTitle !== undefined ? documentTitle : (existingMaterial.documentTitle || "");
        
        // Determine content and metadata based on document type
        let materialContent;
        let materialType;
        let materialSource;
        let url = null; // For links, store the URL here

        if (documentType === 'link') {
            url = documentData.url;
            // For links, automatically fetch content from URL
            materialType = "url";
            materialSource = url;
            
            // Fetch content from URL
            try {
                // Use built-in fetch (Node.js 18+) or node-fetch
                let fetchFn;
                try {
                    fetchFn = globalThis.fetch || fetch;
                    if (!fetchFn) {
                        const nodeFetch = await import("node-fetch");
                        fetchFn = nodeFetch.default;
                    }
                } catch (e) {
                    throw new Error("Fetch is not available. Please use Node.js 18+ or install node-fetch");
                }

                const fetchResponse = await fetchFn(url, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Accept-Language": "en-US,en;q=0.5",
                    },
                });

                if (!fetchResponse.ok) {
                    return res.status(400).json({ 
                        error: "Failed to fetch URL content", 
                        details: `HTTP error! status: ${fetchResponse.status} ${fetchResponse.statusText}`
                    });
                }

                const html = await fetchResponse.text();
                
                // Extract and clean text from HTML using Cheerio
                let cheerio;
                try {
                    cheerio = require("cheerio");
                } catch (e) {
                    return res.status(500).json({ 
                        error: "Failed to parse URL content", 
                        details: "cheerio is required for HTML parsing but is not available" 
                    });
                }
                
                const $ = cheerio.load(html);
                
                // Remove unwanted elements
                const unwantedSelectors = [
                    "script", "style", "nav", "header", "footer", "aside",
                    ".ad", ".ads", ".advertisement", ".sidebar", ".menu",
                    ".navigation", ".nav", ".header", ".footer",
                    "[role='navigation']", "[role='banner']", "[role='complementary']",
                    ".social-share", ".share-buttons", ".comments", ".comment-section",
                    "noscript", "iframe", "embed", "object",
                ];
                
                unwantedSelectors.forEach((selector) => {
                    try {
                        $(selector).remove();
                    } catch (e) {
                        // Ignore invalid selectors
                    }
                });
                
                // Try to find main content area
                let mainContent;
                if ($("main").length > 0) {
                    mainContent = $("main").first();
                } else if ($("article").length > 0) {
                    mainContent = $("article").first();
                } else if ($('[role="main"]').length > 0) {
                    mainContent = $('[role="main"]').first();
                } else if ($(".content").length > 0) {
                    mainContent = $(".content").first();
                } else if ($("#content").length > 0) {
                    mainContent = $("#content").first();
                } else if ($(".main-content").length > 0) {
                    mainContent = $(".main-content").first();
                } else if ($("#main-content").length > 0) {
                    mainContent = $("#main-content").first();
                } else {
                    mainContent = $("body");
                }
                
                materialContent = mainContent.text() || "";
                
                // Clean up the text
                materialContent = materialContent
                    .replace(/\s+/g, " ")
                    .replace(/\n\s*\n/g, "\n")
                    .replace(/^\s+|\s+$/gm, "")
                    .trim();
                
                // Limit text length
                const maxLength = 100000;
                if (materialContent.length > maxLength) {
                    materialContent = materialContent.substring(0, maxLength) + "... [Content truncated due to length]";
                }

                // Validate that we actually got some content
                if (!materialContent || materialContent.trim().length === 0) {
                    return res.status(400).json({ 
                        error: "Failed to extract content from URL", 
                        details: "No text content could be extracted from the webpage" 
                    });
                }
            } catch (fetchError) {
                console.error("Error fetching URL content:", fetchError);
                return res.status(400).json({ 
                    error: "Failed to fetch URL content", 
                    details: fetchError.message || "Could not retrieve content from the provided URL" 
                });
            }
        } else if (documentType === 'text') {
            // For text materials
            materialContent = documentData.textContent;
            materialType = "text";
            materialSource = "";
        } else if (documentType === 'pdf') {
            // For PDFs, we only update documentTitle, no content changes
            // Get existing content from the material (PDFs are not re-processed)
            materialContent = existingMaterial.fileContent || "";
            materialType = "file";
            materialSource = existingMaterial.documentTitle || "";
        }

        // Step 1: Delete from vector database (RAG) - skip for PDFs (only updating title)
        if (documentType !== 'pdf') {
            try {
                await ragService.deleteDocumentFromRAG(sourceId, materialCourseId);
                console.log("✅ Deleted from vector database");
            } catch (ragError) {
                console.error("Error deleting from vector database:", ragError);
                // Continue anyway - we'll try to add it back
            }

            // Step 2: Delete from MongoDB
            await deleteMaterial(sourceId);
            console.log("✅ Deleted from MongoDB");

            // Step 3: Re-save to vector database (RAG)
            try {
                // Get course name for metadata
                let courseName = "Unknown Course";
                try {
                    const course = await getCourseById(materialCourseId);
                    if (course) {
                        courseName = course.courseName || "Unknown Course";
                    }
                } catch (courseError) {
                    console.error("Error getting course name:", courseError);
                    // Continue with default name
                }

                await ragService.addDocumentToRAG(materialContent, {
                    source: materialSource,
                    type: materialType,
                    course: courseName,
                    sourceId: sourceId,
                    documentTitle: updatedDocumentTitle,
                }, materialCourseId);
                console.log("✅ Re-saved to vector database");
            } catch (ragAddError) {
                console.error("Error saving to vector database:", ragAddError);
                throw ragAddError;
            }

            // Step 4: Re-save to MongoDB
            // Calculate file size (using Buffer in Node.js instead of Blob)
            const fileSize = Buffer.byteLength(materialContent, 'utf8');
            await saveMaterial(sourceId, materialCourseId, {
                fileType: existingMaterial.fileType || (documentType === 'link' ? 'link' : "text/plain"),
                fileSize: fileSize,
                fileContent: documentType === 'link' ? url : materialContent, // For links, save URL to fileContent; for text, save content
                documentTitle: updatedDocumentTitle || null,
            });
            console.log("✅ Re-saved to MongoDB");
        } else {
            // For PDFs, only update documentTitle in MongoDB (no RAG changes needed)
            // Note: RAG metadata will retain the old title until material is re-processed
            const db = await databaseService.connect();
            const collection = db.collection("grasp_material");
            await collection.updateOne(
                { sourceId: sourceId },
                { $set: { documentTitle: updatedDocumentTitle || null } }
            );
            console.log("✅ Updated PDF documentTitle in MongoDB");
        }

        res.json({ success: true, message: "Material updated successfully" });
    } catch (error) {
        console.error("Error updating material:", error);
        res.status(500).json({ error: "Failed to update material", details: error.message });
    }
};

const refetchMaterialHandler = async (req, res) => {
    try {
        const { sourceId, courseId, url, content } = req.body;
        const userId = req.user.id;

        if (!sourceId || !url || !content) {
            return res.status(400).json({ error: "sourceId, url, and content are required" });
        }

        // Get existing material to verify it exists and get course info
        const existingMaterial = await getMaterialBySourceId(sourceId);
        if (!existingMaterial) {
            return res.status(404).json({ error: "Material not found" });
        }

        const materialCourseId = existingMaterial.courseId || courseId;
        if (!materialCourseId) {
            return res.status(400).json({ error: "Course ID is required" });
        }

        if (!isUserInCourse(userId, materialCourseId)) {
            return res.status(403).json({ error: "User is not in course" });
        }

        // Step 1: Delete from vector database (RAG)
        try {
            await ragService.deleteDocumentFromRAG(sourceId, materialCourseId);
            console.log("✅ Deleted from vector database");
        } catch (ragError) {
            console.error("Error deleting from vector database:", ragError);
            // Continue anyway - we'll try to add it back
        }

        // Step 2: Delete from MongoDB
        await deleteMaterial(sourceId);
        console.log("✅ Deleted from MongoDB");

        // Step 3: Re-save to vector database (RAG)
        try {
            // Get course name for metadata
            let courseName = "Unknown Course";
            try {
                const course = await getCourseById(materialCourseId);
                if (course) {
                    courseName = course.courseName || "Unknown Course";
                }
            } catch (courseError) {
                console.error("Error getting course name:", courseError);
                // Continue with default name
            }

            await ragService.addDocumentToRAG(content, {
                source: url,
                type: "url",
                course: courseName,
                sourceId: sourceId,
                documentTitle: existingMaterial.documentTitle || "",
            }, materialCourseId);
            console.log("✅ Re-saved to vector database");
        } catch (ragAddError) {
            console.error("Error saving to vector database:", ragAddError);
            throw ragAddError;
        }

        // Step 4: Re-save to MongoDB
        // Calculate file size (using Buffer in Node.js instead of Blob)
        const fileSize = Buffer.byteLength(content, 'utf8');
        await saveMaterial(sourceId, materialCourseId, {
            fileType: 'link',
            fileSize: fileSize,
            fileContent: url, // For links, save URL to fileContent
            documentTitle: existingMaterial.documentTitle || null,
        });
        console.log("✅ Re-saved to MongoDB");

        res.json({ success: true, message: "Link content refetched successfully" });
    } catch (error) {
        console.error("Error refetching material:", error);
        res.status(500).json({ error: "Failed to refetch material", details: error.message });
    }
};

const fetchUrlContentHandler = async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !url.trim()) {
      return res.status(400).json({
        error: "URL is required",
      });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({
        error: "Invalid URL format",
      });
    }

    console.log("=== FETCHING URL CONTENT (SERVER-SIDE) ===");
    console.log("URL:", url);

    // Fetch the webpage - use built-in fetch (Node.js 18+) or node-fetch
    let fetchFn;
    try {
      // Try built-in fetch first (Node.js 18+)
      fetchFn = globalThis.fetch || fetch;
      if (!fetchFn) {
        // Fallback to node-fetch if available
        const nodeFetch = await import("node-fetch");
        fetchFn = nodeFetch.default;
      }
    } catch (e) {
      throw new Error("Fetch is not available. Please use Node.js 18+ or install node-fetch");
    }

    const response = await fetchFn(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();

    // Extract and clean text from HTML using Cheerio
    let cheerio;
    try {
      cheerio = require("cheerio");
    } catch (e) {
      throw new Error("cheerio is required for HTML parsing. Please install it: npm install cheerio");
    }

    const $ = cheerio.load(html);

    // Remove unwanted elements (scripts, styles, navigation, ads, etc.)
    const unwantedSelectors = [
      "script",
      "style",
      "nav",
      "header",
      "footer",
      "aside",
      ".ad",
      ".ads",
      ".advertisement",
      ".sidebar",
      ".menu",
      ".navigation",
      ".nav",
      ".header",
      ".footer",
      "[role='navigation']",
      "[role='banner']",
      "[role='complementary']",
      ".social-share",
      ".share-buttons",
      ".comments",
      ".comment-section",
      "noscript",
      "iframe",
      "embed",
      "object",
    ];

    unwantedSelectors.forEach((selector) => {
      try {
        $(selector).remove();
      } catch (e) {
        // Ignore invalid selectors
      }
    });

    // Try to find main content area (prioritize semantic HTML)
    let mainContent;
    if ($("main").length > 0) {
      mainContent = $("main").first();
    } else if ($("article").length > 0) {
      mainContent = $("article").first();
    } else if ($('[role="main"]').length > 0) {
      mainContent = $('[role="main"]').first();
    } else if ($(".content").length > 0) {
      mainContent = $(".content").first();
    } else if ($("#content").length > 0) {
      mainContent = $("#content").first();
    } else if ($(".main-content").length > 0) {
      mainContent = $(".main-content").first();
    } else if ($("#main-content").length > 0) {
      mainContent = $("#main-content").first();
    } else {
      mainContent = $("body");
    }

    // Extract text from main content
    let text = mainContent.text() || "";

    // Clean up the text
    text = text
      .replace(/\s+/g, " ") // Replace multiple whitespace with single space
      .replace(/\n\s*\n/g, "\n") // Remove empty lines
      .replace(/^\s+|\s+$/gm, "") // Trim each line
      .trim();

    // Limit text length to prevent issues
    const maxLength = 100000; // 100k characters
    if (text.length > maxLength) {
      text = text.substring(0, maxLength) + "... [Content truncated due to length]";
    }

    // Get title if available
    const title = $("title").text() || url;

    console.log(`✅ Extracted ${text.length} characters from URL`);

    res.json({
      success: true,
      content: text,
      title: title,
      url: url,
      length: text.length,
    });
  } catch (error) {
    console.error("Error fetching URL content:", error);
    res.status(500).json({
      error: "Failed to fetch URL content",
      details: error.message,
    });
  }
};

const uploadFileHandler = async (req, res) => {
    try {
        const file = req.file;
        const { courseId, sourceId, documentTitle } = req.body;
        const userId = req.user.id;

        if (!file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        if (!courseId) {
            return res.status(400).json({ error: "courseId is required" });
        }

        if (!isUserInCourse(userId, courseId)) {
            return res.status(403).json({ error: "User is not in course" });
        }

        const fileName = file.originalname.toLowerCase();
        let content = "";
        let tokenUsage = 0;
        
        console.log(`Processing uploaded file: ${fileName} (${file.size} bytes)`);

        if (file.mimetype === "application/pdf" || fileName.endsWith(".pdf")) {
            const parsed = await parsePdf(file.buffer);
            content = parsed.content;
            tokenUsage = parsed.tokenUsage || 0;
        } else if (file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || fileName.endsWith(".docx")) {
            const parsed = await parseDocx(file.buffer);
            content = parsed.content;
            tokenUsage = parsed.tokenUsage || 0;
        } else if (file.mimetype === "text/plain" || fileName.endsWith(".txt")) {
            content = file.buffer.toString('utf8');
        } else if (file.mimetype === "application/msword" || fileName.endsWith(".doc")) {
             return res.status(400).json({ error: "DOC files are not fully supported for content extraction. Please convert to DOCX or PDF." });
        } else {
            return res.status(400).json({ error: "Unsupported file type" });
        }
        
        if (!content || content.trim().length === 0) {
           return res.status(400).json({ error: "Could not extract content from file" });
        }

        console.log(`✅ Extraction complete: ${content.length} characters (includes embedded image descriptions)`);
        console.log(`📊 Total VLM Token Usage for Upload: ${tokenUsage} tokens`);

        const actualSourceId = sourceId || `${courseId}-${Date.now()}-${Math.random()}`;

        // Get course name for RAG metadata
        let courseName = "Unknown Course";
        try {
            const course = await getCourseById(courseId);
            if (course) {
                courseName = course.courseName || "Unknown Course";
            }
        } catch (courseError) {
            console.error("Error getting course name:", courseError);
        }

        // Save to RAG
        await ragService.addDocumentToRAG(content, {
            source: file.originalname,
            type: "file",
            course: courseName,
            courseId: courseId,
            sourceId: actualSourceId,
            documentTitle: documentTitle || file.originalname,
        }, courseId);

        // Save to Database
        await saveMaterial(actualSourceId, courseId, {
            fileType: file.mimetype,
            fileSize: file.size,
            fileContent: content, // Save extracted text
            documentTitle: documentTitle || file.originalname,
        });

        res.json({
            success: true,
            message: "File uploaded and processed successfully",
            sourceId: actualSourceId,
            contentLength: content.length
        });
    } catch (error) {
        console.error("Error processing file upload:", error);
        res.status(500).json({ error: "Failed to process file upload", details: error.message });
    }
};

module.exports = {
  saveMaterialHandler,
  deleteMaterialHandler,
  getCourseMaterialsHandler,
  updateMaterialHandler,
  refetchMaterialHandler,
  fetchUrlContentHandler,
  uploadFileHandler
};
