// Test-only stand-ins for GRASP's LLM/RAG modules. They are injected by
// tests/e2e/start-server-with-stubs.js via the Node module loader, so no
// production source is modified and no live LLM / Qdrant / embedding provider
// is ever reached from browser tests (agents.e2e.md: "No real AI calls, ever").

// Deterministic-but-distinct string source. Distinctness matters: e.g.
// MultipleChoiceQuestion.validateAndNormalize rejects duplicate option texts.
let stubCounter = 0;
const nextStubString = (key) => {
  stubCounter += 1;
  return `Stub ${key || 'text'} ${stubCounter}`;
};

/**
 * Produce a JSON value satisfying `schema` — the subset of JSON Schema used by
 * the app's constrained-decoding schemas (object/array/string/number/boolean,
 * enum, required). Strings are unique; enum picks cycle so arrays of enums vary.
 */
function stubFromSchema(schema, key = 'value', enumIndex = 0) {
  if (!schema || typeof schema !== 'object') return nextStubString(key);

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[enumIndex % schema.enum.length];
  }

  switch (schema.type) {
    case 'object': {
      const out = {};
      const props = schema.properties || {};
      for (const [name, propSchema] of Object.entries(props)) {
        out[name] = stubFromSchema(propSchema, name);
      }
      return out;
    }
    case 'array':
      // Two items per array: enough to look like a list, cheap to render.
      return [0, 1].map((i) => stubFromSchema(schema.items, key, i));
    case 'boolean':
      // False is the safe default (QUESTION_REVIEW_SCHEMA's `flagged` must not
      // flag every generated question).
      return false;
    case 'number':
    case 'integer':
      return 1;
    default:
      return nextStubString(key);
  }
}

// Deterministic verdicts for the answer-grading judges (issue #45), recognized
// by their schema shape. The generic stubFromSchema would always return false
// booleans, so specs could never exercise a passing grade. Instead the verdict
// is controlled by markers the test types into the student answer box:
//   [[e2e-pass]]       → open-ended judge returns pass: true
//   [[e2e-equivalent]] → fill-in-the-blank fallback returns correct: true
// Any other answer fails. The markers are distinctive enough that seeded
// question/rubric text can never contain them by accident.
function gradingStubFromPrompt(schema, prompt = '') {
  const props = schema?.properties || {};
  if (props.pass && props.criteria && props.overallFeedback) {
    const pass = prompt.includes('[[e2e-pass]]');
    return {
      pass,
      overallFeedback: pass
        ? 'Stub judge: your answer meets the grading criteria.'
        : 'Stub judge: your answer is missing key concepts.',
      criteria: [
        {
          criterion: 'Key concept coverage',
          met: pass,
          comment: pass ? 'You covered the key concepts.' : 'You did not cover the key concepts.',
        },
        {
          criterion: 'Accuracy',
          met: pass,
          comment: pass ? 'Your statements are accurate.' : 'Your statements are inaccurate.',
        },
      ],
    };
  }
  if (props.correct && props.feedback && !props.pass) {
    const correct = prompt.includes('[[e2e-equivalent]]');
    return {
      correct,
      feedback: correct
        ? 'Stub judge: your phrasing is equivalent to the expected answer.'
        : 'Stub judge: your answer is not equivalent to the expected answer.',
    };
  }
  return null;
}

