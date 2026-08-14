const { saveMaterial, getCourseMaterials, getMaterialCourseId, deleteMaterial, restoreMaterialDocument, getMaterialBySourceId, clearMaterialOutline } = require('../services/material');
const { hasStaffAccessInCourse } = require('../utils/course-access');
const { getCourseById } = require('../services/course');
const settingsService = require('../services/settings');
const { assertCoInstructorPermission, PERMISSION_KEYS } = require('../utils/co-instructor-permissions');
const { assertTaPermission, TA_PERMISSION_KEYS } = require("../utils/ta-permissions");
const ragService = require('../services/rag');
const databaseService = require('../services/database');
const { parseInWorker } = require('../utils/parse-in-worker');
const { effortForStage } = require('../utils/llm-effort');
const outlineService = require('../services/material-outline');
const { fetchReadableText, BlockedUrlError } = require('../utils/safe-fetch-url');

const TITLE_ONLY_UPDATE_TYPES = new Set(['pdf', 'file']);

/**
 * Reconstruct the RAG metadata for a material as it already exists, so a failed
 * content swap can put its original chunks back. Derived from the stored
 * document rather than the request, which describes the *new* content.
 */
const ragMetadataForExisting = (existingMaterial, courseName) => {
    const fileType = String(existingMaterial.fileType || '');
    const type = fileType === 'link' ? 'url' : fileType.startsWith('text') ? 'text' : 'file';
    return {
        // A link stores its URL in fileContent; everything else stores its text,
        // and its "source" was the original filename or title.
        source: type === 'url' ? existingMaterial.fileContent || '' : existingMaterial.documentTitle || '',
        type,
        course: courseName,
        sourceId: existingMaterial.sourceId,
        documentTitle: existingMaterial.documentTitle || '',
    };
};

/**
 * Swap a material's stored text and its vector chunks together, putting the
 * original back if any step fails.
 *
 * Editing or refetching a material is a delete-then-reinsert, because
 * saveMaterial inserts and the sourceId is uniquely indexed. That made the
 * sequence destructive: the Mongo row was deleted, then addDocumentToRAG ran,
 * and if it threw — Qdrant restarting, the embedding provider rate-limiting, a
 * network blip — the request 500'd with the row already gone and never
 * re-inserted. The extracted text exists nowhere else, so the material, its
 * outline, and every objective link pointing at it were lost for good, on a
 * transient error, while the instructor was only fixing a typo.
 *
 * Vector chunks are derived data and can always be rebuilt from the text, so the
 * Mongo document is what must survive. It is restored first and unconditionally;
 * the chunk restore is best-effort on top.
 *
 * @returns {Promise<void>} resolves once the new content is in place; rejects
 *   with the original failure after the rollback has been attempted.
 */
const replaceMaterialContent = async ({
    existingMaterial,
    courseId,
    courseName,
    ragContent,
    ragMetadata,
    materialFields,
}) => {
    const { sourceId } = existingMaterial;
    let documentRemoved = false;

    try {
        try {
            await ragService.deleteDocumentFromRAG(sourceId, courseId);
            console.log("✅ Deleted from vector database");
        } catch (ragError) {
            // Tolerated: the add below writes this sourceId's chunks afresh.
            console.error("Error deleting from vector database:", ragError);
        }

        await deleteMaterial(sourceId);
        documentRemoved = true;
        console.log("✅ Deleted from MongoDB");

        await ragService.addDocumentToRAG(ragContent, ragMetadata, courseId);
        console.log("✅ Re-saved to vector database");

        await saveMaterial(sourceId, courseId, materialFields);
        documentRemoved = false;
        console.log("✅ Re-saved to MongoDB");
    } catch (error) {
        if (documentRemoved) {
            try {
                await restoreMaterialDocument(existingMaterial);
                console.warn(`↩️ Restored material ${sourceId} after a failed update`);
            } catch (restoreError) {
                // The one case where text is genuinely at risk. Log the content
                // length so the size of the loss is at least recoverable from logs.
                console.error(
                    `❌ Could not restore material ${sourceId} after a failed update ` +
                    `(${(existingMaterial.fileContent || '').length} chars of extracted text):`,
                    restoreError
                );
            }

            try {
                await ragService.addDocumentToRAG(
                    existingMaterial.fileContent || '',
                    ragMetadataForExisting(existingMaterial, courseName),
                    courseId
                );
                console.warn(`↩️ Restored vector chunks for ${sourceId}`);
            } catch (ragRestoreError) {
                // Non-fatal: the text is back in Mongo, so re-saving the material
                // rebuilds these. Retrieval is degraded until then.
                console.error(
                    `⚠️ Material ${sourceId} was restored but its vector chunks were not; ` +
                    `re-save the material to rebuild them:`,
                    ragRestoreError
                );
            }
        }
        throw error;
    }
};

