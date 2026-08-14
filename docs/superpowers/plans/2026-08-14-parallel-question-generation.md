# Parallel Question Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run granular-objective question batches concurrently instead of one at a time, and handle provider rate limiting so a run slows down and finishes rather than silently losing objectives.

**Architecture:** The client flattens its nested generation loops into one task per granular objective and runs them through a bounded pool (default 4 in flight), assembling results in objective order. The limiter mechanism moves into its own module and grows two independent pools — `generationLimiter` wrapping every generation, review, fix and retrieval call, and a widened `gradingLimiter` sized for a whole class answering at once. Rate-limit failures stop being flattened to HTTP 500 and are returned as 429 with `Retry-After`, which the client pool reacts to by pausing and halving its concurrency.

**Tech Stack:** Node/Express, MongoDB, Jest (server, CommonJS), React 18 + Vite (client, native ESM), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-08-14-parallel-question-generation-design.md`

## Global Constraints

- A single batch must behave bit-for-bit as it does today: the conversational loop, sibling constraint, exact-match dedup, review and fix are all unchanged.
- Client concurrency default **4**, server limiter concurrency default **6**; both env-tunable. Client concurrency of 1 must reproduce today's sequential behaviour exactly.
- The two limiters are **separate instances in separate modules** and never share a cap: a generation run must not consume grading capacity while students are mid-quiz. Generation: concurrency 6, **no queue shedding**, 120000 ms call timeout. Grading: concurrency 32, 60000 ms queue timeout, 30000 ms call timeout.
- Server tests are CommonJS under `tests/unit/` (`*.test.js`) and run with `npm test`. Client tests are native ESM under `tests/client/` and MUST be named `*.test.mjs` — the root package.json is CommonJS, so a `.js` test is loaded via require() and rejects the top-level await that `jest.unstable_mockModule` requires. Run with `npm run test:client`; no Babel, no new dependencies.
- Nothing is persisted to MongoDB during generation, so retrying a failed objective is safe.
- Commit after every task.

---

### Task 1: Split the limiter mechanism from its two pools, and widen grading

Two changes, one structural and one about capacity.

**Structural.** The limiter class is currently grading-specific in three ways that block reuse: its name, its hardcoded "grading" error strings, and `_acquire()` always arming a queue-timeout timer. The mechanism moves to its own module, and the two pools become separate modules with their own tuning — generation traffic and grading traffic must never share a cap or a config.

**Capacity.** Grading's current settings shed under class-sized load. Measured grading latency is a median of 1,716 ms (p90 2,592 ms), so concurrency 8 starts roughly 66 calls within the 15s queue timeout; a synchronised class of 100 sheds ~34 answers, and 300 sheds ~234. Shedding is not a delay — grading runs inside the student's answer-check request, so a shed answer is saved ungraded, the student gets no feedback, and the instructor grades it by hand.

Grading calls are token-light (a question, an answer, a rubric) next to generation's 50 retrieved chunks, so they can run far wider without threatening the same tokens-per-minute ceiling. New defaults: **concurrency 32**, **queue timeout 60s**. At 32 the same 1,000-student burst drains in about 56s with nothing shed, and the 60s timeout stops being a trapdoor and becomes what it was meant to be — a safety valve for genuinely pathological load. The limiter's existing 429 backoff holds the slot, so a too-wide setting self-throttles instead of stampeding.

Generation needs no queue shedding at all — and passing a huge `queueTimeoutMs` is not a workaround, because `setTimeout` with a delay above 2147483647 fires immediately.

**Files:**
- Create: `src/utils/llm-limiter.js` (the mechanism)
- Create: `src/utils/generation-limiter.js` (the generation pool)
- Modify: `src/utils/grading-limiter.js` (becomes the grading pool only)
- Test: `tests/unit/llm-limiter.utils.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `src/utils/llm-limiter.js` exports `LLMLimiter` (constructor options `{ label, concurrency, callTimeoutMs, queueTimeoutMs, maxRetries, backoffBaseMs }`, method `run(fn)`) and `isRetryableLLMError(error)`. A `queueTimeoutMs` of `0` means "never shed".
  - `src/utils/grading-limiter.js` exports `gradingLimiter` (concurrency 32, queue timeout 60s, call timeout 30s) and re-exports `isRetryableLLMError` so existing importers keep working.
  - `src/utils/generation-limiter.js` exports `generationLimiter` (concurrency 6, queue timeout 0, call timeout 120s).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/llm-limiter.utils.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/llm-limiter.utils.test.js`
Expected: FAIL — `LLMLimiter is not a constructor` and `generationLimiter` undefined.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/llm-limiter.js` by moving the existing class out of `grading-limiter.js` — the whole file except its final two lines (the `gradingLimiter` instance and the `module.exports`). Then apply four changes to what you moved:

1. Rename `class GradingLimiter` to `class LLMLimiter`.
2. Add `this.label = options.label ?? 'LLM';` as the first line of the constructor.
3. Drop the `envInt(...)` fallbacks from the constructor's option resolution, so it reads `options.concurrency ?? DEFAULTS.concurrency` and so on. Env handling moves to the pool modules, which each own their own variable names.
4. Replace the queue and timeout internals:

```javascript
    _acquire() {
        if (this.active < this.concurrency) {
            this.active += 1;
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const waiter = { resolve, timer: null };
            // queueTimeoutMs of 0 means "never shed". Arming a timer with a
            // huge delay is not an alternative — setTimeout fires immediately
            // past 2147483647ms.
            if (this.queueTimeoutMs > 0) {
                waiter.timer = setTimeout(() => {
                    const idx = this.queue.indexOf(waiter);
                    if (idx !== -1) this.queue.splice(idx, 1);
                    reject(new Error(`LLM ${this.label} queue full — waited ${this.queueTimeoutMs}ms`));
                }, this.queueTimeoutMs);
            }
            this.queue.push(waiter);
        });
    }

    _release() {
        const next = this.queue.shift();
        if (next) {
            if (next.timer) clearTimeout(next.timer);
            next.resolve();
        } else {
            this.active -= 1;
        }
    }

    _withTimeout(promise) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(new Error(`LLM ${this.label} call timed out after ${this.callTimeoutMs}ms`)),
                this.callTimeoutMs
            );
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }
```

Export the mechanism and keep `envInt` exported for the pool modules:

