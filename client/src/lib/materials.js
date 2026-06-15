// Helpers for displaying and validating course materials.

// Icon, label and badge colors for a material's MIME-ish fileType string.
export function getMaterialTypeMeta(fileType = "") {
  if (fileType.includes("pdf")) {
    return { icon: "fa-file-pdf", label: "PDF", badgeClasses: "bg-red-100 text-red-600" };
  }
  if (fileType.includes("text")) {
    return { icon: "fa-file-alt", label: "TextBook", badgeClasses: "bg-blue-100 text-blue-600" };
  }
  if (fileType.includes("word")) {
    return { icon: "fa-file-word", label: "WordDocument", badgeClasses: "bg-indigo-100 text-indigo-600" };
  }
  if (fileType.includes("link")) {
    return { icon: "fa-link", label: "Link", badgeClasses: "bg-green-100 text-green-600" };
  }
  return { icon: "fa-file", label: "File", badgeClasses: "bg-gray-100 text-gray-600" };
}

// Keep only PDF/DOC/DOCX files; flags whether anything was rejected.
export function filterSupportedDocuments(files) {
  const validFiles = [];
  let hasInvalid = false;
  for (const file of files) {
    const fileName = file.name.toLowerCase();
    const isPDF = file.type === "application/pdf" || fileName.endsWith(".pdf");
    const isDOC = file.type === "application/msword" || fileName.endsWith(".doc");
    const isDOCX =
      file.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      fileName.endsWith(".docx");
    if (isPDF || isDOC || isDOCX) {
      validFiles.push(file);
    } else {
      hasInvalid = true;
    }
  }
  return { validFiles, hasInvalid };
}
