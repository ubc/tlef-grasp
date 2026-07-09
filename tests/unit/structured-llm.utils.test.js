const mockChat = jest.fn();
const mockOllama = jest.fn(() => ({ chat: mockChat }));
const mockGetLLMInstance = jest.fn();
const mockGetLLMProvider = jest.fn();
const mockGetLLMModel = jest.fn();

jest.mock('ollama', () => ({ Ollama: mockOllama }), { virtual: true });
jest.mock('../../src/services/llm', () => ({ getLLMInstance: mockGetLLMInstance }));
jest.mock('../../src/utils/llm-provider', () => ({
  getLLMProvider: mockGetLLMProvider,
  getLLMModel: mockGetLLMModel,
}));

const { generateStructured } = require('../../src/utils/structured-llm');

describe('generateStructured', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: { answer: { type: 'string' } },
    required: ['answer'],
  };

  beforeEach(() => {
    mockChat.mockReset();
    mockOllama.mockClear();
    mockGetLLMInstance.mockReset();
    mockGetLLMProvider.mockReset();
    mockGetLLMModel.mockReset();
    delete process.env.OLLAMA_ENDPOINT;
  });

  it('uses Ollama schema-constrained chat with image prompts', async () => {
    mockGetLLMProvider.mockReturnValue('ollama');
    mockGetLLMModel.mockReturnValue('llama-model');
    process.env.OLLAMA_ENDPOINT = 'http://ollama.test';
    mockChat.mockResolvedValue({
      message: { content: '{"answer":"ok"}' },
      prompt_eval_count: 7,
      eval_count: 3,
    });

    await expect(
      generateStructured({
        prompt: 'Return JSON',
        schema,
        temperature: 0.1,
        images: ['base64-png'],
      })
    ).resolves.toEqual({
      content: '{"answer":"ok"}',
      usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
    });

    expect(mockOllama).toHaveBeenCalledWith({ host: 'http://ollama.test' });
    expect(mockChat).toHaveBeenCalledWith({
      model: 'llama-model',
      messages: [{ role: 'user', content: 'Return JSON', images: ['base64-png'] }],
      stream: false,
      format: schema,
      options: { temperature: 0.1 },
    });
    expect(mockGetLLMInstance).not.toHaveBeenCalled();
  });

  it('uses provided conversation messages for Ollama without synthesizing a prompt message', async () => {
    mockGetLLMProvider.mockReturnValue('ollama');
    mockGetLLMModel.mockReturnValue('llama-model');
    mockChat.mockResolvedValue({ message: { content: '{}' } });
    const messages = [{ role: 'user', content: 'Use history' }];

    await generateStructured({ messages, prompt: 'ignored', schema });

    expect(mockChat).toHaveBeenCalledWith({
      model: 'llama-model',
      messages,
      stream: false,
      format: schema,
      options: { temperature: 0.4 },
    });
  });

  it('passes strict json_schema response format to the toolkit for OpenAI prompts', async () => {
    mockGetLLMProvider.mockReturnValue('openai');
    const sendMessage = jest.fn().mockResolvedValue({
      content: '{"answer":"openai"}',
      usage: { promptTokens: 5, completionTokens: 4, totalTokens: 12 },
    });
    mockGetLLMInstance.mockResolvedValue({ sendMessage });

    await expect(
      generateStructured({
        prompt: 'Return JSON',
        schema,
        temperature: 0.2,
        images: ['img'],
        model: 'gpt-test',
        schemaName: 'answer_payload',
      })
    ).resolves.toEqual({
      content: '{"answer":"openai"}',
      usage: { promptTokens: 5, completionTokens: 4, totalTokens: 12 },
    });

    expect(mockGetLLMInstance).toHaveBeenCalledWith('gpt-test', {
      temperature: 0.2,
      max_completion_tokens: null,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'answer_payload', strict: true, schema },
      },
    });
    expect(sendMessage).toHaveBeenCalledWith(
      [
        { type: 'text', text: 'Return JSON' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,img' } },
      ],
      {}
    );
  });

  it('passes image MIME types through for OpenAI image prompts', async () => {
    mockGetLLMProvider.mockReturnValue('openai');
    const sendMessage = jest.fn().mockResolvedValue({
      content: '{"answer":"openai"}',
      usage: {},
    });
    mockGetLLMInstance.mockResolvedValue({ sendMessage });

    await generateStructured({
      prompt: 'Return JSON',
      schema,
      images: [{ data: 'jpeg-b64', mimeType: 'image/jpeg' }],
    });

    expect(sendMessage).toHaveBeenCalledWith(
      [
        { type: 'text', text: 'Return JSON' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,jpeg-b64' } },
      ],
      {}
    );
  });

  it('uses conversation APIs and derives total usage when providers omit it', async () => {
    mockGetLLMProvider.mockReturnValue('openai');
    const sendConversation = jest.fn().mockResolvedValue({
      text: '{"answer":"conversation"}',
      usage: { promptTokens: 2, completionTokens: 8 },
    });
    mockGetLLMInstance.mockResolvedValue({ sendConversation });
    const messages = [{ role: 'user', content: 'Return JSON' }];

    await expect(generateStructured({ messages, schema })).resolves.toEqual({
      content: '{"answer":"conversation"}',
      usage: { promptTokens: 2, completionTokens: 8, totalTokens: 10 },
    });

    expect(sendConversation).toHaveBeenCalledWith(messages, {});
  });
});
