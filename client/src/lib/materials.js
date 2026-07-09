// Helpers for displaying and validating course materials.

export const MATERIAL_UPLOAD_TYPES = {
  pdf: {
    label: "PDF",
    accept: ".pdf,application/pdf",
    icon: "fa-file-pdf",
  },
  docx: {
    label: "DOCX",
    accept:
      ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    icon: "fa-file-word",
  },
  pptx: {
    label: "PowerPoint",
    accept:
      ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation",
    icon: "fa-file-powerpoint",
  },
};

export const SUPPORTED_DOCUMENT_ACCEPT = Object.values(MATERIAL_UPLOAD_TYPES)
  .map((type) => type.accept)
  .join(",");

// Icon, label and badge colors for a material's MIME-ish fileType string.
export function getMaterialTypeMeta(fileType = "") {
  const normalized = fileType.toLowerCase();
  if (normalized.includes("pdf")) {
    return { icon: "fa-file-pdf", label: "PDF", badgeClasses: "bg-red-100 text-red-600" };
  }
  if (normalized.includes("presentation") || normalized.includes("powerpoint") || normalized.includes("pptx")) {
    return { icon: "fa-file-powerpoint", label: "PowerPoint", badgeClasses: "bg-orange-100 text-orange-600" };
  }
  if (normalized.includes("word") || normalized.includes("docx")) {
    return { icon: "fa-file-word", label: "Word Document", badgeClasses: "bg-indigo-100 text-indigo-600" };
  }
  if (normalized.includes("text")) {
    return { icon: "fa-file-alt", label: "Textbook", badgeClasses: "bg-blue-100 text-blue-600" };
  }
  if (normalized.includes("link") || normalized.includes("url")) {
    return { icon: "fa-link", label: "Link", badgeClasses: "bg-green-100 text-green-600" };
  }
  return { icon: "fa-file", label: "File", badgeClasses: "bg-gray-100 text-gray-600" };
}

export function getDocumentUploadType(file) {
  const fileName = file.name.toLowerCase();
  const mimeType = (file.type || "").toLowerCase();
  if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) return "pdf";
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.endsWith(".docx")
  ) {
    return "docx";
  }
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    fileName.endsWith(".pptx")
  ) {
    return "pptx";
  }
  return null;
}

// Keep only supported files, and optionally require one selected upload type.
export function filterSupportedDocuments(files, expectedType = null) {
  const validFiles = [];
  const invalidFiles = [];
  for (const file of files) {
    const uploadType = getDocumentUploadType(file);
    if (uploadType && (!expectedType || uploadType === expectedType)) {
      validFiles.push(file);
    } else {
      invalidFiles.push(file);
    }
  }
  return { validFiles, invalidFiles, hasInvalid: invalidFiles.length > 0 };
}

export function getUploadValidationMessage(expectedType = null) {
  if (expectedType && MATERIAL_UPLOAD_TYPES[expectedType]) {
    return `Please choose a ${MATERIAL_UPLOAD_TYPES[expectedType].label} file for this upload option.`;
  }
  return "PDF, DOCX, and PPTX are the supported file formats at this time.";
}
