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

// Learning objectives: a relevance verdict plus { objectives: [ { name,
// granularObjectives: [ { text, bloomTaxonomies } ] } ] }. The verdict makes
// "there is no teachable content here" an explicit, schema-enforced answer
// instead of inviting the model to invent plausible-sounding objectives.
const OBJECTIVES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    materialIsRelevant: { type: "boolean" },
    relevanceReason: { type: "string" },
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
  required: ["materialIsRelevant", "relevanceReason", "objectives"],
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

// Open-ended answer grading: { pass, overallFeedback, criteria: [ { criterion, met, comment } ] }.
// The judge decomposes the instructor's rubric into individual criteria so the
// student gets per-criterion feedback, not just a verdict.
const OPEN_ENDED_GRADING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    pass: { type: "boolean" },
    overallFeedback: { type: "string" },
    criteria: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          criterion: { type: "string" },
          met: { type: "boolean" },
          comment: { type: "string" },
        },
        required: ["criterion", "met", "comment"],
      },
    },
  },
  required: ["pass", "overallFeedback", "criteria"],
};

// Fill-in-the-blank LLM fallback (runs only after exact matching fails):
// { correct, feedback }.
const FILL_IN_THE_BLANK_GRADING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    correct: { type: "boolean" },
    feedback: { type: "string" },
  },
  required: ["correct", "feedback"],
};

// Per-question-type schemas are co-located with their model + validation logic
// in src/models/questions/*.js (each model's getJsonSchema()), so the shape and
// the semantic checks that enforce it stay together.

module.exports = {
  OBJECTIVES_SCHEMA,
  IMAGE_DESCRIPTION_SCHEMA,
  QUESTION_REVIEW_SCHEMA,
  OPEN_ENDED_GRADING_SCHEMA,
  FILL_IN_THE_BLANK_GRADING_SCHEMA,
};
