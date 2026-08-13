/**
 * Guarded fetching of an instructor-supplied URL, plus the readable-text
 * extraction that follows it.
 *
 * The material routes let a staff user name any URL and have the server fetch it,
 * and they return the extracted text in the response. Unconstrained, that is a
 * reflected SSRF: `http://169.254.169.254/latest/meta-data/...` reads cloud
 * instance credentials, `http://localhost:6333/collections` enumerates every
 * course's Qdrant collections, and any internal admin panel on the deployment's
 * private network is reachable and readable. "Staff" includes every promoted TA.
 *
 * Four guards, all of which the previous inline `fetch` lacked:
 *
 *   1. Scheme allow-list — http/https only, so file:, data:, gopher: cannot be
 *      smuggled in.
 *   2. Address checks on every hop — the hostname is resolved and every returned
 *      address is rejected if it is loopback, link-local (which is where cloud
 *      metadata lives), private, CGNAT, or otherwise non-public. Redirects are
 *      followed manually so hop 2 is checked as strictly as hop 1; a public host
 *      that 302s to 127.0.0.1 was the obvious bypass.
 *   3. A wall-clock deadline across all hops, so a slow or hanging host cannot
 *      pin a worker's socket indefinitely.
 *   4. A streamed byte ceiling and a content-type check. Previously the whole
 *      body was buffered via response.text() and only *then* truncated, so an
 *      endless or multi-gigabyte response was a memory/event-loop DoS.
 *
 * Known residual: between our DNS lookup and fetch's own, a hostile DNS server
 * can flip the answer to a private address (DNS rebinding). Closing that fully
 * needs a pinned-IP connector or an egress proxy with an allow-list; the checks
 * here reduce a trivial one-request read to a race that has to be engineered.
 */

const dnsPromises = require('node:dns').promises;
const net = require('node:net');

const DEFAULTS = {
  // Total wall clock across every redirect hop, not per hop.
  timeoutMs: 10000,
  maxRedirects: 3,
  // Cap on bytes read off the wire. Well above any lecture page, far below
  // anything that threatens the heap.
  maxBytes: 5 * 1024 * 1024,
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

/** A URL we refuse to fetch, or a fetch that broke a limit. Always client-safe. */
class BlockedUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlockedUrlError';
    this.code = 'URL_NOT_ALLOWED';
  }
}

/** Non-public IPv4 space: loopback, private, link-local, CGNAT, multicast, reserved. */
function isBlockedIPv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local — cloud metadata lives here
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** Non-public IPv6 space, including IPv4-mapped forms of the above. */
function isBlockedIPv6(address) {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(normalized)) return true; // unique local (fc00::/7)
  const mapped = normalized.match(/^(?:::ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  return false;
}

/**
 * Resolve `hostname` and reject unless EVERY address it maps to is public. All
 * of them, because a name with one public and one loopback record would
 * otherwise be a coin flip decided by connect order.
 */
async function assertPublicHost(hostname, lookup) {
  const literalFamily = net.isIP(hostname);
  let addresses;

  if (literalFamily) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      addresses = await lookup(hostname, { all: true });
    } catch (error) {
      throw new BlockedUrlError(`Could not resolve ${hostname}`);
    }
  }

  if (!addresses || addresses.length === 0) {
    throw new BlockedUrlError(`Could not resolve ${hostname}`);
  }

  for (const { address, family } of addresses) {
    const blocked = family === 6 ? isBlockedIPv6(address) : isBlockedIPv4(address);
    if (blocked) {
      throw new BlockedUrlError(
        `${hostname} resolves to a non-public address (${address}); only public web pages can be fetched`
      );
    }
  }
}

/**
 * Fetch a URL under all four guards, following redirects manually.
 * @returns {Promise<{response: Response, finalUrl: URL}>}
 */
async function fetchGuarded(rawUrl, options = {}) {
  const { timeoutMs, maxRedirects } = { ...DEFAULTS, ...options };
  const lookup = options.lookup || dnsPromises.lookup;
  const fetchFn = options.fetchFn || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('Fetch is not available. Please use Node.js 18+.');
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new BlockedUrlError('Invalid URL format');
  }

  const deadline = Date.now() + timeoutMs;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BlockedUrlError(`Unsupported URL scheme "${url.protocol}"; use http or https`);
    }
    await assertPublicHost(url.hostname, lookup);

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new BlockedUrlError(`Timed out after ${timeoutMs}ms while fetching the URL`);
    }

    let response;
    try {
      response = await fetchFn(url.toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(remaining),
        headers: BROWSER_HEADERS,
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new BlockedUrlError(`Timed out after ${timeoutMs}ms while fetching the URL`);
      }
      throw error;
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, finalUrl: url };
    }

    const location = response.headers.get('location');
    // Free the socket before the next hop; a redirect body is never read.
    try {
      await response.body?.cancel();
    } catch {
      /* already closed */
    }
    if (!location) {
      throw new BlockedUrlError(`Redirect from ${url.hostname} had no Location header`);
    }
    url = new URL(location, url);
  }

  throw new BlockedUrlError(`Too many redirects (more than ${maxRedirects})`);
}