```javascript
module.exports = { LLMLimiter, isRetryableLLMError, envInt };
```

Replace the whole of `src/utils/grading-limiter.js` with the grading pool only:

```javascript
// Concurrency guard for student-facing LLM grading calls (open-ended judge,
// fill-in-the-blank rescue). The mechanism lives in llm-limiter.js; this file
// is only the pool and its sizing.
//
// Sizing is set by the worst realistic case: a synchronised class answering at
// once. Grading runs inside the student's answer-check request, so a shed call
// is not a delay — the answer is saved ungraded, the student gets no feedback,
// and the instructor grades it by hand.
//
// Measured grading latency is ~1.7s median. At the old concurrency of 8 only
// ~66 calls could start within the old 15s queue timeout, so a class of 100
// answering together shed ~34 answers and a class of 300 shed ~234. Grading
// prompts are token-light next to question generation's retrieved material, so
// running much wider is cheap: at 32, a 1,000-student burst drains in under a
// minute with nothing shed, and the 60s queue timeout is a safety valve rather
// than a trapdoor.
//
// A width that outruns the provider self-corrects: a 429 retries with backoff
// while holding its slot, which throttles the whole pool.

const { LLMLimiter, isRetryableLLMError, envInt } = require('./llm-limiter');

const gradingLimiter = new LLMLimiter({
    label: 'grading',
    concurrency: envInt('GRADING_LLM_CONCURRENCY', 32),
    callTimeoutMs: envInt('GRADING_LLM_TIMEOUT_MS', 30000),
    queueTimeoutMs: envInt('GRADING_LLM_QUEUE_TIMEOUT_MS', 60000),
    maxRetries: envInt('GRADING_LLM_MAX_RETRIES', 2),
});

// Re-exported so existing importers of this module keep working unchanged.
module.exports = { gradingLimiter, isRetryableLLMError };
```

Create `src/utils/generation-limiter.js`:

```javascript
// Concurrency guard for instructor-facing question generation: the generation
// turns, the review pass, the fix loop, and the RAG retrieval each objective
// performs. Shared across all four so they cannot independently saturate the
// provider, and deliberately separate from the grading pool so a generation
// run cannot eat capacity students are relying on mid-quiz.
//
// Two settings differ from grading for the same underlying reason — nobody is
// staring at a spinner that a shed call would cut short:
//   - queueTimeoutMs 0: never shed. An instructor already waits minutes;
//     failing an objective to save seconds of queueing is a bad trade.
//   - callTimeoutMs 120000: generation reaches p90 41s and max 51s at high
//     reasoning effort, so grading's 30s cap would abort legitimate work.

const { LLMLimiter, envInt } = require('./llm-limiter');

const generationLimiter = new LLMLimiter({
    label: 'generation',
    concurrency: envInt('GENERATION_LLM_CONCURRENCY', 6),
    callTimeoutMs: envInt('GENERATION_LLM_TIMEOUT_MS', 120000),
    queueTimeoutMs: 0,
    maxRetries: envInt('GENERATION_LLM_MAX_RETRIES', 3),
});

module.exports = { generationLimiter };
```

- [ ] **Step 4: Verify no stale references**

`src/services/answer-grading.js` imports `{ gradingLimiter }` from `grading-limiter.js`, which still exports it, so that import is unchanged.

Run: `grep -rn "GradingLimiter" src/ tests/`
Expected: no matches at all — the class name is gone. Fix any that appear.

Run: `grep -rn "require.*grading-limiter" src/`
Expected: only `src/services/answer-grading.js`. Anything else should be importing from `llm-limiter.js` or `generation-limiter.js` instead.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/unit/llm-limiter.utils.test.js && npm test`
Expected: new suite passes; all pre-existing suites still pass.

- [ ] **Step 6: Commit**

```bash
git add src/utils/llm-limiter.js src/utils/grading-limiter.js src/utils/generation-limiter.js tests/unit/llm-limiter.utils.test.js
git commit -m "Split the LLM limiter into its mechanism and two pools, widen grading"
```

---

### Task 2: Put generation, review, fix and retrieval under the limiter

**Files:**
- Modify: `src/controllers/rag-llm.js` (the three `generateStructured` calls: `question-generate`, `question-review`, `question-fix`)
- Modify: `src/services/rag-fanout.js:41,47` (both `instance.retrieveContext` calls)
- Test: `tests/unit/generation-limiter-wiring.test.js` (create)

**Interfaces:**
- Consumes: `generationLimiter.run(fn)` from Task 1.
- Produces: no new exports. Every provider call made by a generation request now runs inside `generationLimiter`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/generation-limiter-wiring.test.js`:

```javascript
// Four concurrent objectives issue roughly 16 provider calls plus ~20
// retrieval embeddings. Anything left outside the limiter relocates the 429s
// instead of preventing them, so both paths are asserted.
const mockRun = jest.fn((fn) => fn());

jest.mock('../../src/utils/generation-limiter', () => ({
  generationLimiter: { run: mockRun },
}));

const { retrieveForSource } = require('../../src/services/rag-fanout');

describe('retrieval runs under the generation limiter', () => {
  beforeEach(() => mockRun.mockClear());

  it('wraps the first search', async () => {
    const instance = { retrieveContext: jest.fn().mockResolvedValue([{ content: 'a' }]) };

    await retrieveForSource(instance, 'source-1', 'query', 50, 0.6);

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(instance.retrieveContext).toHaveBeenCalledTimes(1);
  });

  it('wraps the no-threshold retry too', async () => {
    const instance = {
      retrieveContext: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ content: 'b' }]),
    };

    await retrieveForSource(instance, 'source-1', 'query', 50, 0.6);

    // Both the thresholded search and its retry are capped.
    expect(mockRun).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/generation-limiter-wiring.test.js`
Expected: FAIL — `expect(mockRun).toHaveBeenCalledTimes(1)` receives 0, because retrieval does not use the limiter yet.

- [ ] **Step 3: Write minimal implementation**

In `src/services/rag-fanout.js`, add the import at the top:

```javascript
const { generationLimiter } = require('../utils/generation-limiter');
```

and wrap both calls inside `retrieveForSource`:

```javascript
  // Under the generation limiter: each objective issues 3-5 searches, each
  // preceded by an embedding call, so concurrent objectives multiply fast.
  let chunks = await generationLimiter.run(() =>
    instance.retrieveContext(query, { limit, scoreThreshold, filter })
  );

  if ((!chunks || chunks.length === 0) && scoreThreshold !== undefined) {
    console.log(
      `⚠️ Score threshold ${scoreThreshold} returned 0 chunks for material ${sourceId} — retrying without threshold`
    );
    chunks = await generationLimiter.run(() =>
      instance.retrieveContext(query, { limit, filter })
    );
  }
```

In `src/controllers/rag-llm.js`, add to the imports:

```javascript
const { generationLimiter } = require('../utils/generation-limiter');
```

Then wrap each of the three `generateStructured` calls. The generation call inside `generateOneQuestion`:

```javascript
            const response = await generationLimiter.run(() => generateStructured({
              messages,
              schema: model.getJsonSchema(),
              operation: 'question-generate',
              effort: effortForStage(settings, 'question-generate'),
            }));
```

The review call inside `rateQuestions`:

```javascript
  const { content: responseContent, usage } = await generationLimiter.run(() => generateStructured({
    prompt,
    schema: QUESTION_REVIEW_SCHEMA,
    operation: 'question-review',
    model: getReviewModel() || null,
    effort,
  }));
```

The fix call inside `attemptFix`:

```javascript
      const response = await generationLimiter.run(() => generateStructured({
        messages,
        schema: model.getJsonSchema(),
        operation: 'question-fix',
        effort,
      }));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/generation-limiter-wiring.test.js && npm test`
Expected: new suite passes. Pre-existing generation suites still pass — they mock `generateStructured`, and the real limiter runs `fn()` directly with capacity free.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/rag-llm.js src/services/rag-fanout.js tests/unit/generation-limiter-wiring.test.js
git commit -m "Run generation, review, fix and retrieval under the generation limiter"
```

---

### Task 3: Stop retrying rate limits inside the question slot

`generateOneQuestion` retries every failure up to `maxRetries` (3). Stacked on the limiter's own retries that is up to 9 attempts against a provider already refusing. Content failures (schema invalid, duplicate, empty) should still retry — a different sample may well be valid — but a 429 that survived the limiter means the provider is saturated, and retrying only adds load.

**Files:**
- Modify: `src/controllers/rag-llm.js` (the `catch` inside `generateOneQuestion`'s attempt loop)
- Test: `tests/unit/question-generation-retry-policy.test.js` (create)

**Interfaces:**
- Consumes: `isRetryableLLMError` from Task 1.
- Produces: no new exports. A rate-limit error thrown by generation now aborts that slot immediately and propagates.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/question-generation-retry-policy.test.js`:

```javascript
// The limiter owns rate-limit retries. The slot loop owns content retries.
// Doing both means up to 9 attempts at a provider already saying no.
const mockGenerateStructured = jest.fn();

jest.mock('../../src/services/rag', () => ({
  getLearningObjectiveRagContent: jest.fn().mockResolvedValue('Relevant material'),
}));
jest.mock('../../src/services/llm', () => ({ isReady: jest.fn(() => true) }));
jest.mock('../../src/services/question', () => ({
  getQuestionTextsByGranularObjective: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../src/services/settings', () => ({ getSettings: jest.fn().mockResolvedValue(null) }));
jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/utils/co-instructor-permissions', () => ({
  assertCoInstructorPermission: jest.fn().mockResolvedValue(true),
  PERMISSION_KEYS: { QUESTION_GENERATION: 'questionGeneration' },
}));
jest.mock('../../src/utils/ta-permissions', () => ({
  assertTaPermission: jest.fn().mockResolvedValue(true),
  TA_PERMISSION_KEYS: { QUESTION_GENERATION: 'questionGeneration' },
}));
jest.mock('../../src/utils/llm-provider', () => ({
  getLLMModel: jest.fn(() => 'test-model'),
  getReviewModel: jest.fn(() => 'test-review-model'),
  getLLMProvider: jest.fn(() => 'openai'),
}));
jest.mock('../../src/utils/structured-llm', () => ({ generateStructured: mockGenerateStructured }));

const { generateQuestionsWithRagHandler } = require('../../src/controllers/rag-llm');

const buildRequest = () => ({
  body: {
    courseId: 'course-1',
    courseName: 'Biology',
    learningObjectiveId: 'objective-1',
    learningObjectiveText: 'Explain cellular energy',
    granularLearningObjectiveId: 'granular-1',
    granularLearningObjectiveText: 'Explain ATP production',
    bloomLevels: ['Understand'],
    count: 1,
  },
});

const buildResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

const rateLimitError = () => {
  const error = new Error('429 Rate limit reached for gpt-5.6-luna');
  error.status = 429;
  return error;
};

describe('question slot retry policy', () => {
  beforeEach(() => mockGenerateStructured.mockReset());

  it('does not retry the slot after a rate-limit failure', async () => {
    mockGenerateStructured.mockRejectedValue(rateLimitError());

    await generateQuestionsWithRagHandler(buildRequest(), buildResponse());

    // Exactly one generation attempt, not three.
    expect(mockGenerateStructured).toHaveBeenCalledTimes(1);
  });

  it('still retries a content failure', async () => {
    mockGenerateStructured
      .mockResolvedValueOnce({ content: 'not json at all', usage: {} })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          scratchwork: 'Checked.',
          question: 'What powers active transport?',
          options: {
            A: { text: 'Option A', feedback: '' },
            B: { text: 'Option B', feedback: 'Not B.' },
            C: { text: 'Option C', feedback: 'Not C.' },
            D: { text: 'Option D', feedback: 'Not D.' },
          },
          correctAnswer: 'A',
          explanation: 'Because.',
        }),
        usage: {},
      })
      .mockResolvedValue({
        content: JSON.stringify({ ratings: [{ questionId: '0', reasoning: 'ok', flagged: false, issue: '' }] }),
        usage: {},
      });

    await generateQuestionsWithRagHandler(buildRequest(), buildResponse());

    const generateCalls = mockGenerateStructured.mock.calls.filter(
      (call) => call[0].operation === 'question-generate'
    );
    expect(generateCalls).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/question-generation-retry-policy.test.js`
Expected: FAIL — the first test sees 3 calls, because the slot retries the 429.

- [ ] **Step 3: Write minimal implementation**

