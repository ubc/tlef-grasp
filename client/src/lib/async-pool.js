// Bounded-concurrency runner for independent async tasks.
//
// Question generation issues one request per granular objective, and those
// requests have no reason to wait for each other. This runs a fixed number at
// a time and — critically — reports results in INPUT order, so the questions a
// run produces are ordered by the objectives the instructor chose rather than
// by which request happened to finish first.
//
// It also reacts to provider rate limiting rather than charging through it:
// on a rate-limited rejection it pauses and halves its concurrency, because the
// binding limit is tokens-per-minute and retrying at the same width does not
// reduce token rate.

export class PoolAbortedError extends Error {
  constructor() {
    super('Generation stopped early because the AI provider rejected the run');
    this.name = 'PoolAbortedError';
  }
}

/**
 * @param {Array<() => Promise<any>>} tasks
 * @param {{ concurrency?: number, onRateLimit?: (error: Error) => number }} options
 *   `onRateLimit` returns how many milliseconds to pause before launching more.
 * @returns {Promise<Array<{status: 'fulfilled', value: any} | {status: 'rejected', reason: Error}>>}
 *   One entry per task, in input order.
 */
export function runPool(tasks, { concurrency = 4, onRateLimit } = {}) {
  const results = new Array(tasks.length);
  let limit = Math.max(1, concurrency);
  let next = 0;
  // Count of tasks truly in flight right now (launched, not yet settled).
  // `limit` can shrink mid-run when the provider rate-limits us, so every
  // launch attempt is gated on the *live* count against the *current* limit
  // rather than on a fixed set of worker slots claimed up front. A fixed-slot
  // design lets a surviving worker grab a new task the instant the limit
  // drops, even while other, soon-to-retire workers are still mid-flight on
  // their previous task — which momentarily runs more tasks than the halved
  // limit allows. Gating on the live count closes that gap: a new task only
  // launches once enough in-flight tasks have actually finished.
  let active = 0;
  let aborted = false;
  let pauseUntil = 0;
  let finished = false;
  let pauseTimer = null;

  return new Promise((resolveAll) => {
    const finishIfDone = () => {
      if (finished) return;
      const noMoreToLaunch = aborted || next >= tasks.length;
      if (!noMoreToLaunch || active > 0) return;

      finished = true;
      if (pauseTimer) clearTimeout(pauseTimer);
      // Tasks never launched because the run was aborted still need an
      // entry, so the caller can report them rather than see undefined holes.
      for (let i = 0; i < results.length; i += 1) {
        if (!results[i]) results[i] = { status: 'rejected', reason: new PoolAbortedError() };
      }
      resolveAll(results);
    };

    // Launches as many tasks as current capacity (limit - active) allows,
    // then does nothing until called again by a settling task, an elapsed
    // pause, or the initial kick-off below.
    const pump = () => {
      if (finished) return;
      if (aborted) {
        finishIfDone();
        return;
      }

      const waitMs = pauseUntil - Date.now();
      if (waitMs > 0) {
        if (!pauseTimer) pauseTimer = setTimeout(() => { pauseTimer = null; pump(); }, waitMs);
        return;
      }

      while (!aborted && active < limit && next < tasks.length) {
        const index = next;
        next += 1;
        active += 1;

        (async () => {
          try {
            const value = await tasks[index]();
            results[index] = { status: 'fulfilled', value };
          } catch (reason) {
            results[index] = { status: 'rejected', reason };

            if (reason?.fatal) {
              aborted = true;
            } else if (reason?.rateLimited) {
              const pauseMs = onRateLimit ? onRateLimit(reason) : 0;
              pauseUntil = Date.now() + (pauseMs || 0);
              limit = Math.max(1, Math.floor(limit / 2));
              // onRateLimit may set `fatal` when a circuit breaker trips.
              if (reason?.fatal) aborted = true;
            }
          } finally {
            active -= 1;
            pump();
          }
        })();
      }

      finishIfDone();
    };

    pump();
  });
}
