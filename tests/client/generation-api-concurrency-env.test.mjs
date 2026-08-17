// Finding 2 (final branch review): client concurrency must be env-tunable
// (VITE_GENERATION_CONCURRENCY) so the documented escape hatch — "set client
// concurrency to 1 to restore the old sequential behaviour" — can actually be
// used in a deployment, without a NaN ever reaching runPool (a NaN
// concurrency makes the pool hang forever: `active < limit` never launches
// anything).
//
// Vite inlines `import.meta.env.VITE_*` at build time, which plain Node/Jest
// cannot reproduce without a bundler in the loop. `resolveConcurrency` is the
// pure decision the wiring in `generateQuestions` delegates to, so the NaN
// guard and the "explicit option wins" rule stay testable here even though
// the actual `import.meta.env` read is not exercised by this suite.
import { describe, it, expect } from '@jest/globals';

const { resolveConcurrency } = await import('../../client/src/pages/question-generation/generationApi.js');

describe('resolveConcurrency', () => {
  it('falls back to the default when nothing is set', () => {
    expect(resolveConcurrency(undefined, undefined)).toBe(4);
  });

  it('never lets a malformed env value reach the caller as NaN', () => {
    expect(resolveConcurrency(undefined, 'not-a-number')).toBe(4);
    expect(Number.isNaN(resolveConcurrency(undefined, 'not-a-number'))).toBe(false);
  });

  it('ignores an env value of 0 or negative, which would stall the pool', () => {
    expect(resolveConcurrency(undefined, '0')).toBe(4);
    expect(resolveConcurrency(undefined, '-3')).toBe(4);
  });

  it('uses a well-formed env value', () => {
    expect(resolveConcurrency(undefined, '1')).toBe(1);
    expect(resolveConcurrency(undefined, '8')).toBe(8);
  });

  it('lets an explicit concurrency option win over the env value', () => {
    expect(resolveConcurrency(2, '8')).toBe(2);
  });
});
