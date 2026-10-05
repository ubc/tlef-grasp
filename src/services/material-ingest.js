// The one path a document file takes into Course Materials: extract its text,
// index it for retrieval, store the material, then try to outline it. File
// upload (controllers/material.js) and the Canvas import
// (controllers/lms-canvas.js) both call ingestMaterialFile, so an imported file
// is parsed, indexed and outlined exactly like an uploaded one.

const { saveMaterial } = require('./material');
const { getCourseById } = require('./course');
const settingsService = require('./settings');
const ragService = require('./rag');
const outlineService = require('./material-outline');
const { parseInWorker } = require('../utils/parse-in-worker');
const { effortForStage } = require('../utils/llm-effort');
const {
    MATERIAL_FILE_KINDS,
    MaterialIngestError,
    materialFileKind,
    unsupportedTypeMessage,
} = require('../utils/material-file-types');

/**
 * Extract a file's text.
 * @returns {Promise<{ content: string, tokenUsage: number, fileType: string }>}
 *   `fileType` is the canonical MIME type stored on the material
 * @throws {MaterialIngestError} for a type GRASP cannot parse
 */
const extractMaterialText = async ({ courseId, buffer, fileName, mimeType }) => {
    const kind = materialFileKind({ fileName, mimeType });
    if (!kind) {
        throw new MaterialIngestError(unsupportedTypeMessage({ fileName, mimeType }), "unsupported-type");
    }
    const fileType = MATERIAL_FILE_KINDS[kind].mimeType;

    if (kind === "txt") {
        return { content: buffer.toString('utf8'), tokenUsage: 0, fileType };
    }

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

    let parsed;
    if (kind === "pdf") {
        parsed = await parseInWorker("pdf", buffer, parsingEffort);
    } else if (kind === "docx") {
        parsed = await parseInWorker("docx", buffer);
    } else {
        let powerPointPrompt;
        try {
            const settings = await settingsService.getSettings(courseId);
            powerPointPrompt = settings?.prompts?.powerPointImageDescription;
        } catch (settingsError) {
            console.error("Error getting PowerPoint extraction prompt:", settingsError);
        }
        parsed = await parseInWorker("pptx", buffer, fileName, powerPointPrompt, parsingEffort);
    }
    return { content: parsed.content, tokenUsage: parsed.tokenUsage || 0, fileType };
};

/**
 * Turn one document file into a course material.
 *
 * @param {Object} file
 * @param {string} file.courseId - The GRASP course the material belongs to
 * @param {Buffer} file.buffer - The file's bytes
 * @param {string} file.fileName - Original file name, with its extension
 * @param {string} [file.mimeType]
 * @param {number} file.size - Size of the original file in bytes
 * @param {string} [file.sourceId] - Generated when omitted
 * @param {string} [file.documentTitle] - Defaults to the file name
 * @param {Object} [file.lms] - Where the file was imported from, when it came from an LMS
 * @returns {Promise<{ sourceId: string, contentLength: number, documentTitle: string }>}
 * @throws {MaterialIngestError} for an unsupported type or a file with no extractable text
 */
const ingestMaterialFile = async ({ courseId, buffer, fileName, mimeType, size, sourceId, documentTitle, lms }) => {
    console.log(`Processing uploaded file: ${String(fileName).toLowerCase()} (${size} bytes)`);

    const { content, tokenUsage, fileType } = await extractMaterialText({ courseId, buffer, fileName, mimeType });

    if (!content || content.trim().length === 0) {
        throw new MaterialIngestError("Could not extract content from file", "empty-content");
    }

    console.log(`✅ Extraction complete: ${content.length} characters (includes embedded image descriptions)`);
    console.log(`📊 Total VLM Token Usage for Upload: ${tokenUsage} tokens`);

    const actualSourceId = sourceId || `${courseId}-${Date.now()}-${Math.random()}`;
    const title = documentTitle || fileName;

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
        source: fileName,
        type: "file",
        course: courseName,
        courseId: courseId,
        sourceId: actualSourceId,
        documentTitle: title,
    }, courseId);

    // Save to Database
    try {
        await saveMaterial(actualSourceId, courseId, {
            fileType,
            fileSize: size,
            fileContent: content, // Save extracted text
            documentTitle: title,
            ...(lms ? { lms } : {}),
        });
    } catch (saveError) {
        // Without its material the chunks just indexed would be retrievable
        // but belong to nothing an instructor can see or delete.
        try {
            await ragService.deleteDocumentFromRAG(actualSourceId, courseId);
        } catch (ragError) {
            console.error(`Could not remove vector chunks for unsaved material ${actualSourceId}:`, ragError);
        }
        throw saveError;
    }

    // Best-effort: this path already tolerates long work (OCR, and a vision
    // call per slide for PPTX), so this is the right place to spend it. But a
    // failed summary must never cost a material that parsed and stored fine —
    // the instructor can generate it from the materials page.
    try {
        await outlineService.generateOutline(actualSourceId);
    } catch (outlineError) {
        console.warn(
            `⚠️ Could not generate an outline for ${actualSourceId}:`,
            outlineError.message
        );
    }

    return { sourceId: actualSourceId, contentLength: content.length, documentTitle: title };
};

module.exports = {
    ingestMaterialFile,
};