const saveMaterialHandler = async (req, res) => {
    try {
        const { sourceId, courseId, materialData } = req.body;
        const userId = req.user.id;

        if (!(await hasStaffAccessInCourse(req.user, courseId))) {
            return res.status(403).json({ error: "User is not in course" });
        }
        if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.COURSE_MATERIALS))) return;
        if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.COURSE_MATERIALS))) return;

        await saveMaterial(sourceId, courseId, materialData);

        if (materialData?.fileType === 'link') {
            // A link's fileContent is its URL, not the fetched page text —
            // there is nothing here worth summarizing into an outline.
        } else {
            // Best-effort, same trade as the upload path: a failed summary
            // must never cost a material that saved fine — the instructor
            // can generate it from the materials page.
            try {
                await outlineService.generateOutline(sourceId);
            } catch (outlineError) {
                console.warn(
                    `⚠️ Could not generate an outline for ${sourceId}:`,
                    outlineError.message
                );
            }
        }

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

        if (!(await hasStaffAccessInCourse(req.user, courseId))) {
            return res.status(403).json({ error: "User is not in course" });
        }
        if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.COURSE_MATERIALS))) return;
        if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.COURSE_MATERIALS))) return;

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

        if (!(await hasStaffAccessInCourse(req.user, courseId))) {
            return res.status(403).json({ error: "User is not in course" });
        }

        const materials = await getCourseMaterials(courseId);
        // The outline itself is never listed — it is fetched per material when
        // the instructor opens it. Only whether one exists is needed here.
        const summarized = materials.map(({ outline, ...rest }) => ({
            ...rest,
            hasOutline: !!outline,
        }));
        res.json({ success: true, materials: summarized });
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

        if (!(await hasStaffAccessInCourse(req.user, materialCourseId))) {
            return res.status(403).json({ error: "User is not in course" });
        }
        if (!(await assertCoInstructorPermission(req, res, materialCourseId, PERMISSION_KEYS.COURSE_MATERIALS))) return;
        if (!(await assertTaPermission(req, res, materialCourseId, TA_PERMISSION_KEYS.COURSE_MATERIALS))) return;

        // Validate required fields based on document type
        if (documentType === 'link') {
            if (!documentData.url) {
                return res.status(400).json({ error: "documentData.url is required for link type" });
            }
        } else if (documentType === 'text') {
            if (!documentData.textContent) {
                return res.status(400).json({ error: "documentData.textContent is required for text type" });
            }
        } else if (TITLE_ONLY_UPDATE_TYPES.has(documentType)) {
            // Uploaded files only need documentTitle updates here, no documentData required.
        } else {
            return res.status(400).json({ error: "Invalid documentType. Must be 'link', 'text', 'pdf', or 'file'" });
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
            
            // Guarded fetch: scheme allow-list, non-public address rejection on
            // every redirect hop, a wall-clock deadline, and a streamed byte cap.
            // See utils/safe-fetch-url.js for what each guard prevents.
            try {
                const fetched = await fetchReadableText(url);
                materialContent = fetched.text;
            } catch (fetchError) {
                console.error("Error fetching URL content:", fetchError);
                return res.status(400).json({
                    error: "Failed to fetch URL content",
                    details: fetchError.message || "Could not retrieve content from the provided URL",
                });
            }
        } else if (documentType === 'text') {
            // For text materials
            materialContent = documentData.textContent;
            materialType = "text";
            materialSource = "";
        } else if (TITLE_ONLY_UPDATE_TYPES.has(documentType)) {
            // For uploaded files, we only update documentTitle, no content changes.
            materialContent = existingMaterial.fileContent || "";
            materialType = "file";
            materialSource = existingMaterial.documentTitle || "";
        }

        // Uploaded files only rename, so they skip the content swap entirely.
        if (!TITLE_ONLY_UPDATE_TYPES.has(documentType)) {
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

            // Rolls back to the stored document if the vector write or the
            // re-insert fails, so a transient Qdrant/embedding error costs the
            // edit rather than the material.
            const fileSize = Buffer.byteLength(materialContent, 'utf8');
            await replaceMaterialContent({
                existingMaterial,
                courseId: materialCourseId,
                courseName,
                ragContent: materialContent,
                ragMetadata: {
                    source: materialSource,
                    type: materialType,
                    course: courseName,
                    sourceId: sourceId,
                    documentTitle: updatedDocumentTitle,
                },
                materialFields: {
                    fileType: existingMaterial.fileType || (documentType === 'link' ? 'link' : "text/plain"),
                    fileSize: fileSize,
                    fileContent: documentType === 'link' ? url : materialContent, // For links, save URL to fileContent; for text, save content
                    documentTitle: updatedDocumentTitle || null,
                },
            });

            // The stored outline described text that no longer exists.
            await clearMaterialOutline(sourceId);

            // Regenerate for text materials so a content edit has the same
            // best-effort outline behaviour as creating one. Links are
            // skipped: a link's fileContent holds the URL, not the fetched
            // page text (see saveMaterialHandler above and the
            // documentType === 'link' ? url : materialContent line above),
            // so there is nothing here worth summarizing.
            if (documentType === 'text') {
                try {
                    await outlineService.generateOutline(sourceId);
                } catch (outlineError) {
                    console.warn(
                        `⚠️ Could not generate an outline for ${sourceId}:`,
                        outlineError.message
                    );
                }
            }
        } else {
            // For uploaded files, only update documentTitle in MongoDB (no RAG changes needed).
            // Note: RAG metadata will retain the old title until material is re-processed
            const db = await databaseService.connect();
            const collection = db.collection("grasp_material");
            await collection.updateOne(
                { sourceId: sourceId },
                { $set: { documentTitle: updatedDocumentTitle || null } }
            );
            console.log("✅ Updated uploaded file documentTitle in MongoDB");
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

        if (!(await hasStaffAccessInCourse(req.user, materialCourseId))) {
            return res.status(403).json({ error: "User is not in course" });
        }
        if (!(await assertCoInstructorPermission(req, res, materialCourseId, PERMISSION_KEYS.COURSE_MATERIALS))) return;
        if (!(await assertTaPermission(req, res, materialCourseId, TA_PERMISSION_KEYS.COURSE_MATERIALS))) return;

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

        // Same rollback as the edit path: a refetch that fails at the vector
        // write must cost the refetch, not the material.
        const fileSize = Buffer.byteLength(content, 'utf8');
        await replaceMaterialContent({
            existingMaterial,
            courseId: materialCourseId,
            courseName,
            ragContent: content,
            ragMetadata: {
                source: url,
                type: "url",
                course: courseName,
                sourceId: sourceId,
                documentTitle: existingMaterial.documentTitle || "",
            },
            materialFields: {
                fileType: 'link',
                fileSize: fileSize,
                fileContent: url, // For links, save URL to fileContent
                documentTitle: existingMaterial.documentTitle || null,
            },
        });

        // The stored outline described text that no longer exists.
        await clearMaterialOutline(sourceId);

        res.json({ success: true, message: "Link content refetched successfully" });
    } catch (error) {
        console.error("Error refetching material:", error);
        res.status(500).json({ error: "Failed to refetch material", details: error.message });
    }
};

