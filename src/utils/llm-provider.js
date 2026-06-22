// Single source of truth for LLM provider and model selection.
//
// LLM_PROVIDER decides BOTH the provider and the models to use:
//   - ollama -> local Ollama (free), using the OLLAMA_* model variables
//   - openai -> OpenAI, using the OPENAI_* model variables
//
// This is deliberately separate from NODE_ENV (which is reserved for framework
// behavior / cookie security: "production" | "development"), so you can run, say,
// production-grade web security while still pointing at local Ollama models.
// Defaults to openai when unset, so an unconfigured environment never silently
// targets a local Ollama instance.

function getLLMProvider() {
  return String(process.env.LLM_PROVIDER || '').toLowerCase() === 'ollama' ? 'ollama' : 'openai';
}

// Pick the Ollama or OpenAI variant of a setting based on the active provider.
function providerValue(ollamaVar, openaiVar) {
  return getLLMProvider() === 'ollama' ? process.env[ollamaVar] : process.env[openaiVar];
}

// Main model used for question/objective generation.
function getLLMModel() {
  return providerValue('OLLAMA_LLM_MODEL', 'OPENAI_LLM_MODEL');
}

// Model used for the AI question-review step.
function getReviewModel() {
  return providerValue('OLLAMA_REVIEW_MODEL', 'OPENAI_REVIEW_MODEL');
}

// Model used to generate embeddings for the RAG vector store.
function getEmbeddingModel() {
  return providerValue('OLLAMA_EMBEDDING_MODEL', 'OPENAI_EMBEDDING_MODEL');
}

// Vision-capable model used to transcribe/describe images extracted from PDFs.
// Optional: when unset, falls back to the main LLM model (for multimodal setups
// where one model handles both text generation and image reading).
function getVisionModel() {
  return providerValue('OLLAMA_VISION_MODEL', 'OPENAI_VISION_MODEL') || getLLMModel();
}

// Qdrant vector size for the active provider. Must match the embedding model's
// output dimension (e.g. nomic-embed-text -> 768, text-embedding-3-small -> 1536).
// Falls back to 768 when unset/invalid.
function getQdrantVectorSize() {
  const raw = providerValue('OLLAMA_QDRANT_VECTOR_SIZE', 'OPENAI_QDRANT_VECTOR_SIZE');
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 768;
}

module.exports = {
  getLLMProvider,
  getLLMModel,
  getReviewModel,
  getEmbeddingModel,
  getVisionModel,
  getQdrantVectorSize,
};
