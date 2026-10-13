/**
 * Downloads the remote images a Canvas Classic Quizzes export links to.
 *
 * A quiz export does not bundle most question images: stems and options point at
 * `https://<canvas>/assessment_questions/<aq>/files/<file>/download?verifier=<token>`.
 * The importer fetches those once per import and stores its own copies, because
 * the links stop working once the token expires or the course is gone.
 *
 * The URLs come out of an uploaded zip, so they are attacker-controlled input:
 *
 *   1. The first hop must be https, on a Canvas host we know (canvas.ubc.ca, the
 *      deployment's CANVAS_DOMAIN, or CANVAS_IMPORT_IMAGE_HOSTS), and on a Canvas
 *      file-download path. Anything else is refused before any request.
 *   2. Every hop goes through fetchGuarded, so a redirect may leave Canvas (it
 *      usually does: files are served from a signed file host) but never reaches
 *      a private address.
 *   3. The body is read with a byte ceiling and sniffed: an expired verifier gets a
 *      200 HTML login page, which must not be stored as an "image".
 *   4. The `verifier` query value works like a password, so neither the URL nor
 *      any part of it appears in a result, a log line, or an error.
 */

const { fetchGuarded, BlockedUrlError } = require('./safe-fetch-url');
const { sniffImageType } = require('./image-sniff');
const { normalizeLmsInstance } = require('../lms/instance');

// UBC's Canvas; quiz exports link here even when CANVAS_DOMAIN names the
// instructure.com alias.
const DEFAULT_CANVAS_IMAGE_HOST = 'canvas.ubc.ca';

const CANVAS_FILE_PATHS = [
  /^\/(assessment_questions|courses)\/\d+\/files\/\d+(\/(download|preview))?\/?$/,
  /^\/files\/\d+\/download\/?$/,
];

const DEFAULTS = {
  concurrency: 6,
  maxBytes: 5 * 1024 * 1024,
  perImageTimeoutMs: 15000,
  // Canvas answers with one or two redirects to the file store; a little slack.
  maxRedirects: 5,
};

/** Host (with a non-default port) of a configured domain, or null when unusable. */
function hostOf(domain) {
  const origin = normalizeLmsInstance(domain);
  return origin ? new URL(origin).host : null;
}

/**
 * The hosts a quiz export's image links may point at.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Set<string>} lower-case hosts
 */
function canvasImageHostsFromEnv(env = process.env) {
  const hosts = new Set([DEFAULT_CANVAS_IMAGE_HOST]);
  const configured = [env.CANVAS_DOMAIN, ...String(env.CANVAS_IMPORT_IMAGE_HOSTS || '').split(',')];
  for (const domain of configured) {
    const host = hostOf(domain);
    if (host) hosts.add(host);
  }
  return hosts;
}

/**
 * Whether `url` is a Canvas file link we are willing to request.
 * @param {string} url
 * @param {Set<string>} hosts lower-case hosts, as from canvasImageHostsFromEnv
 * @returns {boolean}
 */
function isAllowedCanvasImageUrl(url, hosts) {
  if (typeof url !== 'string' || !hosts) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  // A Canvas link never carries credentials; one that does is not from an export.
  if (parsed.username || parsed.password) return false;
  if (!hosts.has(parsed.host)) return false;
  return CANVAS_FILE_PATHS.some((pattern) => pattern.test(parsed.pathname));
}

/** Free the socket of a response whose body we will not read. */
async function discardBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    /* already closed */
  }
}

/**
 * Read a response body as bytes, refusing (not truncating) anything over
 * `maxBytes`: a cut-off image is a broken image.
 * @returns {Promise<Buffer|null>} null when the body is too large
 */
async function readBytesCapped(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discardBody(response);
    return null;
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    // No stream (other fetch implementations): the Content-Length check above is
    // then the only early ceiling.
    const data = Buffer.from(await response.arrayBuffer());
    return data.length > maxBytes ? null : data;
  }

  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* already closed */
      }
      return null;
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks, total);
}