In `src/controllers/rag-llm.js`, add the predicate import alongside the limiter one from Task 2:

```javascript
const { generationLimiter } = require('../utils/generation-limiter');
const { isRetryableLLMError } = require('../utils/llm-limiter');
```

In `generateOneQuestion`'s `catch (error)` block, re-throw rate-limit errors before recording the attempt:

```javascript
          } catch (error) {
            // The limiter already retried this with backoff. A rate limit that
            // reaches here means the provider is saturated, so retrying the
            // slot adds load without improving the odds. Content failures —
            // invalid schema, duplicate, empty — still retry: a fresh sample
            // may well be valid.
            if (isRetryableLLMError(error)) throw error;
            lastError = error;
```

The rest of the `catch` body is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/question-generation-retry-policy.test.js && npm test`
Expected: both new tests pass; all pre-existing suites pass.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/rag-llm.js tests/unit/question-generation-retry-policy.test.js
git commit -m "Leave rate-limit retries to the limiter, not the question slot"
```

---

### Task 4: Return 429 with Retry-After instead of a blanket 500

`returnErrorResponse` maps every failure to HTTP 500 with "Question generation service is currently unavailable", so a provider 429 is indistinguishable from a bug and the client cannot react.

**Files:**
- Modify: `src/controllers/rag-llm.js:67` (`returnErrorResponse`)
- Test: `tests/unit/generation-rate-limit-status.test.js` (create)

**Interfaces:**
- Consumes: `isRetryableLLMError`, already imported into `rag-llm.js` by Task 3.
- Produces: generation endpoints respond `429` with a `Retry-After` header (seconds, integer) and `{ success: false, error, rateLimited: true }` when the underlying failure is a rate limit; every other failure keeps its current 500 shape.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/generation-rate-limit-status.test.js`:

```javascript
// The client pool decides whether to pause and shrink concurrency based on
// this status. Flattening a 429 into a 500 makes "slow down" look like "broken".
const express = require('express');
const request = require('supertest');

const mockGenerateStructured = jest.fn();

jest.mock('../../src/services/rag', () => ({
  getLearningObjectiveRagContent: jest.fn().mockResolvedValue('Relevant material'),
}));
jest.mock('../../src/services/llm', () => ({ isReady: jest.fn(() => true) }));
jest.mock('../../src/services/question', () => ({
  getQuestionTextsByGranularObjective: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../src/services/settings', () => ({ getSettings: jest.fn().mockResolvedValue(null) }));
jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/utils/co-instructor-permissions', () => ({
  assertCoInstructorPermission: jest.fn().mockResolvedValue(true),
  PERMISSION_KEYS: { QUESTION_GENERATION: 'questionGeneration' },
}));
jest.mock('../../src/utils/ta-permissions', () => ({
  assertTaPermission: jest.fn().mockResolvedValue(true),
  TA_PERMISSION_KEYS: { QUESTION_GENERATION: 'questionGeneration' },
}));
jest.mock('../../src/utils/llm-provider', () => ({
  getLLMModel: jest.fn(() => 'test-model'),
  getReviewModel: jest.fn(() => 'test-review-model'),
  getLLMProvider: jest.fn(() => 'openai'),
}));
jest.mock('../../src/utils/structured-llm', () => ({ generateStructured: mockGenerateStructured }));

const { generateQuestionsWithRagHandler } = require('../../src/controllers/rag-llm');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post('/generate', generateQuestionsWithRagHandler);
  return app;
};

const body = {
  courseId: 'course-1',
  courseName: 'Biology',
  learningObjectiveId: 'objective-1',
  learningObjectiveText: 'Explain cellular energy',
  granularLearningObjectiveId: 'granular-1',
  granularLearningObjectiveText: 'Explain ATP production',
  bloomLevels: ['Understand'],
  count: 1,
};

