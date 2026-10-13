// Pure helpers for the Course Materials "From Canvas" import (issue #141).
// No React or DOM here so tests/client can cover the wording directly.

import { formatFileSize } from "./format.js";
import { pluralize } from "./lmsRosterSync.js";

/**
 * Whether the add-material dialog offers "From Canvas": Canvas is configured
 * and connected, this deployment's Canvas scopes include files, and the
 * instructor owns at least one section linked to Canvas (`courses` is the
 * server's list of Canvas courses those sections point to).
 */
export function canvasImportAvailable(canvas, courses) {
  return Boolean(
    canvas?.configured &&
      canvas?.connected &&
      canvas?.capabilities?.files !== false &&
      Array.isArray(courses) &&
      courses.length > 0
  );
}

// "Biology 302 (BIOC 302)", or just the name when the code adds nothing.
export function canvasCourseLabel(course) {
  const name = String(course?.name || "").trim();
  const code = String(course?.code || "").trim();
  if (!name) return code || "Canvas course";
  return code && code !== name ? `${name} (${code})` : name;
}

// Files whose name contains every word typed, in any order and any case.
export function filterCanvasFiles(files, search) {
  const words = String(search || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return files;
  return files.filter((file) => {
    const name = String(file.name || "").toLowerCase();
    return words.every((word) => name.includes(word));
  });
}

// A file can be picked unless it is already a material here or is too big.
export function canvasFileSelectable(file) {
  return !file?.imported && !file?.tooLarge;
}

/**
 * The line under a file's name that says why it cannot be picked, or what
 * picking it means. Empty for an ordinary file.
 */
export function canvasFileNote(file, maxFileBytes) {
  if (file?.imported) {
    const title = file.imported.documentTitle;
    return title && title !== file.name
      ? `Already imported as "${title}"`
      : "Already imported";
  }
  if (file?.tooLarge) {
    return maxFileBytes
      ? `Over the ${formatFileSize(maxFileBytes)} limit`
      : "Too large to import";
  }
  if (file?.replacesImported) {
    return "Replaced in Canvas since you imported it. Importing adds this version as a new material.";
  }
  return "";
}

// Toast text + tone once an import run finishes.
export function describeCanvasImportResult({ imported = [], errors = [] } = {}) {
  if (errors.length === 0) {
    return {
      message: `${pluralize(imported.length, "file")} imported from Canvas`,
      type: "success",
    };
  }
  const failed = `${pluralize(errors.length, "file")} could not be imported`;
  return {
    message:
      imported.length > 0
        ? `${pluralize(imported.length, "file")} imported from Canvas. ${failed}.`
        : `${failed}.`,
    type: imported.length > 0 ? "warning" : "error",
  };
}