/**
 * Fetch a URL's readable text for the "add a link" flow, so the client can
 * preview it before saving. Delegates every guard to utils/safe-fetch-url.js:
 * this endpoint hands an instructor-named URL to the server and returns the
 * response body, which without those guards is a reflected SSRF.
 */
const fetchUrlContentHandler = async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !url.trim()) {
      return res.status(400).json({ error: "URL is required" });
    }

    const fetched = await fetchReadableText(url.trim());

    res.json({
      success: true,
      content: fetched.text,
      title: fetched.title,
      url: fetched.finalUrl,
      length: fetched.text.length,
    });
  } catch (error) {
    // Anything the guards rejected is the caller's problem, not a server fault.
    if (error instanceof BlockedUrlError) {
      return res.status(400).json({ error: "Failed to fetch URL content", details: error.message });
    }
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

        if (!(await hasStaffAccessInCourse(req.user, courseId))) {
            return res.status(403).json({ error: "User is not in course" });
        }
        if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.COURSE_MATERIALS))) return;
        if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.COURSE_MATERIALS))) return;

        const fileName = file.originalname.toLowerCase();
        let content = "";
        let tokenUsage = 0;
        let storedFileType = file.mimetype;
        
        console.log(`Processing uploaded file: ${fileName} (${file.size} bytes)`);

        // Parsing runs in a worker thread (parse-in-worker.js): OCR/layout
        // analysis on a large file takes seconds of pure CPU, which would
        // otherwise freeze every in-flight request on the event loop.
        // Resolved here, not in the worker: the worker thread has no database
        // connection, so it cannot read the course's settings itself.
        let parsingEffort = null;
        try {
            parsingEffort = effortForStage(await settingsService.getSettings(courseId), 'pdf-page-image');
        } catch (settingsError) {
            console.error("Error resolving parsing reasoning effort:", settingsError);
        }

        if (file.mimetype === "application/pdf" || fileName.endsWith(".pdf")) {
            const parsed = await parseInWorker("pdf", file.buffer, parsingEffort);
            content = parsed.content;
            tokenUsage = parsed.tokenUsage || 0;
            storedFileType = "application/pdf";
        } else if (file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || fileName.endsWith(".docx")) {
            const parsed = await parseInWorker("docx", file.buffer);
            content = parsed.content;
            tokenUsage = parsed.tokenUsage || 0;
            storedFileType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        } else if (file.mimetype === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || fileName.endsWith(".pptx")) {
            let powerPointPrompt;
            try {
                const settings = await settingsService.getSettings(courseId);
                powerPointPrompt = settings?.prompts?.powerPointImageDescription;
            } catch (settingsError) {
                console.error("Error getting PowerPoint extraction prompt:", settingsError);
            }
            const parsed = await parseInWorker("pptx", file.buffer, file.originalname, powerPointPrompt, parsingEffort);
            content = parsed.content;
            tokenUsage = parsed.tokenUsage || 0;
            storedFileType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        } else if (file.mimetype === "text/plain" || fileName.endsWith(".txt")) {
            content = file.buffer.toString('utf8');
            storedFileType = "text/plain";
        } else if (file.mimetype === "application/msword" || fileName.endsWith(".doc")) {
             return res.status(400).json({ error: "DOC files are not fully supported for content extraction. Please convert to DOCX, PDF, or PPTX." });
        } else if (file.mimetype === "application/vnd.ms-powerpoint" || fileName.endsWith(".ppt")) {
             return res.status(400).json({ error: "PPT files are not fully supported for content extraction. Please convert to PPTX." });
        } else {
            return res.status(400).json({ error: "Unsupported file type. Supported file types are PDF, DOCX, PPTX, and TXT." });
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
            fileType: storedFileType,
            fileSize: file.size,
            fileContent: content, // Save extracted text
            documentTitle: documentTitle || file.originalname,
        });

        // Best-effort: the upload path already tolerates long work (OCR, and a
        // vision call per slide for PPTX), so this is the right place to spend
        // it. But a failed summary must never cost a material that parsed and
        // stored fine — the instructor can generate it from the materials page.
        try {
            await outlineService.generateOutline(actualSourceId);
        } catch (outlineError) {
            console.warn(
                `⚠️ Could not generate an outline for ${actualSourceId}:`,
                outlineError.message
            );
        }

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

