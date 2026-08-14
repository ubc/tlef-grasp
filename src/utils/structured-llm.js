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
const { recordUsage } = require("./llm-usage-log");
const { resolveEffort } = require("./llm-effort");

// How hard the model should think is a property of the operation, not of the
// call site: `resolveEffort` reads it from the operation label and the
// LLM_EFFORT_* env vars. The newer OpenAI models take `reasoning_effort` and
// reject an explicit `temperature` outright. Local Ollama models have no such
// control, so the nearest local equivalent is sampling temperature — less
// exploration for the work we want careful and repeatable.
const OLLAMA_EFFORT_TEMPERATURE = {
  high: 0.1,
  medium: 0.3,
  low: 0.5,
  minimal: 0.7,
  none: 0.7,
};

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
 * @param {string}  [params.operation]    Operation label — sets both the usage-log
 *                                        stage and the reasoning effort (see llm-effort.js).
 * @param {string}  [params.effort]       Resolved effort for this call. Callers that hold the
 *                                        course's settings pass its choice, which outranks env.
 * @param {Array<string|{data:string,mimeType:string}>}[params.images] Optional base64 images for vision.
 * @param {string}  [params.model]        Optional model override (defaults to the active LLM model).
 * @param {string}  [params.schemaName]   Name for the OpenAI json_schema (identifier chars only).
 * @returns {Promise<{ content: string, usage: { promptTokens: number, completionTokens: number, totalTokens: number } }>}
 */
async function generateStructured({ prompt, messages = null, schema, images = null, model = null, schemaName = "response", operation = "unknown", effort: requestedEffort = null }) {
  const startedAt = Date.now();
  // A caller-supplied effort is already the course's resolved choice; only fall
  // back to the env vars when no course expressed one.
  const effort = requestedEffort || resolveEffort(operation);
  try {
    const result = await callProvider({ prompt, messages, schema, effort, images, model, schemaName });
    recordUsage({
      operation,
      provider: getLLMProvider(),
      model: model || getLLMModel(),
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      ms: Date.now() - startedAt,
      images: Array.isArray(images) ? images.length : 0,
    });
    return result;
  } catch (error) {
    // A call that threw still consumed a request and, usually, input tokens.
    // Omitting it would make this log quietly disagree with the provider's bill.
    recordUsage({
      operation,
      provider: getLLMProvider(),
      model: model || getLLMModel(),
      ms: Date.now() - startedAt,
      ok: false,
      error: error.message,
      images: Array.isArray(images) ? images.length : 0,
    });
    throw error;
  }
}

async function callProvider({ prompt, messages, schema, effort, images, model, schemaName }) {
  const normalizedImages = Array.isArray(images)
    ? images.map((image) =>
        typeof image === "string"
          ? { data: image, mimeType: "image/png" }
          : { data: image.data, mimeType: image.mimeType || "image/png" }
      )
    : [];
  const hasImages = normalizedImages.length > 0;

  if (getLLMProvider() === "ollama") {
    const client = new Ollama({
      host: process.env.OLLAMA_ENDPOINT || "http://localhost:11434",
    });
    let ollamaMessages;
    if (messages) {
      ollamaMessages = messages;
    } else {
      const message = { role: "user", content: prompt };
      if (hasImages) message.images = normalizedImages.map((image) => image.data);
      ollamaMessages = [message];
    }
    const response = await client.chat({
      model: model || getLLMModel(),
      messages: ollamaMessages,
      stream: false,
      format: schema,
      options: { temperature: OLLAMA_EFFORT_TEMPERATURE[effort] ?? OLLAMA_EFFORT_TEMPERATURE.medium },
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
    reasoning_effort: effort,
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
          ...normalizedImages.map((image) => ({
            type: "image_url",
            image_url: { url: `data:${image.mimeType};base64,${image.data}` },
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
