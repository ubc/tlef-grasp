// Image type checks shared by the question-image upload route and the Canvas
// quiz importer. Both must trust the bytes, never a filename or a claimed
// content type: an expired Canvas link answers 200 with an HTML login page.

// SVG is deliberately excluded: it can carry scripts (XSS vector).
const ALLOWED_IMAGE_MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const EXTENSION_BY_MIME = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
]);

/**
 * Verify the buffer's magic bytes match the claimed mime type so a renamed
 * file (e.g. an .html saved as .png) cannot lie its way into storage.
 * Returns one of ALLOWED_IMAGE_MIME_TYPES, or null.
 */
function sniffImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return 'image/gif';
  }
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

// File extension (no dot) for an allowed image type, or null. Imported files
// often have no extension at all, so names are built from the sniffed type.
function extensionForImageMime(mimeType) {
  return EXTENSION_BY_MIME.get(mimeType) || null;
}

module.exports = {
  ALLOWED_IMAGE_MIME_TYPES,
  sniffImageType,
  extensionForImageMime,
};