/** Shared gate for the outline routes: staff access plus generation permissions. */
const assertOutlineAccess = async (req, res) => {
    const courseId = await getMaterialCourseId(req.params.sourceId);
    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
        res.status(403).json({ success: false, error: "User is not in course" });
        return null;
    }
    if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_GENERATION))) return null;
    if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.QUESTION_GENERATION))) return null;
    return { courseId };
};

const getMaterialOutlineHandler = async (req, res) => {
    try {
        if (!(await assertOutlineAccess(req, res))) return;

        const result = await outlineService.getOutline(req.params.sourceId);
        if (!result) {
            return res.status(404).json({ success: false, error: "No outline for this material" });
        }
        res.json({ success: true, ...result });
    } catch (error) {
        console.error("Error fetching material outline:", error);
        res.status(500).json({ success: false, error: "Failed to fetch outline" });
    }
};

const generateMaterialOutlineHandler = async (req, res) => {
    try {
        if (!(await assertOutlineAccess(req, res))) return;

        const result = await outlineService.generateOutline(req.params.sourceId);
        res.json({ success: true, ...result });
    } catch (error) {
        if (error.code === 'EMPTY_MATERIAL' || error.code === 'MATERIAL_TOO_LARGE') {
            return res.status(400).json({ success: false, code: error.code, error: error.message });
        }
        console.error("Error generating material outline:", error);
        res.status(500).json({ success: false, error: "Failed to generate outline" });
    }
};

module.exports = {
  saveMaterialHandler,
  deleteMaterialHandler,
  getCourseMaterialsHandler,
  updateMaterialHandler,
  refetchMaterialHandler,
  fetchUrlContentHandler,
  uploadFileHandler,
  getMaterialOutlineHandler,
  generateMaterialOutlineHandler
};
