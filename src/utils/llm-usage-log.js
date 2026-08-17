// Append-only usage log: one JSON line per LLM call.
//
// Written from the single place every provider call passes through
// (utils/structured-llm.js), so a new feature is instrumented by existing there
// rather than by remembering to log. Before this, usage was extracted on every
// call and then discarded by most callers — outlines and PDF vision recorded
// nothing at all, and the one path that did log printed to stdout, which is not
// somewhere a cost question can be answered from later.
//
// Token counts are recorded, not dollars. Prices are an assumption that gets
// corrected; tokens are a fact. Multiplying at write time bakes today's guess
// into history permanently, so cost is computed when the log is read.

const fs = require("fs");
const path = require("path");

const DEFAULT_LOG_PATH = path.join(__dirname, "..", "..", "logs", "llm-usage.jsonl");

/** Absolute path of the usage log. Read per call so tests and ops can redirect it. */
function usageLogPath() {
  return process.env.LLM_USAGE_LOG || DEFAULT_LOG_PATH;
}

/** Values that turn the log off, beyond the documented "false". */
const OFF_VALUES = new Set(["false", "0", "no", "off"]);

/**
 * On unless LLM_USAGE_LOG_ENABLED says otherwise. Accounting that has to be
 * switched on in advance is accounting you do not have when the cost question
 * arrives — which is the position this codebase was in before it existed.
 *
 * Several off-words are honoured rather than just "false": someone reaching for
 * the off switch writes whichever one comes to mind, and the failure mode of
 * being strict is a log still running after an operator believed they had
 * stopped it.
 *
 * Read per call rather than cached at import, so it can be flipped for an
 * investigation without a restart.
 */
function usageLogEnabled() {
  // Under test, only write when a path was named deliberately. generateStructured
  // records every call, so any suite that exercises it would otherwise append to
  // whoever's real log happens to be at the default path — inventing cost that
  // never happened, for models like "gpt-test".
  if (process.env.NODE_ENV === "test" && !process.env.LLM_USAGE_LOG) return false;

  const raw = process.env.LLM_USAGE_LOG_ENABLED;
  if (raw === undefined || raw === null) return true;
  return !OFF_VALUES.has(String(raw).trim().toLowerCase());
}

// Appends are serialized through one promise chain: concurrent LLM calls are
// the normal case here (the generation fan-out issues six at once), and
// unsequenced appends of lines this size can interleave into corrupt JSON.
let queue = Promise.resolve();

/**
 * Record one LLM call. Never throws and never rejects — instrumentation must not
 * be able to break the thing it measures — so callers can leave it unawaited.
 *
 * @param {object}  record
 * @param {string}  record.operation        What the call was for, e.g. "question-generate".
 * @param {string} [record.model]           Model that served it.
 * @param {string} [record.provider]        "openai" | "ollama".
 * @param {number} [record.promptTokens]
 * @param {number} [record.completionTokens]
 * @param {number} [record.ms]              Wall-clock duration.
 * @param {boolean}[record.ok]              False when the call threw. Defaults true.
 * @param {string} [record.error]           Message when ok is false.
 * @param {number} [record.images]          Image count, so vision calls are separable.
 * @returns {Promise<void>}
 */
function recordUsage(record = {}) {
  if (!usageLogEnabled()) return Promise.resolve();

  const promptTokens = Number(record.promptTokens) || 0;
  const completionTokens = Number(record.completionTokens) || 0;

  const row = {
    ts: new Date().toISOString(),
    operation: record.operation || "unknown",
    provider: record.provider,
    model: record.model,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    ms: record.ms,
    ok: record.ok !== false,
    ...(record.error ? { error: String(record.error) } : {}),
    ...(record.images ? { images: record.images } : {}),
  };

  queue = queue.then(async () => {
    try {
      const target = usageLogPath();
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.appendFile(target, `${JSON.stringify(row)}\n`, "utf8");
    } catch (error) {
      // Warn once per failure rather than escalating: a full disk or a bad
      // LLM_USAGE_LOG must not turn into a failed question generation.
      console.warn("⚠️ Could not write LLM usage log:", error.message);
    }
  });

  return queue;
}

/** Resolve once every queued append has settled. For tests and shutdown. */
function flushUsageLog() {
  return queue.then(() => undefined);
}

module.exports = { recordUsage, usageLogPath, usageLogEnabled, flushUsageLog };
