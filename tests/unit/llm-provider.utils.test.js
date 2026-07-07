const provider = require('../../src/utils/llm-provider');

describe('LLM provider utilities', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('defaults to OpenAI unless LLM_PROVIDER is exactly ollama ignoring case', () => {
    delete process.env.LLM_PROVIDER;
    expect(provider.getLLMProvider()).toBe('openai');

    process.env.LLM_PROVIDER = 'OLLAMA';
    expect(provider.getLLMProvider()).toBe('ollama');

    process.env.LLM_PROVIDER = 'local';
    expect(provider.getLLMProvider()).toBe('openai');
  });

  it('selects model environment variables for the active provider', () => {
    process.env.OPENAI_LLM_MODEL = 'gpt-test';
    process.env.OPENAI_REVIEW_MODEL = 'gpt-review';
    process.env.OPENAI_EMBEDDING_MODEL = 'text-embed';
    process.env.OPENAI_VISION_MODEL = 'gpt-vision';
    process.env.OPENAI_QDRANT_VECTOR_SIZE = '1536';

    expect(provider.getLLMModel()).toBe('gpt-test');
    expect(provider.getReviewModel()).toBe('gpt-review');
    expect(provider.getEmbeddingModel()).toBe('text-embed');
    expect(provider.getVisionModel()).toBe('gpt-vision');
    expect(provider.getQdrantVectorSize()).toBe(1536);

    process.env.LLM_PROVIDER = 'ollama';
    process.env.OLLAMA_LLM_MODEL = 'llama3';
    process.env.OLLAMA_REVIEW_MODEL = 'llama-review';
    process.env.OLLAMA_EMBEDDING_MODEL = 'nomic';
    process.env.OLLAMA_QDRANT_VECTOR_SIZE = '768';

    expect(provider.getLLMModel()).toBe('llama3');
    expect(provider.getReviewModel()).toBe('llama-review');
    expect(provider.getEmbeddingModel()).toBe('nomic');
    expect(provider.getVisionModel()).toBe('llama3');
    expect(provider.getQdrantVectorSize()).toBe(768);
  });

  it('falls back to a safe vector size for invalid qdrant configuration', () => {
    process.env.OPENAI_QDRANT_VECTOR_SIZE = '-1';
    expect(provider.getQdrantVectorSize()).toBe(768);

    process.env.OPENAI_QDRANT_VECTOR_SIZE = 'not-a-number';
    expect(provider.getQdrantVectorSize()).toBe(768);
  });
});
