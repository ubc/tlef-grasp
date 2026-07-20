/**
 * Rate limiting for the API.
 *
 * Two tiers:
 *  - apiLimiter: broad ceiling on all /api traffic. Normal use (dashboard,
 *    quiz taking, instructor tools) stays far below it; it exists to stop a
 *    runaway client-side retry loop or an abusive script from hammering the
 *    server.
 *  - checkLimiter: tighter cap on the answer-check endpoint, which can trigger
 *    a paid LLM call per request. A student answers at most a few questions
 *    per minute, so the cap never throttles real quiz taking.
 *
 * Keyed by the authenticated user when available (fair behind campus NAT,
 * where many students share one IP), falling back to IP for unauthenticated
 * requests. Counters are per-process (in-memory): with clustered workers the
 * effective limit is approximate, which is fine for an abuse ceiling.
 */

const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const envInt = (name, fallback) => {
    const value = parseInt(process.env[name], 10);
    return Number.isInteger(value) && value > 0 ? value : fallback;
};

const keyByUserOrIp = (req) => {
    const userId = req.user?._id || req.user?.id;
    return userId ? `u:${userId}` : ipKeyGenerator(req.ip);
};

// E2E/a11y suites (NODE_ENV=test) drive the UI far faster than a human and
// would trip the limits; they are not what the ceiling protects against.
const skipInTest = () => process.env.NODE_ENV === "test";

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: envInt("RATE_LIMIT_API_PER_MIN", 300),
    keyGenerator: keyByUserOrIp,
    skip: skipInTest,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, error: "Too many requests — please slow down." },
});

const checkLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: envInt("RATE_LIMIT_CHECK_PER_MIN", 60),
    keyGenerator: keyByUserOrIp,
    skip: skipInTest,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, error: "You are answering too quickly — wait a moment and try again." },
});

module.exports = { apiLimiter, checkLimiter };
