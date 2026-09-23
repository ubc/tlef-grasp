// Boots the real GRASP server with the LLM/RAG modules replaced by in-memory
// test stubs (tests/e2e/stubs/llm-stubs.js). Playwright's webServer runs this
// instead of `npm run start:test` so browser tests never reach a live LLM,
// Qdrant, or embedding provider — while every other module (Express, Mongo,
// SAML, the UBC academic-API adapter) stays exactly as in production.
//
// Interception happens at the Node module loader, keeping production sources
// untouched (repo convention: prefer test stubs over editing prod code).
const Module = require('module');
const path = require('path');

const {
  structuredLlmStub,
  llmServiceStub,
  createRagServiceStub,
} = require('./stubs/llm-stubs');

const resolve = (rel) => require.resolve(path.join(__dirname, '../../src', rel));

// The RAG stub reuses the real objective lookup (that module is not stubbed).
const { getObjectiveWithMaterials } = require(resolve('services/objective.js'));

const stubbedModules = new Map([
  [resolve('utils/structured-llm.js'), structuredLlmStub],
  [resolve('services/llm.js'), llmServiceStub],
  [resolve('services/rag.js'), createRagServiceStub(getObjectiveWithMaterials)],
]);

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  let resolved;
  try {
    resolved = Module._resolveFilename(request, parent, isMain);
  } catch {
    return originalLoad.apply(this, arguments);
  }
  if (stubbedModules.has(resolved)) return stubbedModules.get(resolved);
  return originalLoad.apply(this, arguments);
};

// The fake Canvas (tests/e2e/stubs/fake-canvas.js) runs in this same process
// when the e2e env asks for it; playwright.config.js sets E2E_FAKE_CANVAS_PORT
// and points CANVAS_DOMAIN at it. GRASP reaches it over HTTP through the real
// LMS toolkit client, so nothing in src/ is swapped for it. A port clash fails
// the boot loudly instead of letting GRASP talk to whatever holds the port.
if (process.env.E2E_FAKE_CANVAS_PORT) {
  const { createFakeCanvas } = require('./stubs/fake-canvas');
  createFakeCanvas()
    .listen()
    .then(({ address, port }) => {
      console.log(`[e2e] fake Canvas listening on http://${address}:${port}`);
    })
    .catch((error) => {
      console.error(`[e2e] fake Canvas could not start: ${error.message}`);
      process.exit(1);
    });
}

require(resolve('server.js'));