/**
 * Read a response body as text, stopping at `maxBytes` instead of buffering the
 * whole thing. Truncation is reported rather than silent.
 * @returns {Promise<{text: string, truncated: boolean}>}
 */
async function readTextCapped(response, maxBytes) {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  // Empty content-type is tolerated (some servers omit it); a declared non-text
  // type is not — there is no readable page in a video or a tarball.
  if (contentType && !/^(?:text\/|application\/(?:xhtml\+xml|xml|json))/.test(contentType)) {
    throw new BlockedUrlError(
      `That URL returned ${contentType.split(';')[0]}, not a web page`
    );
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    // No stream available (older/other fetch implementations): fall back, but the
    // Content-Length check above is then the only ceiling.
    const text = await response.text();
    return text.length > maxBytes
      ? { text: text.slice(0, maxBytes), truncated: true }
      : { text, truncated: false };
  }

  const chunks = [];
  let total = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const remaining = maxBytes - total;
    if (value.byteLength >= remaining) {
      chunks.push(Buffer.from(value.buffer, value.byteOffset, remaining));
      truncated = true;
      try {
        await reader.cancel();
      } catch {
        /* already closed */
      }
      break;
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    total += value.byteLength;
  }

  return { text: Buffer.concat(chunks).toString('utf8'), truncated };
}

const UNWANTED_SELECTORS = [
  'script', 'style', 'nav', 'header', 'footer', 'aside',
  '.ad', '.ads', '.advertisement', '.sidebar', '.menu',
  '.navigation', '.nav', '.header', '.footer',
  "[role='navigation']", "[role='banner']", "[role='complementary']",
  '.social-share', '.share-buttons', '.comments', '.comment-section',
  'noscript', 'iframe', 'embed', 'object',
];

const MAIN_CONTENT_SELECTORS = [
  'main', 'article', '[role="main"]', '.content', '#content', '.main-content', '#main-content',
];

/**
 * Strip chrome from an HTML document and return its readable text plus <title>.
 * Extracted from the two copies that used to live inline in the material
 * controller so both paths share one implementation.
 */
function extractReadableText(html, { maxLength = 100000 } = {}) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);

  UNWANTED_SELECTORS.forEach((selector) => {
    try {
      $(selector).remove();
    } catch {
      /* ignore invalid selectors */
    }
  });

  const mainSelector = MAIN_CONTENT_SELECTORS.find((selector) => $(selector).length > 0);
  const mainContent = mainSelector ? $(mainSelector).first() : $('body');

  let text = (mainContent.text() || '')
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .replace(/^\s+|\s+$/gm, '')
    .trim();

  if (text.length > maxLength) {
    text = `${text.substring(0, maxLength)}... [Content truncated due to length]`;
  }

  return { text, title: $('title').text() || '' };
}

/**
 * Fetch a URL and return its readable text. The single entry point the material
 * routes use.
 * @returns {Promise<{text: string, title: string, finalUrl: string}>}
 * @throws {BlockedUrlError} for anything the caller should see as a 400
 */
async function fetchReadableText(rawUrl, options = {}) {
  const { maxBytes } = { ...DEFAULTS, ...options };
  const { response, finalUrl } = await fetchGuarded(rawUrl, options);

  if (!response.ok) {
    throw new BlockedUrlError(
      `HTTP error! status: ${response.status} ${response.statusText || ''}`.trim()
    );
  }

  const { text: html } = await readTextCapped(response, maxBytes);
  const { text, title } = extractReadableText(html, options);

  if (!text) {
    throw new BlockedUrlError('No text content could be extracted from the webpage');
  }

  return { text, title: title || finalUrl.toString(), finalUrl: finalUrl.toString() };
}

module.exports = {
  BlockedUrlError,
  fetchReadableText,
  // Exported for tests and reuse.
  fetchGuarded,
  readTextCapped,
  extractReadableText,
  isBlockedIPv4,
  isBlockedIPv6,
  assertPublicHost,
  DEFAULTS,
};