// Replaces src/utils/structured-llm.js — same contract as generateStructured().
const structuredLlmStub = {
  generateStructured: async ({ schema, prompt }) => {
    const graded = gradingStubFromPrompt(schema, prompt);
    // Objective generation needs two deterministic branches so browser tests
    // can prove that unrelated uploads do not produce fabricated objectives.
    if (schema?.properties?.materialIsRelevant) {
      const irrelevant = prompt.includes('[E2E_IRRELEVANT_MATERIAL]');
      const instructorObjectives = prompt.match(/User-Provided Objectives:\s*([\s\S]*?)\nCourse Materials Content:/)?.[1]
        ?.split('\n')
        .map((line) => line.replace(/^\s*-\s*/, '').trim())
        .filter(Boolean) || [];
      if (instructorObjectives.length) {
        return {
          content: JSON.stringify({
            materialIsRelevant: true,
            relevanceReason: 'Instructor-provided objectives were preserved.',
            objectives: instructorObjectives.map((text) => ({
              name: text,
              granularObjectives: [{ text, bloomTaxonomies: ['Understand'] }],
            })),
          }),
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      }
      if (irrelevant) {
        return {
          content: JSON.stringify({
            materialIsRelevant: false,
            relevanceReason: 'The material is marked as unrelated test content.',
            objectives: [],
          }),
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      }
      return {
        content: JSON.stringify({
          materialIsRelevant: true,
          relevanceReason: 'The material contains course concepts.',
          objectives: stubFromSchema(schema).objectives,
        }),
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
    return {
      content: JSON.stringify(graded || stubFromSchema(schema)),
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  },
};

// Replaces src/services/llm.js — reports ready; nothing in the stubbed flows
// should ever ask for a real LLM instance.
const llmServiceStub = {
  initializationPromise: Promise.resolve(),
  isInitialized: true,
  isReady: () => true,
  getLLMInstance: async () => {
    throw new Error('getLLMInstance called while the E2E LLM stub is active');
  },
};

/**
 * Replaces src/services/rag.js — an in-memory document store with the same
 * public surface as RAGService. "Retrieval" returns the stored documents
 * verbatim, filtered by sourceId like the real Qdrant filter, so objective and
 * question generation flows behave normally without a vector database.
 *
 * `getObjectiveWithMaterials` is passed in by the bootstrapper (it comes from
 * the real, unstubbed src/services/objective.js).
 */
function createRagServiceStub(getObjectiveWithMaterials) {
  const documents = new Map(); // sourceId -> { content, metadata }

  const chunksFor = ({ filter } = {}) => {
    const allowed = filter?.must?.[0]?.match?.any || null;
    const chunks = [];
    for (const [sourceId, doc] of documents) {
      if (allowed && !allowed.includes(sourceId)) continue;
      chunks.push({ content: doc.content, score: 1, metadata: doc.metadata });
    }
    return chunks;
  };

  const instance = {
    retrieveContext: async (query, options = {}) => chunksFor(options),
    addDocument: async (content, metadata = {}) => {
      const sourceId = metadata.sourceId || `stub-${documents.size + 1}`;
      documents.set(sourceId, { content, metadata });
      return [`${sourceId}-chunk-1`];
    },
    deleteDocumentsByMetadata: async ({ sourceId }) => {
      documents.delete(sourceId);
    },
  };

  return {
    initializationPromise: Promise.resolve(),
    getCollectionName: (courseId) => `stub_${courseId || 'default'}`,
    getOrCreateInstance: async () => instance,
    getRAGInstance: () => instance,

    addDocumentToRAG: async (content, metadata = {}) =>
      instance.addDocument(content, metadata),

    deleteDocumentFromRAG: async (sourceId) => {
      documents.delete(sourceId);
    },

    getLearningObjectiveRagContent: async (objectiveId) => {
      const objective = await getObjectiveWithMaterials(objectiveId);
      if (!objective) throw new Error(`Objective with ID ${objectiveId} not found`);
      const sourceIds = objective.materials.map((material) => material.sourceId);
      return chunksFor({ filter: { must: [{ key: 'sourceId', match: { any: sourceIds } }] } })
        .map((chunk) => chunk.content)
        .join('\n\n');
    },

    getRagContentFromMaterials: async (sourceIds) => {
      if (!sourceIds || sourceIds.length === 0) {
        throw new Error('At least one sourceId is required');
      }
      return chunksFor({ filter: { must: [{ key: 'sourceId', match: { any: sourceIds } }] } })
        .map(
          (chunk) =>
            `### MATERIAL: ${chunk.metadata?.documentTitle || 'Untitled'} (SOURCE ID: ${chunk.metadata?.sourceId || 'unknown'})\n${chunk.content}`
        )
        .join('\n\n---\n\n');
    },
  };
}

module.exports = { stubFromSchema, structuredLlmStub, llmServiceStub, createRagServiceStub };
