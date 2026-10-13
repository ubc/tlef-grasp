// Which document files can become course materials, and how large they may
// be. Kept free of the parsers, the vector store and the LLM client so that the
// routes which only need to recognise a file (the upload size cap, the Canvas
// file list) do not load them; services/material-ingest.js does the work.

// Whole files are held in memory while they are parsed, so the cap also keeps
// a burst of concurrent uploads or imports from exhausting RAM.
const MAX_MATERIAL_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

// The file types whose text GRASP can extract, in the order they are matched.
const MATERIAL_FILE_KINDS = Object.freeze({
    pdf: { mimeType: "application/pdf", extension: ".pdf" },
    docx: {
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extension: ".docx",
    },
    pptx: {
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        extension: ".pptx",
    },
    txt: { mimeType: "text/plain", extension: ".txt" },
});

const SUPPORTED_MATERIAL_MIME_TYPES = Object.freeze(
    Object.values(MATERIAL_FILE_KINDS).map((kind) => kind.mimeType)
);

// Legacy Office formats get their own message: the fix is to convert the file.
const LEGACY_FILE_KINDS = [
    {
        mimeType: "application/msword",
        extension: ".doc",
        message: "DOC files are not fully supported for content extraction. Please convert to DOCX, PDF, or PPTX.",
    },
    {
        mimeType: "application/vnd.ms-powerpoint",
        extension: ".ppt",
        message: "PPT files are not fully supported for content extraction. Please convert to PPTX.",
    },
];

const UNSUPPORTED_TYPE_MESSAGE = "Unsupported file type. Supported file types are PDF, DOCX, PPTX, and TXT.";

/** A file that cannot become a material; the message is safe to show the user. */
class MaterialIngestError extends Error {
    constructor(message, code) {
        super(message);
        this.name = "MaterialIngestError";
        this.code = code;
    }
}

const matchesKind = (kind, name, type) => type === kind.mimeType || name.endsWith(kind.extension);

/**
 * Which supported type a file is, by MIME type or file extension.
 * @returns {'pdf'|'docx'|'pptx'|'txt'|null} null when GRASP cannot parse it
 */
const materialFileKind = ({ fileName, mimeType }) => {
    const name = String(fileName || "").toLowerCase();
    const type = String(mimeType || "").toLowerCase().split(";")[0].trim();
    const match = Object.entries(MATERIAL_FILE_KINDS).find(([, kind]) => matchesKind(kind, name, type));
    return match ? match[0] : null;
};

/** Why a file that is not a supported type was refused. */
const unsupportedTypeMessage = ({ fileName, mimeType }) => {
    const name = String(fileName || "").toLowerCase();
    const type = String(mimeType || "").toLowerCase().split(";")[0].trim();
    const legacy = LEGACY_FILE_KINDS.find((kind) => matchesKind(kind, name, type));
    return legacy ? legacy.message : UNSUPPORTED_TYPE_MESSAGE;
};

module.exports = {
    MAX_MATERIAL_FILE_BYTES,
    MATERIAL_FILE_KINDS,
    SUPPORTED_MATERIAL_MIME_TYPES,
    MaterialIngestError,
    materialFileKind,
    unsupportedTypeMessage,
};
