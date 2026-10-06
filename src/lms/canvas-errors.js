// How a Canvas API failure is reported to the browser, shared by every Canvas
// controller so the wording (and the 401 "reconnect" signal the client acts
// on) stays the same everywhere.

/**
 * The HTTP answer for a toolkit CanvasApiError, or null for any other error
 * (which the caller passes on as a server fault).
 *
 * @param {{ CanvasApiError: Function }} canvas - The toolkit Canvas namespace
 * @param {Error} error
 * @returns {{ status: number, body: Object } | null}
 */
function canvasApiErrorResponse(canvas, error) {
  if (!(error instanceof canvas.CanvasApiError)) return null;

  // Canvas answers both an expired/revoked token and a call outside the
  // token's scopes ("Insufficient scopes on access token.") with 401, and
  // CanvasApiError keeps only the status, so the message covers both.
  if (error.statusCode === 401) {
    return {
      status: 401,
      body: {
        success: false,
        connected: false,
        error:
          'Canvas rejected the request. Reconnect Canvas; if this keeps happening, ' +
          'the GRASP Canvas developer key may be missing a permission.',
      },
    };
  }
  if (error.statusCode === 403) {
    return {
      status: 403,
      body: {
        success: false,
        error: 'Your connected Canvas account does not have permission for this course.',
      },
    };
  }
  if (error.statusCode === 404) {
    return {
      status: 404,
      body: { success: false, error: 'The requested Canvas resource could not be found.' },
    };
  }
  return {
    status: 502,
    body: { success: false, error: 'Canvas could not complete the request. Please try again.' },
  };
}

module.exports = { canvasApiErrorResponse };
