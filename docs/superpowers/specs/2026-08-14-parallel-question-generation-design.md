# Parallel Question Generation Across Granular Objectives

**Date:** 2026-08-14
**Status:** Approved, ready for implementation planning

## Problem

Generating a set of questions takes minutes, and almost all of that is spent
waiting on requests that have no reason to wait for each other.

The client generates one granular objective at a time:
`generationApi.js` awaits a `POST /api/rag-llm/generate-questions-with-rag`
per objective inside nested `for` loops. Each request then runs its own work
sequentially: a conversational generation turn per question, one review call,
then up to two review→fix cycles.

Measurements from 1,605 logged calls in `logs/*.jsonl`:

| Stage | Calls | Median | Mean | Share of LLM time |
|---|---|---|---|---|
| `question-generate` | 580 | 3,689 ms | 5,270 ms | 43.1% |
| `question-review` | 454 | 3,157 ms | 5,993 ms | 38.4% |
| `question-fix` | 243 | 3,340 ms | 5,395 ms | 18.5% |

Two numbers decide the design:

- **Batches average 2.10 questions** — 254 of 276 batches are exactly 2. So
  parallelising *within* a batch converts two sequential calls into one wave,
  saving roughly one call per batch: about 21% of generation time, or **~9% of
  the pipeline**. Not worth the risk it carries.
- **Generation is only 43% of LLM time.** Review and fix are the other 57%, and
  they are serialised behind generation inside each request.

The serialisation that costs is therefore *across* the 276 batches. Each is
~4 sequential provider calls (~20–25s); they run one after another, and every
one of them is independent of the others.

## Goals

- Cut wall-clock time for a generation run by running independent objectives
  concurrently.
- Survive provider rate limiting by slowing down and finishing, rather than
  losing objectives.
- Tell the instructor what failed instead of silently dropping it.
- Leave the behaviour of a single batch bit-for-bit unchanged.

## Non-goals

- **Within-batch fan-out ("warmed fan-out").** Considered and rejected on the
  evidence above: ~9% of pipeline time, and it is the change that would remove
  the sibling constraint that keeps questions in a batch distinct.
- **Near-duplicate detection.** Deliberately out of scope; see "Duplicates"
  below for why parallelism does not make this worse.
- Changing the conversational generation loop, the review prompt, or the fix
  loop.

## Duplicates: why this change is neutral

Today's protection, in full:

| Scope | Protection |
|---|---|
| Within one batch | The model sees earlier questions in the conversation, plus a "must test something different" turn instruction (soft); exact-match on normalised text (hard) |
| Same granular objective, later run | Exact match against saved questions, via `getQuestionTextsByGranularObjective` |
| Across sibling granular objectives | **None** |

`normalizeQuestionText` is NFKC + whitespace collapse + lowercase, so "hard"
protection means *identical* text only. And
`getQuestionTextsByGranularObjective` filters on `granularObjectiveId`, so two
sibling objectives under the same parent never see each other's questions —
sequentially or otherwise.

Running batches concurrently therefore removes no protection that exists. Any
near-duplicates across sibling objectives are already possible today, and are
caused by the missing cross-objective check rather than by concurrency.

Adding real near-duplicate detection (embed each question, cosine-compare
across the run, regenerate collisions) is a worthwhile separate piece of work.
It is not bundled here because it would land a speed change and a quality
change in the same diff, and only one of them is being asked for.

## Design

### 1. Client: a bounded pool

The nested `for` loops flatten into one task per granular objective, run
through a bounded-concurrency pool. Default **4 in flight**; a 40-objective run
issues 4 requests at a time, not 40.

Each task posts to the same endpoint with the same body it sends today. No API
change, and the server remains stateless per batch.

Results must be assembled in **objective order, not completion order**, so a
run produces the same ordering it does today regardless of which objective
finishes first. Each task writes into its own slot in a pre-sized array; the
array is flattened once the pool drains.

Progress still ticks per completed objective (`onProgress({ generated, total })`),
now out of order. `total` is known up front, so the bar remains accurate.

### 2. Server: a generation limiter

A `generationLimiter` alongside the existing `gradingLimiter`, built from the
same class. `grading-limiter.js` already exports both `GradingLimiter` and
`isRetryableLLMError`, so no new backoff logic is written — but the class name
becomes misleading once a second caller exists, so it is renamed `LLMLimiter`
with the `gradingLimiter` instance export unchanged.

It wraps three call sites, all of which are our own code:

- `generateStructured` for `question-generate`, `question-review` and
  `question-fix` in `rag-llm.js`.
- `instance.retrieveContext` in `rag-fanout.js` (lines 41 and 47). Retrieval is
  included deliberately: each objective issues 3–5 Qdrant searches, each
  preceded by an embedding call, so four concurrent objectives is ~20
  concurrent embeddings. Leaving retrieval outside the cap would move the 429s
  rather than prevent them.

Without it, 4 concurrent objectives × (2 generates + 1 review + ~1 fix) is up
to ~16 in-flight provider calls with nothing coordinating them.

It reuses the class but **not grading's defaults**:

