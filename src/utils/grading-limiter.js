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
