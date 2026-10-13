import { api } from "./api";

// Instructor-attached question images (stems and, issue #146, answer
// options) are stored server-side and referenced by { fileId, caption, ... }.

/** Where an attached image is served from. */
export const questionImageSrc = (image) => `/api/image/${image.fileId}`;

/**
 * Best-effort delete of an image taken off a form. Frees storage when the
 * image was never saved on a question; the server keeps one a saved question
 * still uses (the edit may be cancelled), and saving cleans that up instead.
 */
export function discardImageFile(fileId) {
  if (fileId) api.delete(`/api/image/${fileId}`).catch(() => {});
}
