// JSON Schemas for structured LLM outputs (constrained decoding).
//
// These are passed to the model so it can only emit the exact shape we expect —
// no field-name drift to normalize around, regardless of model. Ollama consumes
// a schema directly via the `format` field; OpenAI via response_format json_schema
// (or, for models that already comply, the schema described in the prompt).
//
// All object schemas set additionalProperties:false and list every property in
// `required`, which is also what OpenAI strict structured outputs demands.

const { BLOOM_LEVELS } = require("./app-constants");

// Learning objectives: { objectives: [ { name, granularObjectives: [ { text, bloomTaxonomies } ] } ] }
const OBJECTIVES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    objectives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          granularObjectives: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                text: { type: "string" },
                bloomTaxonomies: {
                  type: "array",
                  items: { type: "string", enum: BLOOM_LEVELS },
                },
              },
              required: ["text", "bloomTaxonomies"],
            },
          },
        },
        required: ["name", "granularObjectives"],
      },
    },
  },
  required: ["objectives"],
};

// Image transcription/description for PDF visual content: { description }.
const IMAGE_DESCRIPTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    description: { type: "string" },
  },
  required: ["description"],
};

// Question review: { ratings: [ { questionId, reasoning, flagged, issue } ] }.
// Wrapped in an object (rather than a bare top-level array) so the same schema
// works for OpenAI structured outputs, which require an object root.
const QUESTION_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    ratings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          questionId: { type: "string" },
          reasoning: { type: "string" },
          flagged: { type: "boolean" },
          issue: { type: "string" },
        },
        required: ["questionId", "reasoning", "flagged", "issue"],
      },
    },
  },
  required: ["ratings"],
};

// Per-question-type schemas are co-located with their model + validation logic
// in src/models/questions/*.js (each model's getJsonSchema()), so the shape and
// the semantic checks that enforce it stay together.

module.exports = {
  OBJECTIVES_SCHEMA,
  IMAGE_DESCRIPTION_SCHEMA,
  QUESTION_REVIEW_SCHEMA,
};
