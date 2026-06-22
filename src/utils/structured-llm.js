// Provider-aware structured (schema-constrained) generation.
//
// Ollama (local, drift-prone models): the JSON schema goes directly in `format`,
// so the decoder physically cannot emit other field names. We call the SDK
// directly because the toolkit only exposes plain `'json'` mode.
//
// OpenAI (gpt-*): the toolkit's `json` mode is sufficient — the model reliably
// follows the schema described in the prompt — so we keep it on the toolkit
// abstraction and avoid pulling in the openai SDK as a direct dependency.

const { Ollama } = require("ollama");
const llmService = require("../services/llm");
const { getLLMProvider, getLLMModel } = require("./llm-provider");

/**
 * Generate a response constrained to `schema` (a JSON Schema object).
 *
 * Provide either a single `prompt` (optionally with `images`) or a full
 * `messages` array for multi-turn conversations (e.g. iterative question
 * generation, where the shared prefix enables prompt caching).
 *
 * @param {object}   params
 * @param {string}  [params.prompt]       Single user prompt.
 * @param {Array}   [params.messages]     Multi-turn history [{ role, content }]. Takes precedence over prompt.
 * @param {object}   params.schema        JSON Schema the output must match.
 * @param {number}  [params.temperature]  Sampling temperature (default 0.4).
 * @param {string[]}[params.images]       Optional base64 PNG strings (no data-URL prefix) for vision.
 * @param {string}  [params.model]        Optional model override (defaults to the active LLM model).
 * @param {string}  [params.schemaName]   Name for the OpenAI json_schema (identifier chars only).
 * @returns {Promise<{ content: string, usage: { promptTokens: number, completionTokens: number, totalTokens: number } }>}
 */
async function generateStructured({ prompt, messages = null, schema, temperature = 0.4, images = null, model = null, schemaName = "response" }) {
  const hasImages = Array.isArray(images) && images.length > 0;

  if (getLLMProvider() === "ollama") {
    const client = new Ollama({
      host: process.env.OLLAMA_ENDPOINT || "http://localhost:11434",
    });
    let ollamaMessages;
    if (messages) {
      ollamaMessages = messages;
    } else {
      const message = { role: "user", content: prompt };
      if (hasImages) message.images = images;
      ollamaMessages = [message];
    }
    const response = await client.chat({
      model: model || getLLMModel(),
      messages: ollamaMessages,
      stream: false,
      format: schema,
      options: { temperature },
    });
    const promptTokens = response?.prompt_eval_count || 0;
    const completionTokens = response?.eval_count || 0;
    return {
      content: response?.message?.content || "",
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    };
  }

  // OpenAI via the toolkit. We pass an OpenAI strict json_schema response_format
  // through the toolkit — it forwards unknown options straight to the OpenAI
  // call — so the output is schema-constrained (a hard guarantee, same as the
  // Ollama path) without needing a direct openai SDK dependency.
  const response_format = {
    type: "json_schema",
    json_schema: { name: schemaName, strict: true, schema },
  };
  const llmModule = await llmService.getLLMInstance(model, {
    temperature,
    max_completion_tokens: null,
    response_format,
  });
  let response;
  if (messages) {
    response = await llmModule.sendConversation(messages, {});
  } else {
    const payload = hasImages
      ? [
          { type: "text", text: prompt },
          ...images.map((b64) => ({
            type: "image_url",
            image_url: { url: `data:image/png;base64,${b64}` },
          })),
        ]
      : prompt;
    response = await llmModule.sendMessage(payload, {});
  }
  const usage = response.usage || {};
  const promptTokens = usage.promptTokens || 0;
  const completionTokens = usage.completionTokens || 0;
  return {
    content: response.content || response.text || response.message || "",
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: usage.totalTokens || promptTokens + completionTokens,
    },
  };
}

module.exports = { generateStructured };
