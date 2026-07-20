// Run document parsers (PDF/DOCX/PPTX) in a worker thread.
//
// Parsing is the heaviest CPU work in the app — LiteParse layout/OCR, mammoth,
// pptx extraction — and it used to run on the main event loop, so one
// instructor uploading a large PDF froze every in-flight student request
// (answer checks included) until parsing finished. A worker thread keeps the
// event loop free; the parsers' embedded LLM calls (image description) work
// unchanged since workers share process.env and network access.
//
// Concurrency is capped: each worker loads sharp/LiteParse and holds the whole
// document in memory, so a burst of uploads queues here instead of exhausting
// RAM. Uploads are rare (staff-only) — a short queue is invisible to users.

const { Worker } = require("node:worker_threads");
const path = require("node:path");

const MAX_CONCURRENT_PARSES = (() => {
    const value = parseInt(process.env.PARSE_WORKER_CONCURRENCY, 10);
    return Number.isInteger(value) && value > 0 ? value : 2;
})();

let active = 0;
const queue = [];

const acquire = () =>
    new Promise((resolve) => {
        if (active < MAX_CONCURRENT_PARSES) {
            active += 1;
            resolve();
        } else {
            queue.push(resolve);
        }
    });

const release = () => {
    const next = queue.shift();
    if (next) next();
    else active -= 1;
};

const runWorker = (parser, args) =>
    new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, "parse-worker-runner.js"), {
            workerData: { parser, args },
        });
        let settled = false;
        worker.on("message", (msg) => {
            settled = true;
            if (msg.ok) resolve(msg.result);
            else reject(new Error(msg.error));
        });
        worker.on("error", (error) => {
            settled = true;
            reject(error);
        });
        worker.on("exit", (code) => {
            if (!settled) reject(new Error(`Parse worker exited unexpectedly with code ${code}`));
        });
    });

/**
 * Parse a document off the main thread.
 * @param {"pdf"|"docx"|"pptx"} parser Which parser to run.
 * @param {...any} args Arguments forwarded to the parser (buffer first).
 * @returns {Promise<any>} The parser's result, unchanged.
 */
const parseInWorker = async (parser, ...args) => {
    await acquire();
    try {
        return await runWorker(parser, args);
    } finally {
        release();
    }
};

module.exports = { parseInWorker };
