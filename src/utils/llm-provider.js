// Single source of truth for LLM provider and model selection.
//
// LLM_PROVIDER decides BOTH the provider and the models to use:
//   - ollama -> local Ollama (free), using the OLLAMA_* model variables
//   - openai -> OpenAI, using the OPENAI_* model variables
//
// GRADING_LLM_PROVIDER optionally sends answer grading somewhere else, so
// grading can run on the UBC LLM Sandbox while everything else (uploads,
// embeddings, question generation) stays on LLM_PROVIDER:
//   - ubc-llm-sandbox -> UBC LLM Sandbox, using SANDBOX_LLM_MODEL
//   - openai | ollama -> as above
// Unset, grading follows LLM_PROVIDER. The sandbox is not accepted as
// LLM_PROVIDER because it has no embeddings support in GRASP yet.
//
// This is deliberately separate from NODE_ENV (which is reserved for framework
// behavior / cookie security: "production" | "development"), so you can run, say,
// production-grade web security while still pointing at local Ollama models.
// Defaults to openai when unset, so an unconfigured environment never silently
// targets a local Ollama instance.

const { groupForOperation } = require('../constants/llm-operations');

// Env var prefix for each provider's settings, e.g. SANDBOX_LLM_MODEL.
const ENV_PREFIX = {
  openai: 'OPENAI',
  ollama: 'OLLAMA',
  'ubc-llm-sandbox': 'SANDBOX',
};

function getLLMProvider() {
  return String(process.env.LLM_PROVIDER || '').toLowerCase() === 'ollama' ? 'ollama' : 'openai';
}

// Warn once per bad value: this runs on every grading call.
const warnedGradingValues = new Set();

// Provider for answer grading. Falls back to LLM_PROVIDER when unset, and when
// set to something unrecognised (with a warning, so a typo cannot silently
// leave grading on the wrong provider unnoticed).
function getGradingProvider() {
  const raw = process.env.GRADING_LLM_PROVIDER;
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return getLLMProvider();
  if (Object.hasOwn(ENV_PREFIX, value)) return value;

  if (!warnedGradingValues.has(raw)) {
    warnedGradingValues.add(raw);
    console.warn(
      `⚠️  GRADING_LLM_PROVIDER="${raw}" is not a recognised provider ` +
        `(${Object.keys(ENV_PREFIX).join(', ')}); grading will use LLM_PROVIDER instead.`
    );
  }
  return getLLMProvider();
}

// Provider for one LLM call, by its operation label (see llm-operations.js).
function getProviderForOperation(operation) {
  return groupForOperation(operation) === 'answer-grading' ? getGradingProvider() : getLLMProvider();
}

// The `<PREFIX>_<suffix>` setting of a provider (the active one by default).
function providerValue(suffix, provider = getLLMProvider()) {
  return process.env[`${ENV_PREFIX[provider]}_${suffix}`];
}

// Used when SANDBOX_LLM_MODEL is unset: the sandbox's general chat model.
const DEFAULT_SANDBOX_MODEL = 'qwen3.6-35b-a3b';

// Main model of a given provider. Only the sandbox has a default here; OpenAI
// and Ollama keep their long-standing fallbacks in services/llm.js.
function getModelForProvider(provider) {
  const configured = providerValue('LLM_MODEL', provider);
  if (configured) return configured;
  return provider === 'ubc-llm-sandbox' ? DEFAULT_SANDBOX_MODEL : configured;
}

// Main model used for question/objective generation.
function getLLMModel() {
  return getModelForProvider(getLLMProvider());
}

// Model used for the AI question-review step.
function getReviewModel() {
  return providerValue('REVIEW_MODEL');
}

// Model used to generate embeddings for the RAG vector store.
function getEmbeddingModel() {
  return providerValue('EMBEDDING_MODEL');
}

// Vision-capable model used to transcribe/describe images extracted from PDFs.
// Optional: when unset, falls back to the main LLM model (for multimodal setups
// where one model handles both text generation and image reading).
function getVisionModel() {
  return providerValue('VISION_MODEL') || getLLMModel();
}

// Qdrant vector size for the active provider. Must match the embedding model's
// output dimension (e.g. nomic-embed-text -> 768, text-embedding-3-small -> 1536).
// Falls back to 768 when unset/invalid.
function getQdrantVectorSize() {
  const n = parseInt(providerValue('QDRANT_VECTOR_SIZE'), 10);
  return Number.isFinite(n) && n > 0 ? n : 768;
}

module.exports = {
  getLLMProvider,
  getGradingProvider,
  getProviderForOperation,
  getModelForProvider,
  getLLMModel,
  getReviewModel,
  getEmbeddingModel,
  getVisionModel,
  getQdrantVectorSize,
};
