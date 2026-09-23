// Spec-side helpers for the fake Canvas (tests/e2e/stubs/fake-canvas.js). The
// fake runs inside the GRASP e2e server process, so specs reach its control
// API over HTTP rather than by requiring it.
const { request } = require('@playwright/test');
const { FAKE_CANVAS } = require('./stubs/fake-canvas-fixtures');

async function control(method, path, body) {
  let response;
  try {
    response = await fetch(`${FAKE_CANVAS.ORIGIN}/__e2e${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new Error(
      `The fake Canvas is not reachable at ${FAKE_CANVAS.ORIGIN} (${error.message}). ` +
        'It starts with the e2e server (start-server-with-stubs.js) when E2E_FAKE_CANVAS_PORT is set.'
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Fake Canvas ${method} ${path} failed (${response.status}): ${data.error || ''}`);
  }
  return data;
}

/** Back to the fixtures (tests/e2e/stubs/fake-canvas-fixtures.js); clears the request log. */
const resetFakeCanvas = () => control('POST', '/reset');

/** Make exactly these Canvas users the active/invited students of a section. */
const setFakeCanvasSectionStudents = (sectionId, userIds) =>
  control('PUT', `/sections/${encodeURIComponent(sectionId)}/students`, { userIds });

/** Whether the teacher's token may read SIS fields (integration_id etc.). */
const setFakeCanvasSisVisibility = (readSis) => control('PUT', '/permissions', { readSis });

/**
 * Simulate a developer key with Enforce Scopes: the seeded token then carries
 * exactly `scopes` (out-of-scope calls get 401, include[] is stripped to uuid).
 * null = a key without Enforce Scopes, the fixture default.
 */
const setFakeCanvasEnforcedScopes = (scopes) => control('PUT', '/scopes', { scopes });

/**
 * The Canvas API requests GRASP made:
 * [{ method, path, query: [[k, v]], authorized, scopesEnforced, status }].
 */
const getFakeCanvasRequests = async () => (await control('GET', '/requests')).requests;

const clearFakeCanvasRequests = () => control('DELETE', '/requests');

/**
 * Why the Canvas specs cannot run against the server Playwright is using, or
 * null when they can. Locally Playwright reuses whatever already serves :8052,
 * and a dev server there talks to the developer's real Canvas (or none): a
 * spec that went ahead would sync against it. Checked through the app itself,
 * as the Canvas-connected persona.
 *
 * @param {{ baseURL: string, storageState: string }} options
 */
async function fakeCanvasSkipReason({ baseURL, storageState }) {
  const api = await request.newContext({ baseURL, storageState });
  try {
    const response = await api.get('/api/lms/canvas/status');
    if (response.status() === 404) {
      return (
        'The running server has no Canvas configured, so it is not the e2e server with the fake ' +
        'Canvas (a reused dev server?). Free :8052 and rerun so Playwright boots its own.'
      );
    }
    const body = await response.json().catch(() => ({}));
    if (body.canvasDomain && body.canvasDomain !== FAKE_CANVAS.ORIGIN) {
      return (
        `The running server's Canvas is ${body.canvasDomain}, not the fake at ${FAKE_CANVAS.ORIGIN} ` +
        '(a reused dev server?). Free :8052 and rerun so Playwright boots its own.'
      );
    }
    return null;
  } finally {
    await api.dispose();
  }
}

module.exports = {
  FAKE_CANVAS,
  resetFakeCanvas,
  setFakeCanvasSectionStudents,
  setFakeCanvasSisVisibility,
  setFakeCanvasEnforcedScopes,
  getFakeCanvasRequests,
  clearFakeCanvasRequests,
  fakeCanvasSkipReason,
};
