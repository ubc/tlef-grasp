// Worker-thread entry for document parsing. Runs one parser call and posts
// the result back. Loaded only inside a Worker — never require this from the
// main thread (see parse-in-worker.js for the API).

const { parentPort, workerData } = require("node:worker_threads");

const PARSERS = {
    pdf: () => require("./pdf-parser").parsePdf,
    docx: () => require("./docx-parser").parseDocx,
    pptx: () => require("./pptx-parser").parsePptx,
};

(async () => {
    try {
        const { parser, args } = workerData;
        const load = PARSERS[parser];
        if (!load) throw new Error(`Unknown parser: ${parser}`);
        const result = await load()(...args);
        parentPort.postMessage({ ok: true, result });
    } catch (error) {
        parentPort.postMessage({ ok: false, error: error?.message || String(error) });
    }
})();
