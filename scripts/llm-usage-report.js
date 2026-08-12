#!/usr/bin/env node
//
// Summarize the LLM usage log written by src/utils/llm-usage-log.js.
//
//   npm run usage                     # cost per pipeline stage
//   npm run usage -- --detail         # break each stage into its operations
//   npm run usage -- --since 1h       # last hour (also: 30m, 2d)
//   npm run usage -- --since 2026-08-12T03:00:00Z
//
// Dollars are computed here rather than stored per row: the price table is an
// assumption that gets corrected, and correcting it should fix history rather
// than only affect rows written from then on.

const fs = require("fs");
const { usageLogPath } = require("../src/utils/llm-usage-log");
const {
  OPERATION_GROUPS,
  OTHER_GROUP,
  groupForOperation,
  groupLabel,
} = require("../src/constants/llm-operations");

// Per 1M tokens (input / output). Verify against the provider's current pricing
// before trusting the dollar column — token counts are measured, these are not.
const PRICING = {
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-5.4": { input: 2.5, output: 10.0 },
  "gpt-5.4-mini": { input: 0.15, output: 0.6 },
};

const parseSince = (value) => {
  if (!value) return 0;
  const relative = /^(\d+)([mhd])$/.exec(value);
  if (relative) {
    const scale = { m: 60e3, h: 3600e3, d: 86400e3 }[relative[2]];
    return Date.now() - Number(relative[1]) * scale;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const cost = (model, promptTokens, completionTokens) => {
  const price = PRICING[model];
  if (!price) return null;
  return (promptTokens / 1e6) * price.input + (completionTokens / 1e6) * price.output;
};

const sinceArg = process.argv.indexOf("--since");
const since = parseSince(sinceArg === -1 ? null : process.argv[sinceArg + 1]);
const detail = process.argv.includes("--detail");

const target = usageLogPath();
if (!fs.existsSync(target)) {
  console.error(`No usage log at ${target}. Nothing has been recorded yet.`);
  process.exit(1);
}

const rows = fs
  .readFileSync(target, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter((row) => row && Date.parse(row.ts) >= since);

if (rows.length === 0) {
  console.log("No usage rows in that window.");
  process.exit(0);
}

const blank = () => ({ calls: 0, failed: 0, promptTokens: 0, completionTokens: 0, ms: 0, usd: 0 });
const add = (entry, row, usd) => {
  entry.calls += 1;
  if (row.ok === false) entry.failed += 1;
  entry.promptTokens += row.promptTokens || 0;
  entry.completionTokens += row.completionTokens || 0;
  entry.ms += row.ms || 0;
  if (usd !== null) entry.usd += usd;
};

const groups = new Map();
const unpricedModels = new Set();

for (const row of rows) {
  const group = groupForOperation(row.operation);
  const usd = cost(row.model, row.promptTokens || 0, row.completionTokens || 0);
  if (usd === null) unpricedModels.add(row.model);

  const bucket = groups.get(group) || { totals: blank(), operations: new Map() };
  add(bucket.totals, row, usd);

  const operation = row.operation || "unknown";
  const operationEntry = bucket.operations.get(operation) || blank();
  add(operationEntry, row, usd);
  bucket.operations.set(operation, operationEntry);
  groups.set(group, bucket);
}

// Pipeline order, with anything unmapped last so the total still reconciles.
const order = [...Object.keys(OPERATION_GROUPS), OTHER_GROUP].filter((g) => groups.has(g));

const num = (n) => n.toLocaleString("en-US");
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);
const line = (name, entry, indent = 0) =>
  pad(" ".repeat(indent) + name, 34) +
  padL(num(entry.calls), 7) + padL(num(entry.failed), 8) +
  padL(num(entry.promptTokens), 12) + padL(num(entry.completionTokens), 10) +
  padL(num(entry.promptTokens + entry.completionTokens), 12) +
  padL(`$${entry.usd.toFixed(4)}`, 10);

console.log(`\n${target}`);
console.log(`${rows.length} calls${since ? ` since ${new Date(since).toISOString()}` : ""}\n`);
console.log(
  pad("stage", 34) + padL("calls", 7) + padL("failed", 8) +
  padL("input", 12) + padL("output", 10) + padL("total", 12) + padL("est. $", 10)
);
console.log("-".repeat(93));

const totals = blank();
for (const group of order) {
  const { totals: groupTotals, operations } = groups.get(group);
  console.log(line(groupLabel(group), groupTotals));
  if (detail) {
    for (const [operation, entry] of [...operations].sort(
      (a, b) => b[1].promptTokens + b[1].completionTokens - (a[1].promptTokens + a[1].completionTokens)
    )) {
      console.log(line(operation, entry, 2));
    }
  }
  for (const key of ["calls", "failed", "promptTokens", "completionTokens", "usd"]) {
    totals[key] += groupTotals[key];
  }
}

console.log("-".repeat(93));
console.log(line("TOTAL", totals));

if (unpricedModels.size > 0) {
  console.log(`\nNo price entry for: ${[...unpricedModels].join(", ")} — those rows count tokens but not dollars.`);
}
console.log("");