/**
 * Map a thrown error to a short reason code. Messages are never passed on: a
 * fetch error message can quote the URL, verifier included.
 */
function reasonForError(error) {
  if (error instanceof BlockedUrlError) {
    // fetchGuarded reports its deadline as a BlockedUrlError too.
    return /timed out/i.test(error.message) ? 'timeout' : 'blocked';
  }
  // The deadline signal also aborts a body that is still streaming.
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout';
  return 'network';
}

/** An errno-style code (ECONNRESET, UND_ERR_SOCKET) is safe to log; a message is not. */
function safeErrorCode(error) {
  const code = error?.cause?.code || error?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(code) ? code : null;
}

/** A promise pool: at most `limit` tasks run at once, the rest wait in order. */
function createLimiter(limit) {
  let active = 0;
  const waiting = [];
  const acquire = () => {
    if (active < limit) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve));
  };
  const release = () => {
    const next = waiting.shift();
    // Hand the slot straight to the next task so `active` never overshoots.
    if (next) next();
    else active -= 1;
  };
  return async (task) => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
}

/**
 * One fetcher per import: it remembers every URL it was asked for, so an image
 * that several questions share is downloaded once and failures are not retried.
 *
 * @param {object} [options]
 * @param {Set<string>} [options.hosts] allowed first-hop hosts; defaults to canvasImageHostsFromEnv()
 * @param {Function} [options.fetchFn] fetch implementation (tests inject a double)
 * @param {Function} [options.lookup] DNS lookup (tests inject a double)
 * @param {number} [options.concurrency]
 * @param {number} [options.maxBytes]
 * @param {number} [options.perImageTimeoutMs] wall clock per image, across redirects and body
 * @returns {{ fetchImage: (url: string) => Promise<FetchResult> }} where FetchResult is
 *   `{ ok: true, data: Buffer, mimeType }` or `{ ok: false, reason }` (a short code, never a URL)
 */
function createCanvasImageFetcher({
  hosts,
  fetchFn,
  lookup,
  concurrency = DEFAULTS.concurrency,
  maxBytes = DEFAULTS.maxBytes,
  perImageTimeoutMs = DEFAULTS.perImageTimeoutMs,
} = {}) {
  const allowedHosts = hosts
    ? new Set([...hosts].map((host) => String(host).toLowerCase()))
    : canvasImageHostsFromEnv();
  const limit = createLimiter(Math.max(1, Math.floor(concurrency) || 1));
  const results = new Map();
  let failures = 0;

  const fail = (reason, error) => {
    failures += 1;
    const code = error ? safeErrorCode(error) : null;
    console.warn(
      `Canvas image fetch failed: ${reason}${code ? ` (${code})` : ''}; ${failures} failed in this import`
    );
    return { ok: false, reason };
  };

  const download = async (url) => {
    try {
      const { response } = await fetchGuarded(url, {
        fetchFn,
        lookup,
        timeoutMs: perImageTimeoutMs,
        maxRedirects: DEFAULTS.maxRedirects,
      });
      if (response.status < 200 || response.status > 299) {
        await discardBody(response);
        return fail(`http-${response.status}`);
      }
      const data = await readBytesCapped(response, maxBytes);
      if (!data) return fail('too-large');
      const mimeType = sniffImageType(data);
      if (!mimeType) return fail('not-an-image');
      return { ok: true, data, mimeType };
    } catch (error) {
      const reason = reasonForError(error);
      // Only a network failure has a cause worth naming in the log.
      return fail(reason, reason === 'network' ? error : null);
    }
  };

  const fetchImage = (url) => {
    if (!results.has(url)) {
      const result = isAllowedCanvasImageUrl(url, allowedHosts)
        ? limit(() => download(url))
        : Promise.resolve(fail('host-not-allowed'));
      results.set(url, result);
    }
    return results.get(url);
  };

  return { fetchImage };
}

module.exports = {
  canvasImageHostsFromEnv,
  isAllowedCanvasImageUrl,
  createCanvasImageFetcher,
  DEFAULTS,
};
