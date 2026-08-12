const fs = require('fs');
const os = require('os');
const path = require('path');

const { recordUsage, usageLogPath, flushUsageLog } = require('../../src/utils/llm-usage-log');

let tmpDir;
const saved = {};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-log-'));
  saved.path = process.env.LLM_USAGE_LOG;
  saved.enabled = process.env.LLM_USAGE_LOG_ENABLED;
  process.env.LLM_USAGE_LOG = path.join(tmpDir, 'nested', 'llm-usage.jsonl');
  process.env.LLM_USAGE_LOG_ENABLED = 'true';
});

afterEach(() => {
  for (const [key, envName] of [['path', 'LLM_USAGE_LOG'], ['enabled', 'LLM_USAGE_LOG_ENABLED']]) {
    if (saved[key] === undefined) delete process.env[envName];
    else process.env[envName] = saved[key];
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const readLines = () =>
  fs
    .readFileSync(process.env.LLM_USAGE_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

describe('recordUsage', () => {
  it('appends one JSON line per call', async () => {
    await recordUsage({ operation: 'question-generate', model: 'gpt-5.4-mini', promptTokens: 6412, completionTokens: 688 });
    await recordUsage({ operation: 'material-outline', model: 'gpt-5.4-mini', promptTokens: 20000, completionTokens: 1500 });
    await flushUsageLog();

    const lines = readLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      operation: 'question-generate',
      model: 'gpt-5.4-mini',
      promptTokens: 6412,
      completionTokens: 688,
      totalTokens: 7100,
    });
    expect(lines[1].operation).toBe('material-outline');
  });

  it('timestamps every row so usage can be attributed to a window of work', async () => {
    await recordUsage({ operation: 'question-review', model: 'm', promptTokens: 1, completionTokens: 2 });
    await flushUsageLog();

    expect(Date.parse(readLines()[0].ts)).not.toBeNaN();
  });

  // A call that threw still consumed a request, and often tokens. Dropping those
  // rows would make the log quietly disagree with the provider's bill.
  it('records failed calls', async () => {
    await recordUsage({ operation: 'question-generate', model: 'm', ok: false, error: 'Empty response from LLM' });
    await flushUsageLog();

    const row = readLines()[0];
    expect(row.ok).toBe(false);
    expect(row.error).toBe('Empty response from LLM');
    expect(row.totalTokens).toBe(0);
  });

  it('defaults ok to true when a call is not reported as failed', async () => {
    await recordUsage({ operation: 'x', model: 'm', promptTokens: 1, completionTokens: 1 });
    await flushUsageLog();

    expect(readLines()[0].ok).toBe(true);
  });

  // Instrumentation must never be able to break the thing it measures.
  it('never throws when the log cannot be written', async () => {
    process.env.LLM_USAGE_LOG = path.join(tmpDir, 'a-file');
    fs.writeFileSync(process.env.LLM_USAGE_LOG, '');
    // A path whose parent is a file, not a directory — mkdir will fail.
    process.env.LLM_USAGE_LOG = path.join(tmpDir, 'a-file', 'nope.jsonl');

    await expect(
      recordUsage({ operation: 'x', model: 'm', promptTokens: 1, completionTokens: 1 })
    ).resolves.toBeUndefined();
    await expect(flushUsageLog()).resolves.toBeUndefined();
  });
});

// On by default: accounting you have to remember to switch on is accounting you
// do not have when the cost question arrives. LLM_USAGE_LOG_ENABLED=false is the
// opt-out.
describe('the LLM_USAGE_LOG_ENABLED gate', () => {
  it('records when the flag is unset', async () => {
    delete process.env.LLM_USAGE_LOG_ENABLED;

    await recordUsage({ operation: 'x', model: 'm', promptTokens: 1, completionTokens: 1 });
    await flushUsageLog();

    expect(readLines()).toHaveLength(1);
  });

  it('writes nothing when the flag is false', async () => {
    process.env.LLM_USAGE_LOG_ENABLED = 'false';

    await recordUsage({ operation: 'x', model: 'm', promptTokens: 1, completionTokens: 1 });
    await flushUsageLog();

    expect(fs.existsSync(process.env.LLM_USAGE_LOG)).toBe(false);
  });

  it('reads false regardless of case or surrounding space', async () => {
    process.env.LLM_USAGE_LOG_ENABLED = ' FALSE ';

    await recordUsage({ operation: 'x', model: 'm', promptTokens: 1, completionTokens: 1 });
    await flushUsageLog();

    expect(fs.existsSync(process.env.LLM_USAGE_LOG)).toBe(false);
  });

  // Someone reaching for the off switch writes whichever falsy word comes to
  // mind. Ignoring those would leave the log quietly running after an operator
  // believed they had turned it off — the one failure mode this flag exists to
  // prevent.
  it.each(['0', 'no', 'off'])('treats %s as off', async (value) => {
    process.env.LLM_USAGE_LOG_ENABLED = value;

    await recordUsage({ operation: 'x', model: 'm', promptTokens: 1, completionTokens: 1 });
    await flushUsageLog();

    expect(fs.existsSync(process.env.LLM_USAGE_LOG)).toBe(false);
  });

  // Read per call, not at import time, so flipping it does not need a restart
  // and tests cannot leak state into each other.
  it('is read per call rather than cached at module load', async () => {
    process.env.LLM_USAGE_LOG_ENABLED = 'false';
    await recordUsage({ operation: 'skipped', model: 'm', promptTokens: 1, completionTokens: 1 });
    delete process.env.LLM_USAGE_LOG_ENABLED;
    await recordUsage({ operation: 'kept', model: 'm', promptTokens: 1, completionTokens: 1 });
    await flushUsageLog();

    const lines = readLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].operation).toBe('kept');
  });
});

describe('usageLogPath', () => {
  it('honours LLM_USAGE_LOG', () => {
    process.env.LLM_USAGE_LOG = '/tmp/custom.jsonl';
    expect(usageLogPath()).toBe('/tmp/custom.jsonl');
  });

  it('falls back to logs/llm-usage.jsonl under the project root', () => {
    delete process.env.LLM_USAGE_LOG;
    expect(usageLogPath().endsWith(path.join('logs', 'llm-usage.jsonl'))).toBe(true);
  });
});
