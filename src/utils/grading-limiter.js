// Concurrency guard for student-facing LLM grading calls (open-ended judge,
// fill-in-the-blank rescue).
//
// Without it, a synchronized quiz window (hundreds of students answering in
// the same minute) fires one provider request per answer at once: the provider
// starts returning 429s, and every 429'd answer silently degrades to manual
// grading. The guard makes grading survive the burst instead:
//   - at most GRADING_LLM_CONCURRENCY calls run at once; the rest queue
//   - a queued call gives up after GRADING_LLM_QUEUE_TIMEOUT_MS (load shedding
//     — the caller degrades exactly as an LLM failure does today)
//   - a running call is abandoned after GRADING_LLM_TIMEOUT_MS so a hung
//     provider response can't pin the student's HTTP request forever
//   - rate-limit/transient errors retry with exponential backoff while still
//     holding the slot, which throttles the whole pool — exactly what a 429
//     is asking for.
//
// The concurrency cap is approximate at the margins: a timed-out call frees
// its slot even though the underlying HTTP request may still be in flight.

const DEFAULTS = {
    concurrency: 8,
    callTimeoutMs: 30000,
    queueTimeoutMs: 15000,
    maxRetries: 2,
    backoffBaseMs: 500,
};

const envInt = (name, fallback) => {
    const value = parseInt(process.env[name], 10);
    return Number.isInteger(value) && value > 0 ? value : fallback;
};

const isRetryableLLMError = (error) => {
    const status = error?.status || error?.statusCode || error?.response?.status;
    if (status === 429 || status === 503 || status === 529) return true;
    const message = String(error?.message || "");
    return /rate.?limit|too many requests|overloaded|\b429\b/i.test(message);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class GradingLimiter {
    constructor(options = {}) {
        this.concurrency = options.concurrency ?? envInt("GRADING_LLM_CONCURRENCY", DEFAULTS.concurrency);
        this.callTimeoutMs = options.callTimeoutMs ?? envInt("GRADING_LLM_TIMEOUT_MS", DEFAULTS.callTimeoutMs);
        this.queueTimeoutMs = options.queueTimeoutMs ?? envInt("GRADING_LLM_QUEUE_TIMEOUT_MS", DEFAULTS.queueTimeoutMs);
        this.maxRetries = options.maxRetries ?? envInt("GRADING_LLM_MAX_RETRIES", DEFAULTS.maxRetries);
        this.backoffBaseMs = options.backoffBaseMs ?? DEFAULTS.backoffBaseMs;
        this.active = 0;
        this.queue = [];
    }

    _acquire() {
        if (this.active < this.concurrency) {
            this.active += 1;
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const waiter = {
                resolve,
                timer: setTimeout(() => {
                    const idx = this.queue.indexOf(waiter);
                    if (idx !== -1) this.queue.splice(idx, 1);
                    reject(new Error(`LLM grading queue full — waited ${this.queueTimeoutMs}ms`));
                }, this.queueTimeoutMs),
            };
            this.queue.push(waiter);
        });
    }

    _release() {
        const next = this.queue.shift();
        if (next) {
            clearTimeout(next.timer);
            next.resolve();
        } else {
            this.active -= 1;
        }
    }

    _withTimeout(promise) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(new Error(`LLM grading call timed out after ${this.callTimeoutMs}ms`)),
                this.callTimeoutMs
            );
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    /**
     * Run `fn` under the concurrency cap with timeout + retry-on-429.
     * Throws on queue timeout, call timeout, or exhausted retries — callers
     * already treat any thrown error as "grading unavailable" and degrade.
     */
    async run(fn) {
        await this._acquire();
        try {
            let lastError;
            for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
                if (attempt > 0) {
                    const backoff = this.backoffBaseMs * 2 ** (attempt - 1);
                    await sleep(backoff + Math.random() * backoff);
                }
                try {
                    return await this._withTimeout(fn());
                } catch (error) {
                    lastError = error;
                    if (!isRetryableLLMError(error)) throw error;
                }
            }
            throw lastError;
        } finally {
            this._release();
        }
    }
}

// One shared limiter for all grading traffic in this process.
const gradingLimiter = new GradingLimiter();

module.exports = { gradingLimiter, GradingLimiter, isRetryableLLMError };
