const fs = require('fs');
const os = require('os');
const path = require('path');

const mockChat = jest.fn();
const mockOllama = jest.fn(() => ({ chat: mockChat }));
const mockGetLLMInstance = jest.fn();

jest.mock('ollama', () => ({ Ollama: mockOllama }), { virtual: true });
jest.mock('../../src/services/llm', () => ({ getLLMInstance: mockGetLLMInstance }));

// llm-provider is real: which provider an operation reaches is part of what
// these tests check, and it only reads env vars.
const { generateStructured } = require('../../src/utils/structured-llm');
const { flushUsageLog } = require('../../src/utils/llm-usage-log');

describe('generateStructured', () => {
  const originalEnv = process.env;
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
    process.env = { ...originalEnv };
    for (const key of [
      'LLM_PROVIDER', 'GRADING_LLM_PROVIDER', 'OPENAI_LLM_MODEL', 'OLLAMA_LLM_MODEL', 'SANDBOX_LLM_MODEL',
      'OLLAMA_ENDPOINT', 'LLM_REASONING_EFFORT', 'LLM_EFFORT_QUESTION_GENERATE',
      'LLM_EFFORT_GRADE_OPEN_ENDED', 'LLM_USAGE_LOG',
    ]) {
      delete process.env[key];
    }
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses Ollama schema-constrained chat with image prompts', async () => {
    process.env.LLM_PROVIDER = 'ollama';
    process.env.OLLAMA_LLM_MODEL = 'llama-model';
    process.env.OLLAMA_ENDPOINT = 'http://ollama.test';
    process.env.LLM_EFFORT_QUESTION_GENERATE = 'high';
    mockChat.mockResolvedValue({
      message: { content: '{"answer":"ok"}' },
      prompt_eval_count: 7,
      eval_count: 3,
    });

    await expect(
      generateStructured({
        prompt: 'Return JSON',
        schema,
        operation: 'question-generate',
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
      options: { temperature: 0.1 }, // high effort -> low local temperature
    });
    expect(mockGetLLMInstance).not.toHaveBeenCalled();
  });

  it('uses provided conversation messages for Ollama without synthesizing a prompt message', async () => {
    process.env.LLM_PROVIDER = 'ollama';
    process.env.OLLAMA_LLM_MODEL = 'llama-model';
    mockChat.mockResolvedValue({ message: { content: '{}' } });
    const messages = [{ role: 'user', content: 'Use history' }];

    await generateStructured({ messages, prompt: 'ignored', schema });

    expect(mockChat).toHaveBeenCalledWith({
      model: 'llama-model',
      messages,
      stream: false,
      format: schema,
      options: { temperature: 0.1 }, // default high effort -> low local temperature
    });
  });

  it('passes strict json_schema response format to the toolkit for OpenAI prompts', async () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.LLM_EFFORT_QUESTION_GENERATE = 'high';
    const sendMessage = jest.fn().mockResolvedValue({
      content: '{"answer":"openai"}',
      usage: { promptTokens: 5, completionTokens: 4, totalTokens: 12 },
    });
    mockGetLLMInstance.mockResolvedValue({ sendMessage });

    await expect(
      generateStructured({
        prompt: 'Return JSON',
        schema,
        operation: 'question-generate',
        images: ['img'],
        model: 'gpt-test',
        schemaName: 'answer_payload',
      })
    ).resolves.toEqual({
      content: '{"answer":"openai"}',
      usage: { promptTokens: 5, completionTokens: 4, totalTokens: 12 },
    });

    expect(mockGetLLMInstance).toHaveBeenCalledWith('gpt-test', {
      reasoning_effort: 'high',
      max_completion_tokens: null,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'answer_payload', strict: true, schema },
      },
    }, 'openai');
    expect(sendMessage).toHaveBeenCalledWith(
      [
        { type: 'text', text: 'Return JSON' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,img' } },
      ],
      {}
    );
  });

  // The newer OpenAI models reject an explicit temperature outright ("does not
  // support 0.4 with this model"), which took down every LLM feature at once.
  // Effort is the only knob the OpenAI path may send.
  it('never sends a temperature on the OpenAI path', async () => {
    process.env.LLM_PROVIDER = 'openai';
    mockGetLLMInstance.mockResolvedValue({
      sendMessage: jest.fn().mockResolvedValue({ content: '{}', usage: {} }),
    });

    await generateStructured({ prompt: 'Return JSON', schema });
    process.env.LLM_EFFORT_QUESTION_GENERATE = 'high';
    await generateStructured({ prompt: 'Return JSON', schema, operation: 'question-generate' });

    for (const [, options] of mockGetLLMInstance.mock.calls) {
      expect(options).not.toHaveProperty('temperature');
    }
    // With nothing configured the effort is the built-in default, never a temperature.
    expect(mockGetLLMInstance.mock.calls[0][1].reasoning_effort).toBe('high');
    expect(mockGetLLMInstance.mock.calls[1][1].reasoning_effort).toBe('high');
  });

  it('passes image MIME types through for OpenAI image prompts', async () => {
    process.env.LLM_PROVIDER = 'openai';
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
    process.env.LLM_PROVIDER = 'openai';
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

  // GRADING_LLM_PROVIDER: grading runs on the UBC LLM Sandbox while uploads and
  // generation stay on LLM_PROVIDER. Ollama is the global provider here because
  // it takes a different code path, so a grading call that leaked onto
  // LLM_PROVIDER would show up as an Ollama chat.
  it('sends grading to GRADING_LLM_PROVIDER through the toolkit while other operations stay on LLM_PROVIDER', async () => {
    process.env.LLM_PROVIDER = 'ollama';
    process.env.OLLAMA_LLM_MODEL = 'llama-model';
    process.env.GRADING_LLM_PROVIDER = 'ubc-llm-sandbox';
    process.env.LLM_EFFORT_GRADE_OPEN_ENDED = 'none';
    const sendMessage = jest.fn().mockResolvedValue({
      content: '{"answer":"graded"}',
      usage: { promptTokens: 9, completionTokens: 3, totalTokens: 12 },
    });
    mockGetLLMInstance.mockResolvedValue({ sendMessage });
    mockChat.mockResolvedValue({ message: { content: '{"answer":"generated"}' } });

    await expect(
      generateStructured({ prompt: 'Grade this', schema, operation: 'grade-open-ended', schemaName: 'open_ended_grading' })
    ).resolves.toEqual({
      content: '{"answer":"graded"}',
      usage: { promptTokens: 9, completionTokens: 3, totalTokens: 12 },
    });

    expect(mockGetLLMInstance).toHaveBeenCalledTimes(1);
    expect(mockGetLLMInstance).toHaveBeenCalledWith(null, {
      reasoning_effort: 'none',
      max_completion_tokens: null,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'open_ended_grading', strict: true, schema },
      },
    }, 'ubc-llm-sandbox');
    expect(sendMessage).toHaveBeenCalledWith('Grade this', {});
    expect(mockChat).not.toHaveBeenCalled();

    await generateStructured({ prompt: 'Generate', schema, operation: 'question-generate' });

    expect(mockChat).toHaveBeenCalledTimes(1);
    expect(mockChat.mock.calls[0][0].model).toBe('llama-model');
    expect(mockGetLLMInstance).toHaveBeenCalledTimes(1);
  });

  it('records the grading provider and its model in the usage log, for failed calls too', async () => {
    const logPath = path.join(os.tmpdir(), `structured-llm-usage-${process.pid}-${Date.now()}.jsonl`);
    process.env.LLM_USAGE_LOG = logPath;
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_LLM_MODEL = 'gpt-test';
    process.env.GRADING_LLM_PROVIDER = 'ubc-llm-sandbox';
    process.env.SANDBOX_LLM_MODEL = 'qwen-test';
    const sendMessage = jest.fn()
      .mockResolvedValueOnce({ content: '{}', usage: { promptTokens: 4, completionTokens: 2 } })
      .mockRejectedValueOnce(new Error('gateway down'));
    mockGetLLMInstance.mockResolvedValue({ sendMessage });

    try {
      await generateStructured({ prompt: 'Grade', schema, operation: 'grade-fill-in-the-blank' });
      await expect(
        generateStructured({ prompt: 'Grade', schema, operation: 'grade-fill-in-the-blank' })
      ).rejects.toThrow('gateway down');
      await flushUsageLog();

      const rows = fs.readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      expect(rows).toEqual([
        expect.objectContaining({
          operation: 'grade-fill-in-the-blank', provider: 'ubc-llm-sandbox', model: 'qwen-test', ok: true,
        }),
        expect.objectContaining({
          operation: 'grade-fill-in-the-blank', provider: 'ubc-llm-sandbox', model: 'qwen-test', ok: false,
          error: 'gateway down',
        }),
      ]);
    } finally {
      fs.rmSync(logPath, { force: true });
    }
  });
});
