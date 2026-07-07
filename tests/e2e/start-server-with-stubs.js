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

require(resolve('server.js'));
