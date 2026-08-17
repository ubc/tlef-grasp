// Reasoning effort per LLM operation.
//
// The newer OpenAI models reject an explicit `temperature` and take
// `reasoning_effort` instead. Effort buys quality with latency: the built-in
// default is high, and anything that wants speed more than thoroughness is
// dialled down per course (settings page) or per deployment (env).
//
// Resolution order, most specific first:
//   1. The course's own setting, per pipeline stage (effortForStage)
//   2. LLM_EFFORT_<OPERATION>  — e.g. LLM_EFFORT_QUESTION_GENERATE=high
//   3. LLM_REASONING_EFFORT    — global default for every operation
//   4. "high" — the built-in default
//
// A course owner's choice outranks the env vars: the env is the deployment-wide
// default, and the settings page has to do what it says. Env still tunes every
// course that has expressed no preference, without a release.

const { groupForOperation } = require("../constants/llm-operations");

/** Accepted by the OpenAI API; the provider rejects anything else with a 400. */
const VALID_EFFORTS = ["none", "minimal", "low", "medium", "high"];

const DEFAULT_EFFORT = "high";

const GLOBAL_ENV_VAR = "LLM_REASONING_EFFORT";

/**
 * Env var that overrides a single operation, e.g. "question-generate" ->
 * LLM_EFFORT_QUESTION_GENERATE.
 */
function envVarForOperation(operation) {
  return `LLM_EFFORT_${String(operation).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

// Warn once per bad value rather than on every call: this runs on a hot path,
// and a misconfigured deployment would otherwise flood the log.
const warned = new Set();

function readEffort(envVar) {
  const raw = process.env[envVar];
  if (raw === undefined || raw === "") return null;

  const value = raw.trim().toLowerCase();
  if (VALID_EFFORTS.includes(value)) return value;

  if (!warned.has(`${envVar}=${raw}`)) {
    warned.add(`${envVar}=${raw}`);
    console.warn(
      `⚠️  ${envVar}="${raw}" is not a valid reasoning effort ` +
        `(${VALID_EFFORTS.join(", ")}); ignoring it.`
    );
  }
  return null;
}

/**
 * Effort to use for an operation.
 * @param {string} [operation] Operation label, as recorded in the usage log.
 * @returns {string} One of VALID_EFFORTS.
 */
function resolveEffort(operation) {
  if (operation) {
    const perOperation = readEffort(envVarForOperation(operation));
    if (perOperation) return perOperation;
  }
  return readEffort(GLOBAL_ENV_VAR) || DEFAULT_EFFORT;
}

/**
 * Effort for an operation, honouring the course's own setting first.
 *
 * Course settings are stored per pipeline stage rather than per operation —
 * that is the vocabulary the settings page and the usage report both use — so
 * the operation is mapped to its stage with `groupForOperation`. A stage the
 * course has not set, or a stored value the provider would reject, falls
 * through to the env vars exactly as if no course setting existed.
 *
 * @param {object} [settings] Course settings, as returned by the settings service.
 * @param {string} [operation] Operation label, e.g. "question-generate".
 * @returns {string} One of VALID_EFFORTS.
 */
function effortForStage(settings, operation) {
  const stored = settings?.reasoningEffort?.[groupForOperation(operation)];
  if (typeof stored === "string") {
    const value = stored.trim().toLowerCase();
    if (VALID_EFFORTS.includes(value)) return value;
  }
  return resolveEffort(operation);
}

// Test seam: the invalid-value warning is deliberately once-per-process.
function resetEffortWarnings() {
  warned.clear();
}

module.exports = {
  VALID_EFFORTS,
  DEFAULT_EFFORT,
  GLOBAL_ENV_VAR,
  envVarForOperation,
  resolveEffort,
  effortForStage,
  resetEffortWarnings,
};
