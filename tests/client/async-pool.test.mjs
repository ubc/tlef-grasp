import { jest, describe, it, expect } from '@jest/globals';
import { runPool } from '../../client/src/lib/async-pool.js';

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

  it('stops launching new tasks once a task fails fatally', async () => {
    let launched = 0;
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      launched += 1;
      if (i === 0) throw Object.assign(new Error('invalid api key'), { fatal: true });
      return i;
    });

    const results = await runPool(tasks, { concurrency: 1 });

    expect(launched).toBeLessThan(10);
    expect(results[9].status).toBe('rejected');
  });
});
