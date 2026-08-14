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
