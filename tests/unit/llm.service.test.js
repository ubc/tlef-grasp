const mockLLMModule = jest.fn(function LLMModule(config) {
  this.config = config;
});

jest.mock('ubc-genai-toolkit-llm', () => ({ LLMModule: mockLLMModule }));
jest.mock('ubc-genai-toolkit-core', () => ({ ConsoleLogger: jest.fn() }));

const llmService = require('../../src/services/llm');

describe('LLMService.getLLMInstance', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const key of [
      'LLM_PROVIDER', 'LLM_MAX_TOKENS', 'OPENAI_API_KEY', 'OPENAI_LLM_MODEL', 'OLLAMA_LLM_MODEL',
      'OLLAMA_ENDPOINT', 'SANDBOX_LLM_MODEL', 'UBC_LLM_SANDBOX_API_KEY', 'UBC_LLM_SANDBOX_ENDPOINT',
    ]) {
      delete process.env[key];
    }
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('builds a UBC LLM Sandbox config from the sandbox settings when asked for the sandbox', async () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.UBC_LLM_SANDBOX_API_KEY = 'sandbox-key';
    process.env.UBC_LLM_SANDBOX_ENDPOINT = 'https://sandbox.test/v1';
    process.env.SANDBOX_LLM_MODEL = 'qwen-test';
    const responseFormat = { type: 'json_schema', json_schema: { name: 'grading', strict: true, schema: {} } };

    const instance = await llmService.getLLMInstance(
      null,
      { reasoning_effort: 'none', max_completion_tokens: null, response_format: responseFormat },
      'ubc-llm-sandbox'
    );

    expect(instance.config).toMatchObject({
      provider: 'ubc-llm-sandbox',
      apiKey: 'sandbox-key',
      endpoint: 'https://sandbox.test/v1',
      defaultModel: 'qwen-test',
    });
    // A null override removes the option outright rather than sending null.
    expect(instance.config.defaultOptions).toEqual({
      reasoning_effort: 'none',
      response_format: responseFormat,
    });
  });

  it('falls back to qwen3.6-35b-a3b when SANDBOX_LLM_MODEL is unset', async () => {
    const instance = await llmService.getLLMInstance(null, {}, 'ubc-llm-sandbox');

    expect(instance.config.defaultModel).toBe('qwen3.6-35b-a3b');
  });

  it('prefers an explicit model override over the sandbox setting', async () => {
    process.env.SANDBOX_LLM_MODEL = 'qwen-test';

    const instance = await llmService.getLLMInstance('qwen-override', {}, 'ubc-llm-sandbox');

    expect(instance.config.defaultModel).toBe('qwen-override');
  });

  it('uses LLM_PROVIDER when no provider is passed', async () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.OPENAI_LLM_MODEL = 'gpt-test';

    const openai = await llmService.getLLMInstance();
    expect(openai.config).toMatchObject({ provider: 'openai', apiKey: 'openai-key', defaultModel: 'gpt-test' });

    process.env.LLM_PROVIDER = 'ollama';
    process.env.OLLAMA_LLM_MODEL = 'llama-test';

    const ollama = await llmService.getLLMInstance();
    expect(ollama.config).toMatchObject({ provider: 'ollama', defaultModel: 'llama-test' });
  });
});
