#!/usr/bin/env node
//
// Clear the LLM usage log so the next thing you do is measured on its own.
//
//   npm run usage:clear             # move the log aside, keeping it
//   npm run usage:clear -- --delete # remove it for good
//
// Archives rather than deletes by default. The usual reason to clear is to
// isolate one action, not to discard accumulated accounting — and the two are
// one typo apart. Archived files sit next to the log and are ignored by
// `npm run usage`, which only reads the active file.

const fs = require("fs");
const path = require("path");
const { usageLogPath } = require("../src/utils/llm-usage-log");

const target = usageLogPath();

if (!fs.existsSync(target)) {
  console.log(`No usage log at ${target} — nothing to clear.`);
  process.exit(0);
}

// Summarize before moving it, so what was cleared is visible rather than
// silently gone.
let rows = 0;
let totalTokens = 0;
let earliest = null;
let latest = null;

for (const line of fs.readFileSync(target, "utf8").split("\n")) {
  if (!line.trim()) continue;
  rows += 1;
  try {
    const parsed = JSON.parse(line);
    totalTokens += parsed.totalTokens || 0;
    const ts = Date.parse(parsed.ts);
    if (!Number.isNaN(ts)) {
      if (earliest === null || ts < earliest) earliest = ts;
      if (latest === null || ts > latest) latest = ts;
    }
  } catch {
    // A partially written last line should not stop the clear.
  }
}

const span =
  earliest !== null && latest !== null
    ? `${new Date(earliest).toISOString()} → ${new Date(latest).toISOString()}`
    : "no timestamps";

if (process.argv.includes("--delete")) {
  fs.rmSync(target);
  console.log(`Deleted ${rows} rows (${totalTokens.toLocaleString("en-US")} tokens, ${span}).`);
  process.exit(0);
}

// Second-resolution stamps collide when clearing twice in quick succession,
// which is exactly what happens while isolating several actions in a row.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = path.dirname(target);
const ext = path.extname(target);
const base = path.basename(target, ext);

let archive = path.join(dir, `${base}-${stamp}${ext}`);
let suffix = 1;
while (fs.existsSync(archive)) {
  archive = path.join(dir, `${base}-${stamp}-${suffix}${ext}`);
  suffix += 1;
}

fs.renameSync(target, archive);
console.log(
  `Archived ${rows} rows (${totalTokens.toLocaleString("en-US")} tokens, ${span})\n` +
    `  → ${archive}\n` +
    `Delete it yourself, or use --delete next time to skip the archive.`
);