describe('generation rate-limit status', () => {
  beforeEach(() => mockGenerateStructured.mockReset());

  it('answers 429 with Retry-After when the provider rate limits', async () => {
    const error = new Error('429 Rate limit reached');
    error.status = 429;
    mockGenerateStructured.mockRejectedValue(error);

    const response = await request(buildApp()).post('/generate').send(body).expect(429);

    expect(response.headers['retry-after']).toBeDefined();
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(response.body.rateLimited).toBe(true);
  });

  it('still answers 500 for an ordinary failure', async () => {
    mockGenerateStructured.mockRejectedValue(new Error('schema exploded'));

    const response = await request(buildApp()).post('/generate').send(body).expect(500);
    expect(response.body.rateLimited).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/generation-rate-limit-status.test.js`
Expected: FAIL — the first test receives 500 instead of 429.

- [ ] **Step 3: Write minimal implementation**

Replace `returnErrorResponse` in `src/controllers/rag-llm.js`:

```javascript
// Default seconds to wait when the provider rate limits without saying for how
// long. The client pool honours this before launching more work.
const DEFAULT_RETRY_AFTER_SECONDS = 20;

// Simple error response function. A provider rate limit is reported as 429 with
// Retry-After rather than 500: the client pool pauses and halves its
// concurrency on 429, and cannot do either if every failure looks the same.
function returnErrorResponse(res, error, details = null) {
  console.error("Question generation failed:", error);

  if (isRetryableLLMError(error)) {
    const headerValue =
      error?.headers?.['retry-after'] ?? error?.response?.headers?.['retry-after'];
    const parsed = parseInt(headerValue, 10);
    const retryAfter = Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_RETRY_AFTER_SECONDS;
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      success: false,
      rateLimited: true,
      retryAfterSeconds: retryAfter,
      error: "The AI provider is rate limiting this request. Generation will slow down and retry.",
      details: details || error.message,
    });
  }

  res.status(500).json({
    success: false,
    error: "Question generation service is currently unavailable",
    details: details || error.message,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/generation-rate-limit-status.test.js && npm test`
Expected: both new tests pass; all pre-existing suites pass.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/rag-llm.js tests/unit/generation-rate-limit-status.test.js
git commit -m "Return 429 with Retry-After when the provider rate limits generation"
```

---

### Task 5: A bounded async pool for the client, with its own test harness

The client has no test infrastructure. Jest cannot parse the client's ESM (verified: `SyntaxError: Cannot use import statement outside a module`), and adding Babel would mean new dependencies. A second Jest config running native ESM under `--experimental-vm-modules` works with zero new dependencies (verified). The pool is pure logic with no React or DOM dependency, so it is directly testable this way.

**Files:**
- Create: `client/src/lib/async-pool.js`
- Create: `jest.client.config.mjs`
- Create: `tests/client/async-pool.test.mjs`
- Modify: `package.json` (add `test:client` script)

**Interfaces:**
- Consumes: nothing.
- Produces: `runPool(tasks, { concurrency, onRateLimit })` exported from `client/src/lib/async-pool.js`. `tasks` is an array of `() => Promise<T>`. Returns `Promise<Array<{ status: 'fulfilled', value: T } | { status: 'rejected', reason: Error }>>` **in input order**. `onRateLimit(error)` is invoked when a task rejects with `error.rateLimited === true`; returning a number from it pauses the pool that many milliseconds and halves concurrency. A task rejecting with `error.fatal === true` stops the pool launching further tasks; remaining tasks resolve as `{ status: 'rejected', reason }` with a `PoolAbortedError`.

- [ ] **Step 1: Add the client test harness**

Create `jest.client.config.mjs`:

```javascript
/**
 * Client-side unit tests for pure logic (no React, no DOM).
 *
 * The client is native ESM ("type": "module"), which the server's CommonJS
 * Jest config cannot parse. Rather than add Babel and its dependencies, this
 * config runs Jest's native ESM support — hence the --experimental-vm-modules
 * flag in the npm script and the empty transform.
 *
 * @type {import('jest').Config}
 */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/client'],
  // .mjs, not .js: the root package.json has no "type", so Jest would load a
  // .js test through require() and reject the top-level await that
  // jest.unstable_mockModule needs. .mjs is unambiguously ESM.
  testMatch: ['**/*.test.mjs'],
  transform: {},
};
```

Add to `package.json` scripts, after `"test:unit:monocart"`:

```json
    "test:client": "cross-env NODE_OPTIONS=--experimental-vm-modules jest -c jest.client.config.mjs",
```

- [ ] **Step 2: Write the failing test**

Create `tests/client/async-pool.test.mjs`:

```javascript
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:client`
Expected: FAIL — `Cannot find module '../../client/src/lib/async-pool.js'`.

- [ ] **Step 4: Write minimal implementation**

Create `client/src/lib/async-pool.js`:

```javascript
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {Array<() => Promise<any>>} tasks
 * @param {{ concurrency?: number, onRateLimit?: (error: Error) => number }} options
 *   `onRateLimit` returns how many milliseconds to pause before launching more.
 * @returns {Promise<Array<{status: 'fulfilled', value: any} | {status: 'rejected', reason: Error}>>}
 *   One entry per task, in input order.
 */
export async function runPool(tasks, { concurrency = 4, onRateLimit } = {}) {
  const results = new Array(tasks.length);
  let limit = Math.max(1, concurrency);
  let next = 0;
  let aborted = false;
  let pauseUntil = 0;

  // Each worker knows its own slot number. Shrinking `limit` retires the
  // high-numbered workers, which is how concurrency halves mid-run without any
  // shared bookkeeping to get wrong.
  const runWorker = async (slot) => {
    while (!aborted) {
      const pauseFor = pauseUntil - Date.now();
      if (pauseFor > 0) await sleep(pauseFor);

      // Re-checked after the pause: another worker may have halved the limit
      // while this one slept.
      if (slot >= limit) return;

      const index = next;
      if (index >= tasks.length) return;
      next += 1;

      try {
        results[index] = { status: 'fulfilled', value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };

        if (reason?.fatal) {
          aborted = true;
        } else if (reason?.rateLimited) {
          const pauseMs = onRateLimit ? onRateLimit(reason) : 0;
          pauseUntil = Date.now() + (pauseMs || 0);
          limit = Math.max(1, Math.floor(limit / 2));
          // onRateLimit may set `fatal` when the circuit breaker trips.
          if (reason?.fatal) aborted = true;
        }
      }
    }
  };

  const workerCount = Math.min(limit, tasks.length);
  await Promise.all(
    Array.from({ length: workerCount }, (_, slot) => runWorker(slot))
  );

  // Tasks never launched because the run was aborted still need an entry, so
  // the caller can report them rather than see undefined holes.
  for (let i = 0; i < results.length; i += 1) {
    if (!results[i]) results[i] = { status: 'rejected', reason: new PoolAbortedError() };
  }

  return results;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:client`
Expected: all 6 tests PASS.

- [ ] **Step 6: Verify the server suite is unaffected**

Run: `npm test`
Expected: all pre-existing suites pass — `jest.config.js` roots at `tests/unit`, so `tests/client` is not picked up.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/async-pool.js jest.client.config.mjs tests/client/async-pool.test.mjs package.json
git commit -m "Add a bounded async pool for the client, with a native-ESM test harness"
```

---

### Task 6: Generate objectives through the pool

**Files:**
- Modify: `client/src/pages/question-generation/generationApi.js:11-140` (`generateQuestions`)
- Test: `tests/client/generation-api-pool.test.mjs` (create)

**Interfaces:**
- Consumes: `runPool`, `PoolAbortedError` from Task 5.
- Produces: `generateQuestions(course, objectiveGroups, onProgress)` now resolves `{ questions, tokenUsage, failures }` where `failures` is `Array<{ objectiveText: string, granularId: string, reason: string, rateLimited: boolean }>`. It throws only when every objective failed.

- [ ] **Step 1: Write the failing test**

Create `tests/client/generation-api-pool.test.mjs`:

```javascript
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockPost = jest.fn();
jest.unstable_mockModule('../../client/src/lib/api.js', () => ({
  api: { post: mockPost },
}));

const { generateQuestions } = await import('../../client/src/pages/question-generation/generationApi.js');

const objectiveGroups = [
  {
    objectiveId: 'lo-1',
    title: 'Explain cellular energy',
    materialIds: ['m-1'],
    items: [
      { granularId: 'g-1', text: 'Explain ATP', bloom: ['Understand'], count: 1 },
      { granularId: 'g-2', text: 'Explain glycolysis', bloom: ['Understand'], count: 1 },
    ],
  },
];

const course = { id: 'course-1', name: 'Biology' };

const okResponse = (text) => ({
  success: true,
  questions: [{ question: text, questionType: 'multiple-choice', options: {}, correctAnswer: 'A' }],
  tokenUsage: { generation: { promptTokens: 1, completionTokens: 1 } },
});

describe('generateQuestions concurrency', () => {
  beforeEach(() => mockPost.mockReset());

  it('issues objective requests concurrently', async () => {
    let inFlight = 0;
    let peak = 0;
    mockPost.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      return okResponse('Q');
    });

    await generateQuestions(course, objectiveGroups, undefined, { concurrency: 2 });

    expect(peak).toBe(2);
  });

  it('keeps questions in objective order when the first request is slowest', async () => {
    mockPost.mockImplementation(async (_url, body) => {
      if (body.granularLearningObjectiveId === 'g-1') {
        await new Promise((r) => setTimeout(r, 20));
        return okResponse('from g-1');
      }
      return okResponse('from g-2');
    });

    const { questions } = await generateQuestions(course, objectiveGroups, undefined, { concurrency: 2 });

    expect(questions.map((q) => q.text)).toEqual(['from g-1', 'from g-2']);
  });

  it('reports a failed objective instead of dropping it', async () => {
    mockPost.mockImplementation(async (_url, body) => {
      if (body.granularLearningObjectiveId === 'g-2') throw new Error('boom');
      return okResponse('from g-1');
    });

    const { questions, failures } = await generateQuestions(course, objectiveGroups, undefined, { concurrency: 2 });

    expect(questions).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].granularId).toBe('g-2');
    expect(failures[0].reason).toContain('boom');
  });

  it('throws only when every objective fails', async () => {
    mockPost.mockRejectedValue(new Error('everything is down'));

    await expect(
      generateQuestions(course, objectiveGroups, undefined, { concurrency: 2 })
    ).rejects.toThrow('everything is down');
  });

  it('marks a 429 failure as rate limited', async () => {
    mockPost.mockRejectedValueOnce(Object.assign(new Error('slow down'), { status: 429 }));
    mockPost.mockResolvedValue(okResponse('from g-2'));

    const { failures } = await generateQuestions(course, objectiveGroups, undefined, { concurrency: 1 });

    expect(failures[0].rateLimited).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:client`
Expected: FAIL — `generateQuestions` ignores the options argument and returns no `failures`.

- [ ] **Step 3: Check how the api client surfaces status codes**

Run: `grep -n "status\|throw" client/src/lib/api.js | head -20`

The pool needs `error.status === 429` and the parsed body to distinguish a rate limit from an outage. If `api.js` throws an error that does **not** carry the HTTP status, add it there before continuing — the pool cannot react to what it cannot see. The minimum shape the rest of this task assumes:

```javascript
// In the api client's error path, before throwing:
error.status = response.status;
error.body = parsedJsonBody;   // so retryAfterSeconds survives
```

Without this, Task 6's rate-limit test and Task 7's sweep both fail, and the run degrades to "every failure looks fatal" — correct but slower to recover.

- [ ] **Step 4: Write minimal implementation**

Rewrite `generateQuestions` in `client/src/pages/question-generation/generationApi.js`. Keep the entire per-question mapping body exactly as it is today — only the loop structure, the failure handling and the return value change:

```javascript
import { runPool } from "../../lib/async-pool";

// How many objectives are generated at once. Objectives are independent, so
// this is a straight latency win; 1 reproduces the old sequential behaviour.
const DEFAULT_CONCURRENCY = 4;
// Cap on how long a provider Retry-After can stall the run.
const MAX_PAUSE_MS = 60000;
// Consecutive rate-limit failures before we stop rather than keep hammering.
const RATE_LIMIT_CIRCUIT_BREAK = 5;

export async function generateQuestions(course, objectiveGroups, onProgress, options = {}) {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  // One task per granular objective, flattened so the pool sees a single list
  // while results stay addressable by their original position.
  const units = [];
  for (const learningObjective of objectiveGroups) {
    for (const granular of learningObjective.items) {
      units.push({ learningObjective, granular });
    }
  }

  const total = units.reduce((sum, unit) => sum + (unit.granular.count || 1), 0);
  let generated = 0;
  let consecutiveRateLimits = 0;

  const tokenTotals = {
    generation: { promptTokens: 0, completionTokens: 0 },
    review: { promptTokens: 0, completionTokens: 0 },
    fix: { promptTokens: 0, completionTokens: 0 },
  };
  const addTokens = (bucket, usage) => {
    bucket.promptTokens += usage?.promptTokens || 0;
    bucket.completionTokens += usage?.completionTokens || 0;
  };

  const tasks = units.map(({ learningObjective, granular }) => async () => {
    const response = await api.post("/api/rag-llm/generate-questions-with-rag", {
      courseId: course.id || course._id,
      courseName: course.name || course.courseName || "",
      learningObjectiveId: learningObjective.objectiveId,
      learningObjectiveText: learningObjective.title,
      granularLearningObjectiveId: granular.granularId,
      granularLearningObjectiveText: granular.text,
      bloomLevels: granular.bloom || ["Understand"],
      materialIds: learningObjective.materialIds || [],
      count: granular.count,
      ...(granular.questionType ? { questionType: granular.questionType } : {}),
    });

    if (!response.success) {
      throw new Error(response.error || "Question generation service is currently unavailable");
    }
    if (!response.questions || !Array.isArray(response.questions)) {
      throw new Error("Invalid response: questions array missing");
    }

    const bloomLevels = granular.bloom || ["Understand"];
    const questions = response.questions.map((questionData, index) => {
      // Move the existing mapping body here UNCHANGED — it is currently
      // generationApi.js lines 57-108, from `const resolvedType =` through
      // `return base;`, including the calculation / open-ended /
      // fill-in-the-blank branches. Do not retype it; cut and paste it, then
      // confirm with `git diff` that the only change to those lines is
      // indentation.
    });

    const tokenUsage = response.tokenUsage || {};
    addTokens(tokenTotals.generation, tokenUsage.generation);
    addTokens(tokenTotals.review, tokenUsage.review);
    addTokens(tokenTotals.fix, tokenUsage.fix);
    generated += questions.length;
    onProgress?.({ generated, total });

    return questions;
  });

  // Named rather than inline because Task 7's retry sweep reuses it.
  const onRateLimit = (error) => {
    consecutiveRateLimits += 1;
    // An exhausted quota should cost seconds, not ten minutes of hammering.
    if (consecutiveRateLimits >= RATE_LIMIT_CIRCUIT_BREAK) error.fatal = true;
    const seconds = Number(error?.retryAfterSeconds) || 0;
    return Math.min(seconds * 1000, MAX_PAUSE_MS);
  };

  const settled = await runPool(tasks, { concurrency, onRateLimit });

  const allQuestions = [];
  const failures = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      consecutiveRateLimits = 0;
      allQuestions.push(...result.value);
      return;
    }
    const { learningObjective, granular } = units[index];
    console.error(`Failed to generate questions for objective: ${granular.text}`, result.reason);
    failures.push({
      objectiveText: granular.text || learningObjective.title || "",
      granularId: granular.granularId,
      reason: result.reason?.message || String(result.reason),
      rateLimited: result.reason?.status === 429 || result.reason?.rateLimited === true,
    });
  });

  // A total failure is an outage worth surfacing as an error. A partial one is
  // a result the instructor can still use, with the gaps named.
  if (allQuestions.length === 0 && failures.length > 0) {
    throw settled.find((r) => r.status === "rejected").reason;
  }

  return {
    questions: allQuestions,
    failures,
    tokenUsage: {
      ...tokenTotals,
      total: {
        promptTokens:
          tokenTotals.generation.promptTokens + tokenTotals.review.promptTokens + tokenTotals.fix.promptTokens,
        completionTokens:
          tokenTotals.generation.completionTokens +
          tokenTotals.review.completionTokens +
          tokenTotals.fix.completionTokens,
      },
    },
  };
}
```

Mark rate-limited rejections so the pool can see them. In the task body, wrap the `api.post` call so a 429 response carries the flag the pool checks:

```javascript
    let response;
    try {
      response = await api.post("/api/rag-llm/generate-questions-with-rag", { /* body as above */ });
    } catch (error) {
      if (error?.status === 429) {
        error.rateLimited = true;
        error.retryAfterSeconds = error?.body?.retryAfterSeconds;
      }
      throw error;
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:client`
Expected: all 5 new tests plus Task 5's 6 tests PASS.

- [ ] **Step 6: Verify the client still builds and lints**

Run: `npm --prefix client run lint && npm --prefix client run build`
Expected: 0 errors (6 pre-existing warnings are acceptable), build succeeds.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/question-generation/generationApi.js tests/client/generation-api-pool.test.mjs
git commit -m "Generate granular objectives concurrently through a bounded pool"
```

---

### Task 7: Retry the tail and tell the instructor what failed

Failures currently reach a `console.error` the instructor never sees. Under rate limiting that goes from rare to routine, so the run needs a retry sweep and the UI needs to report what is missing.

**Files:**
- Modify: `client/src/pages/question-generation/generationApi.js` (add the sweep)
- Modify: `client/src/pages/QuestionGeneration.jsx:204-217`
- Test: `tests/client/generation-api-retry-sweep.test.mjs` (create)

**Interfaces:**
- Consumes: `generateQuestions(course, objectiveGroups, onProgress, options)` from Task 6.
- Produces: `generateQuestions` retries retryable failures once at concurrency 1 before returning; surviving failures stay in `failures`. `QuestionGeneration.jsx` shows a warning listing failed objectives when `failures.length > 0`.

- [ ] **Step 1: Write the failing test**

Create `tests/client/generation-api-retry-sweep.test.mjs`:

```javascript
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockPost = jest.fn();
jest.unstable_mockModule('../../client/src/lib/api.js', () => ({ api: { post: mockPost } }));

const { generateQuestions } = await import('../../client/src/pages/question-generation/generationApi.js');

const objectiveGroups = [
  {
    objectiveId: 'lo-1',
    title: 'Explain cellular energy',
    materialIds: [],
    items: [
      { granularId: 'g-1', text: 'Explain ATP', bloom: ['Understand'], count: 1 },
      { granularId: 'g-2', text: 'Explain glycolysis', bloom: ['Understand'], count: 1 },
    ],
  },
];

const course = { id: 'course-1', name: 'Biology' };
const okResponse = (text) => ({
  success: true,
  questions: [{ question: text, questionType: 'multiple-choice', options: {}, correctAnswer: 'A' }],
  tokenUsage: {},
});

describe('tail retry sweep', () => {
  beforeEach(() => mockPost.mockReset());

  it('retries a rate-limited objective once and recovers it', async () => {
    let g2Attempts = 0;
    mockPost.mockImplementation(async (_url, body) => {
      if (body.granularLearningObjectiveId === 'g-2') {
        g2Attempts += 1;
        if (g2Attempts === 1) throw Object.assign(new Error('slow down'), { status: 429 });
        return okResponse('from g-2 on retry');
      }
      return okResponse('from g-1');
    });

    const { questions, failures } = await generateQuestions(course, objectiveGroups, undefined, { concurrency: 2 });

    expect(g2Attempts).toBe(2);
    expect(failures).toHaveLength(0);
    expect(questions.map((q) => q.text)).toEqual(['from g-1', 'from g-2 on retry']);
  });

  it('does not retry a non-retryable failure', async () => {
    let g2Attempts = 0;
    mockPost.mockImplementation(async (_url, body) => {
      if (body.granularLearningObjectiveId === 'g-2') {
        g2Attempts += 1;
        throw new Error('objective has no material');
      }
      return okResponse('from g-1');
    });

    const { failures } = await generateQuestions(course, objectiveGroups, undefined, { concurrency: 2 });

    expect(g2Attempts).toBe(1);
    expect(failures).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:client`
Expected: FAIL — the first test sees `g2Attempts` of 1 and one surviving failure.

- [ ] **Step 3: Write minimal implementation**

In `generationApi.js`, extract the settle-and-collect logic into a helper so it can run twice, then add the sweep before returning. Replace the single `runPool` call and its result handling with:

```javascript
  const collect = (settled, unitList, into, failures) => {
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        consecutiveRateLimits = 0;
        into.push({ index: unitList[index].order, questions: result.value });
        return;
      }
      const { learningObjective, granular, order } = unitList[index];
      console.error(`Failed to generate questions for objective: ${granular.text}`, result.reason);
      failures.push({
        order,
        objectiveText: granular.text || learningObjective.title || "",
        granularId: granular.granularId,
        reason: result.reason?.message || String(result.reason),
        rateLimited: result.reason?.status === 429 || result.reason?.rateLimited === true,
      });
    });
  };

  const ordered = [];
  const failures = [];
  collect(await runPool(tasks, { concurrency, onRateLimit }), units, ordered, failures);

  // One sweep at concurrency 1 for objectives that failed for a reason worth
  // retrying. Slow, but it is only the tail, and it turns "I lost 3
  // objectives" into "it took a little longer". Safe because nothing is
  // persisted until the stepper's save step.
  const retryable = failures.filter((failure) => failure.rateLimited);
  if (retryable.length > 0) {
    const retryUnits = retryable.map((failure) => units[failure.order]);
    const retryTasks = retryUnits.map((unit) => tasks[unit.order]);
    const swept = [];
    const stillFailed = [];
    collect(await runPool(retryTasks, { concurrency: 1 }), retryUnits, swept, stillFailed);
    ordered.push(...swept);
    // Only failures that survived the sweep are reported.
    failures.length = 0;
    failures.push(...stillFailed);
  }

  const allQuestions = ordered
    .sort((a, b) => a.index - b.index)
    .flatMap((entry) => entry.questions);
```

The all-failed throw from Task 6 now runs **after** the sweep, so an objective the
sweep recovered cannot count as a failure. It sits immediately below the
`allQuestions` assignment above, replacing Task 6's version:

```javascript
  // A total failure is an outage worth surfacing as an error. A partial one is
  // a result the instructor can still use, with the gaps named.
  if (allQuestions.length === 0 && failures.length > 0) {
    throw new Error(failures[0].reason);
  }
```

Give each unit its position when building the list, so results can be re-sorted after the sweep:

```javascript
  for (const learningObjective of objectiveGroups) {
    for (const granular of learningObjective.items) {
      units.push({ learningObjective, granular, order: units.length });
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:client`
Expected: all client suites PASS, including Task 5 and Task 6's tests (ordering must still hold).

- [ ] **Step 5: Surface failures in the UI**

In `client/src/pages/QuestionGeneration.jsx`, change the destructure and add the warning:

```javascript
      const { questions, failures } = await generateQuestions(
        selectedCourse,
        objectiveGroups,
        ({ generated, total }) =>
          setGenerationMessage(
            `Generating questions — ${generated} of ${total} (includes automatic quality review and fixes)`
          )
      );

      if (failures?.length > 0) {
        const rateLimited = failures.filter((failure) => failure.rateLimited).length;
        showToast(
          `${failures.length} objective${failures.length === 1 ? "" : "s"} could not be generated` +
            (rateLimited > 0 ? " (the AI provider was rate limiting)" : "") +
            ". The rest are ready below.",
          "warning"
        );
      }
```

Verify `showToast` is already in scope in this component:

Run: `grep -n "showToast" client/src/pages/QuestionGeneration.jsx | head -3`
If it is not, import and initialise it the same way other pages do (`const showToast = useToast();` from `../components/ui/Toast`).

- [ ] **Step 6: Verify lint and build**

Run: `npm --prefix client run lint && npm --prefix client run build && npm test && npm run test:client`
Expected: 0 lint errors, build succeeds, both test suites pass.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/question-generation/generationApi.js client/src/pages/QuestionGeneration.jsx tests/client/generation-api-retry-sweep.test.mjs
git commit -m "Retry rate-limited objectives once and report what failed"
```

---

### Task 8: Document the new knobs

**Files:**
- Modify: `.env.example`

**Interfaces:**
- Consumes: env vars introduced in Tasks 1 and 6.
- Produces: documentation only.

- [ ] **Step 1: Add the settings**

Append to the LLM section of `.env.example`, after the reasoning-effort block:

```bash
# --- Grading concurrency ---
# Grading runs inside the student's answer-check request, so a shed call is not
# a delay: the answer is saved ungraded and the instructor grades it by hand.
# Sizing assumes a whole class answering at once. At ~1.7s per call, 32 drains
# a 1,000-student burst in under a minute; the queue timeout is a safety valve,
# not the normal path. Grading prompts are small, so width is cheap here.
#GRADING_LLM_CONCURRENCY=32
#GRADING_LLM_QUEUE_TIMEOUT_MS=60000
#GRADING_LLM_TIMEOUT_MS=30000
#GRADING_LLM_MAX_RETRIES=2

# --- Generation concurrency ---
# Question generation runs one request per granular objective. Those objectives
# are independent, so they run concurrently; these bound how many.
#
# Server-side cap on in-flight provider calls made by generation — shared across
# generation, review, fix and RAG retrieval so they cannot each saturate the
# provider independently. Lower this first if you see 429s.
#GENERATION_LLM_CONCURRENCY=6
# Generation calls are long: p90 is around 41s at high reasoning effort, so this
# is deliberately far above the grading equivalent.
#GENERATION_LLM_TIMEOUT_MS=120000
#GENERATION_LLM_MAX_RETRIES=3
#
# The client pool halves its own concurrency for the rest of a run whenever the
# server answers 429, and stops the run after 5 consecutive rate-limit
# failures. Setting the client to 1 restores the old sequential behaviour.
```

- [ ] **Step 2: Verify nothing else references removed names**

Run: `grep -rn "GradingLimiter" src/ tests/ .env.example`
Expected: no matches anywhere — Task 1 removed the class name entirely.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "Document generation concurrency settings"
```

---

## Verification

After all tasks:

- [ ] `npm test` — server suite green (659 tests before this work; every new server test adds to that).
- [ ] `npm run test:client` — client suite green.
- [ ] `npm --prefix client run lint && npm --prefix client run build` — 0 errors.
- [ ] Manual check with a real course: generate for 4+ granular objectives and confirm from the server log that batches interleave (their `=== RAG + LLM GENERATION REQUEST ===` headers appear before earlier ones finish) and that question order in the UI still matches objective order.
- [ ] Set `GENERATION_LLM_CONCURRENCY=1` and confirm the run still completes, just slower — this is the escape hatch if a deployment's rate limits are tighter than expected.
- [ ] Confirm the two pools are independent: start a generation run and, while it is in flight, submit a student answer that needs AI grading. The answer must be graded promptly rather than queueing behind generation.
