const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'llm-usage-clear.js');

let tmpDir;
let logPath;

const row = (operation) =>
  JSON.stringify({
    ts: new Date().toISOString(),
    operation,
    model: 'gpt-5.4-mini',
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    ok: true,
  });

const run = (args = []) =>
  execFileSync('node', [SCRIPT, ...args], {
    env: { ...process.env, LLM_USAGE_LOG: logPath },
    encoding: 'utf8',
  });

const archives = () =>
  fs.readdirSync(tmpDir).filter((name) => name.startsWith('llm-usage-') && name !== 'llm-usage.jsonl');

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-clear-'));
  logPath = path.join(tmpDir, 'llm-usage.jsonl');
  fs.writeFileSync(logPath, `${row('question-generate')}\n${row('outline-batch')}\n`);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('llm-usage-clear', () => {
  // Archiving rather than deleting: the usual reason to clear is to isolate the
  // next action, not to discard a day of accounting, and the two are one typo
  // apart.
  it('moves the log aside so the next run starts empty', () => {
    run();

    expect(fs.existsSync(logPath)).toBe(false);
    expect(archives()).toHaveLength(1);
    expect(fs.readFileSync(path.join(tmpDir, archives()[0]), 'utf8')).toContain('question-generate');
  });

  it('reports what it cleared so the loss is visible', () => {
    const output = run();

    expect(output).toMatch(/2 rows/);
    expect(output).toMatch(/240/); // total tokens across both rows
  });

  it('deletes outright when asked', () => {
    run(['--delete']);

    expect(fs.existsSync(logPath)).toBe(false);
    expect(archives()).toHaveLength(0);
  });

  it('is a no-op when there is no log yet', () => {
    fs.rmSync(logPath);

    const output = run();

    expect(output).toMatch(/nothing to clear/i);
    expect(archives()).toHaveLength(0);
  });

  it('does not collide when run twice in the same second', () => {
    run();
    fs.writeFileSync(logPath, `${row('question-review')}\n`);
    run();

    expect(archives()).toHaveLength(2);
  });
});