| Setting | Grading | Generation | Why |
|---|---|---|---|
| Queue timeout | 15s (sheds) | none | Shedding is right when a student is waiting and manual grading is the fallback. An instructor already waits minutes; failing an objective to save 15s of queueing is a bad trade. |
| Call timeout | 30s | 120s | Logged generations reach p90 41s and max 51s. A 30s cap would abort legitimate work. |
| Concurrency | 8 | 6 (env-tunable) | Shared across generation and retrieval, so the two cannot independently saturate the provider. |

Backoff behaviour is inherited and is the point: a 429 retries with exponential
backoff **while holding its slot**, which throttles the whole pool — precisely
what a 429 is asking for.

### 3. Stop double-retrying rate limits

`generateOneQuestion` currently retries every failure up to `maxRetries` (3),
including rate-limit errors. Stacked on the limiter's retries that is up to 9
attempts against a provider already refusing.

The slot loop retries only **content** failures — schema invalid, duplicate,
empty response. Rate limiting belongs to the limiter alone; a 429 that survives
it means the provider is genuinely saturated, and retrying in the slot only
adds load.

### 4. Propagate the rate-limit signal

`returnErrorResponse` currently maps every failure to HTTP 500 with
"Question generation service is currently unavailable", so a provider 429 is
indistinguishable from a bug.

A rate-limit failure that survives the limiter returns **429 with
`Retry-After`**. Everything else keeps returning 500. This is what makes the
client's reaction possible.

Partial batches keep returning 200 with fewer questions, plus the requested and
produced counts so the caller can report the shortfall.

### 5. The pool reacts to 429

On a 429 the pool:

1. Pauses for `Retry-After` (bounded to a sane maximum).
2. **Halves its concurrency** for the remainder of the run.

Reducing concurrency is the part that matters. The likelier limit here is
tokens-per-minute rather than requests-per-minute — retrieved material is
roughly 80% of a batch's input — and retrying at the same concurrency does not
reduce token rate. Concurrency does not recover during the run; simplicity is
worth more than reclaiming throughput near a limit.

A **circuit breaker** ends the run after 5 consecutive rate-limit failures, and
trips immediately on 401/403. An exhausted quota then costs seconds rather than
ten minutes of hammering.

### 6. Tail recovery

Objectives that failed with a retryable error get **one retry sweep at
concurrency 1** after the main pass. It is slow, but it is only the tail, and it
converts "I lost 3 objectives" into "it took a little longer".

Retrying is safe: nothing is persisted until the stepper's save step, so a
regenerated objective cannot duplicate a stored question.

### 7. Report failures instead of swallowing them

Today `generateQuestions` catches per objective and, once anything has
succeeded, reduces every later failure to a `console.error` the instructor
never sees. Under rate limiting that goes from rare to routine.

It returns `{ questions, failures: [{ objectiveText, granularId, reason }] }`.
The UI reports "38 of 40 objectives generated — 2 failed (rate limited)" with a
retry action for the failed subset.

The all-or-nothing throw becomes: throw only if **every** task failed (a real
outage); otherwise return partial results plus failures.

### 8. Error handling summary

| Failure | Handled by | Instructor sees |
|---|---|---|
| Transient 429/503/529 | Limiter backoff, slot held | Nothing; run is slower |
| Sustained rate limit | Pool pauses, concurrency halves | Slower run |
| Rate limit past retries | 429 to client → tail sweep | Failure listed if the sweep also fails |
| Quota exhausted / 401 / 403 | Circuit breaker | Run stops with the reason |
| Schema-invalid response | Slot retry (unchanged) | Nothing, or one fewer question |
| One objective fails outright | Pool continues | That objective listed as failed |
| Every objective fails | Throw | Error, as today |

## Testing

- **Pool**: respects the concurrency cap; assembles results in objective order
  under out-of-order completion; continues past a failing task; throws only when
  every task fails.
- **429 reaction**: a 429 pauses the pool and halves concurrency; the circuit
  breaker trips after 5 consecutive rate-limit failures and immediately on 401.
- **Tail sweep**: retryable failures are retried once at concurrency 1;
  non-retryable failures are not retried.
- **Limiter**: generation defaults differ from grading's (no queue shedding,
  120s call timeout); a 429 retries while holding its slot; grading's own
  behaviour is unchanged by the rename.
- **Slot retries**: content failures retry; rate-limit failures do not.
- **Status mapping**: a surviving rate-limit failure produces 429 with
  `Retry-After`; other failures still produce 500.
- **Unchanged batch behaviour**: an existing single-objective generation
  produces the same questions, review and fix calls as before.

## Rollout

Concurrency is env-tunable on both sides, defaulting to 4 (client) and 6
(server). Setting client concurrency to 1 restores today's sequential behaviour
exactly, which is the fallback if a deployment's rate limits prove tighter than
expected.

## Expected result

Across the logged runs, generation, review and fix totalled ~7,090s of
sequential provider time. At 4-way concurrency, minus tail effects, a run should
land near **3.5–4x faster** — a 70-question run going from roughly 10 minutes to
about 3.
