// One mechanism, two pools that must never share a cap. Grading is sized for a
// synchronised class: shedding there is not a delay, it is an ungraded answer
// and a manual-grading job. Generation is sized for a provider ceiling and
// never sheds, because an instructor already waits minutes.
const { LLMLimiter } = require('../../src/utils/llm-limiter');
const { gradingLimiter } = require('../../src/utils/grading-limiter');
const { generationLimiter } = require('../../src/utils/generation-limiter');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('LLMLimiter', () => {
  it('caps concurrency and queues the rest', async () => {
    const limiter = new LLMLimiter({ label: 'test', concurrency: 2, queueTimeoutMs: 0 });
    const gates = [deferred(), deferred(), deferred()];
    let started = 0;

    const runs = gates.map((gate) => limiter.run(async () => { started += 1; return gate.promise; }));

    await new Promise((r) => setImmediate(r));
    expect(started).toBe(2);

    gates[0].resolve('a');
    await runs[0];
    await new Promise((r) => setImmediate(r));
    expect(started).toBe(3);

    gates[1].resolve('b');
    gates[2].resolve('c');
    await Promise.all(runs);
  });

  it('never sheds a queued call when queueTimeoutMs is 0', async () => {
    jest.useFakeTimers();
    const limiter = new LLMLimiter({ label: 'test', concurrency: 1, queueTimeoutMs: 0 });
    const gate = deferred();
    const first = limiter.run(() => gate.promise);
    const second = limiter.run(async () => 'queued result');

    // A queue timeout would reject this; with shedding disabled it simply waits.
    jest.advanceTimersByTime(10 * 60 * 1000);
    gate.resolve('first result');

    await expect(first).resolves.toBe('first result');
    await expect(second).resolves.toBe('queued result');
    jest.useRealTimers();
  });

  it('names the limiter in its timeout error', async () => {
    const limiter = new LLMLimiter({ label: 'generation', concurrency: 1, callTimeoutMs: 10, queueTimeoutMs: 0 });
    await expect(limiter.run(() => new Promise(() => {}))).rejects.toThrow(/generation/);
  });

  it('ships a generation limiter that does not shed and allows long calls', () => {
    expect(generationLimiter.queueTimeoutMs).toBe(0);
    expect(generationLimiter.callTimeoutMs).toBe(120000);
    expect(generationLimiter.concurrency).toBe(6);
  });

  it('sizes grading for a full class rather than a handful of students', () => {
    // At 8 x ~1.7s per call only ~66 calls start within a 15s queue timeout, so
    // a synchronised class of 100 shed ~34 answers to manual grading. Grading
    // prompts are token-light, so width is the cheap fix.
    expect(gradingLimiter.concurrency).toBe(32);
    expect(gradingLimiter.queueTimeoutMs).toBe(60000);
    expect(gradingLimiter.callTimeoutMs).toBe(30000);
  });

  it('keeps the two pools independent', () => {
    // Separate instances: a generation run must not consume grading capacity
    // while students are mid-quiz, and vice versa.
    expect(generationLimiter).not.toBe(gradingLimiter);
    expect(generationLimiter.concurrency).not.toBe(gradingLimiter.concurrency);
  });
});
