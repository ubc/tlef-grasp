import { jest, describe, it, expect } from '@jest/globals';
import { runPool, PoolAbortedError } from '../../client/src/lib/async-pool.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const rateLimited = () => Object.assign(new Error('rate limited'), { rateLimited: true });

describe('runPool', () => {
  it('never runs more than `concurrency` tasks at once', async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 10 }, () => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return 'ok';
    });

    await runPool(tasks, { concurrency: 3 });

    expect(peak).toBe(3);
  });

  it('returns results in input order, not completion order', async () => {
    // The slow task is first: a naive implementation would report it last and
    // scramble question order relative to the objectives the user chose.
    const tasks = [
      async () => { await new Promise((r) => setTimeout(r, 20)); return 'first'; },
      async () => 'second',
      async () => 'third',
    ];

    const results = await runPool(tasks, { concurrency: 3 });

    expect(results.map((r) => r.value)).toEqual(['first', 'second', 'third']);
  });

  it('keeps going when a task fails and reports it', async () => {
    const tasks = [
      async () => 'a',
      async () => { throw new Error('objective blew up'); },
      async () => 'c',
    ];

    const results = await runPool(tasks, { concurrency: 2 });

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'a' });
    expect(results[1].status).toBe('rejected');
    expect(results[1].reason.message).toBe('objective blew up');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'c' });
  });

  it('runs strictly sequentially at concurrency 1', async () => {
    const order = [];
    const tasks = [1, 2, 3].map((n) => async () => {
      order.push(`start-${n}`);
      await new Promise((r) => setTimeout(r, 1));
      order.push(`end-${n}`);
      return n;
    });

    await runPool(tasks, { concurrency: 1 });

    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);
  });

  it('halves concurrency after a rate-limit rejection', async () => {
    let active = 0;
    const peaks = [];
    const onRateLimit = jest.fn(() => 0);

    const tasks = Array.from({ length: 8 }, (_, i) => async () => {
      active += 1;
      peaks.push(active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      if (i === 0) throw rateLimited();
      return i;
    });

    await runPool(tasks, { concurrency: 4, onRateLimit });

    expect(onRateLimit).toHaveBeenCalled();
    // Tasks launched after the rate limit never exceed the halved cap.
    expect(Math.max(...peaks.slice(4))).toBeLessThanOrEqual(2);
  });

  it('calls onRateLimit with the rejection error', async () => {
    const error = rateLimited();
    const onRateLimit = jest.fn(() => 0);
    const tasks = [
      async () => { throw error; },
      async () => 'ok',
    ];

    await runPool(tasks, { concurrency: 2, onRateLimit });

    expect(onRateLimit).toHaveBeenCalledWith(error);
  });

  it('pauses launches for the duration onRateLimit returns', async () => {
    const pauseMs = 40;
    const onRateLimit = jest.fn(() => pauseMs);
    let rateLimitedAt = null;
    let secondStartedAt = null;

    // concurrency 1 so the second task cannot start until the first worker's
    // pause elapses — nothing else could be occupying the single slot.
    const tasks = [
      async () => {
        rateLimitedAt = Date.now();
        throw rateLimited();
      },
      async () => {
        secondStartedAt = Date.now();
        return 'second';
      },
    ];

    await runPool(tasks, { concurrency: 1, onRateLimit });

    expect(onRateLimit).toHaveBeenCalled();
    // Small negative tolerance for timer/Date.now() granularity, not for the
    // pool cutting the pause short.
    expect(secondStartedAt - rateLimitedAt).toBeGreaterThanOrEqual(pauseMs - 5);
  });

  it('does not wait out a rate-limit pause once all work has already settled', async () => {
    // Regression test: a naive pause implementation arms a timer as soon as
    // it sees a positive pause and only resolves when that timer fires, even
    // if every task already launched and finished settling. With a real
    // Retry-After of tens of seconds that stalls the UI long after there is
    // nothing left to wait for.
    const tasks = [
      async () => 'ok',
      async () => { throw rateLimited(); },
    ];

    const start = Date.now();
    const results = await runPool(tasks, { concurrency: 2, onRateLimit: () => 3000 });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(results[0]).toEqual({ status: 'fulfilled', value: 'ok' });
    expect(results[1].status).toBe('rejected');
  });

  it('stops launching new tasks once a task fails fatally', async () => {
    let launched = 0;
    const fatalError = Object.assign(new Error('invalid api key'), { fatal: true });
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      launched += 1;
      if (i === 0) throw fatalError;
      return i;
    });

    const results = await runPool(tasks, { concurrency: 1 });

    // At concurrency 1 there is only ever one task in flight, and it throws
    // synchronously, so exactly one task should ever launch — not merely
    // "fewer than 10".
    expect(launched).toBe(1);
    expect(results[0]).toEqual({ status: 'rejected', reason: fatalError });
    for (let i = 1; i < 10; i += 1) {
      expect(results[i].status).toBe('rejected');
      expect(results[i].reason).toBeInstanceOf(PoolAbortedError);
    }
  });

  it('lets already-launched siblings finish normally after a fatal rejection, backfilling only the unlaunched slots', async () => {
    const fatalError = Object.assign(new Error('invalid api key'), { fatal: true });
    const tasks = [
      async () => { await new Promise((r) => setTimeout(r, 5)); return 0; },
      async () => { throw fatalError; },
      async () => { await new Promise((r) => setTimeout(r, 5)); return 2; },
      async () => 3,
      async () => 4,
      async () => 5,
    ];

    const results = await runPool(tasks, { concurrency: 3 });

    // Tasks 0 and 2 were already in flight when task 1 aborted the pool —
    // they are not cancelled, so they complete normally. Tasks 3-5 were
    // never launched, so they get the abort placeholder, not the fatal error.
    expect(results[0]).toEqual({ status: 'fulfilled', value: 0 });
    expect(results[1]).toEqual({ status: 'rejected', reason: fatalError });
    expect(results[2]).toEqual({ status: 'fulfilled', value: 2 });
    for (let i = 3; i < 6; i += 1) {
      expect(results[i].status).toBe('rejected');
      expect(results[i].reason).toBeInstanceOf(PoolAbortedError);
    }
  });
});
