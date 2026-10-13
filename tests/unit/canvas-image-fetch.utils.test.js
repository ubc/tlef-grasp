/**
 * Remote image fetching for the Canvas quiz import (utils/canvas-image-fetch.js).
 *
 * The URLs come out of an uploaded zip and carry a `verifier` token that works
 * like a password. These tests pin the allow-list, the SSRF guard on every hop,
 * the size and type checks, the once-per-URL memo, the concurrency cap, and that
 * no URL or token ever reaches a result or the console. fetch and DNS are doubles;
 * nothing touches the network.
 */

const {
  canvasImageHostsFromEnv,
  isAllowedCanvasImageUrl,
  createCanvasImageFetcher,
} = require('../../src/utils/canvas-image-fetch');

const HOST = 'canvas.example.test';
const VERIFIER = 'vErIfIeRtOkEn0123456789';
const IMAGE_URL = `https://${HOST}/assessment_questions/12/files/345/download?verifier=${VERIFIER}`;
const OTHER_IMAGE_URL = `https://${HOST}/assessment_questions/12/files/346/download?verifier=${VERIFIER}`;
// Where Canvas sends the browser for the bytes: a different, signed host.
const SIGNED_URL = 'https://files.example-cdn.test/blob/abc123?sig=s1gnature';

const PUBLIC = [{ address: '93.184.216.34', family: 4 }];

// A DNS double: every hostname maps to whatever the test says.
const lookupReturning = (map) =>
  jest.fn(async (hostname) => {
    if (!(hostname in map)) throw new Error(`ENOTFOUND ${hostname}`);
    return map[hostname];
  });

const LOOKUP_MAP = {
  [HOST]: PUBLIC,
  'files.example-cdn.test': PUBLIC,
  'internal.example.test': [{ address: '169.254.169.254', family: 4 }],
};

// Synthetic magic-byte payloads; only the signature matters to the sniffer.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(24, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(28, 2)]);
const LOGIN_PAGE = Buffer.from('<!DOCTYPE html><html><body>Log in to Canvas</body></html>');

const headersOf = (map) => ({ get: (key) => map[key.toLowerCase()] ?? null });

// A ReadableStream-shaped body that hands out `chunks` one read at a time.
const streamOf = (chunks) => {
  let i = 0;
  const reader = {
    read: jest.fn(async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true })),
    cancel: jest.fn(async () => {}),
  };
  return { getReader: jest.fn(() => reader), cancel: jest.fn(async () => {}), reader };
};

const okResponse = (chunks, headers = {}) => ({
  status: 200,
  headers: headersOf({ 'content-type': 'image/png', ...headers }),
  body: streamOf(Array.isArray(chunks) ? chunks : [chunks]),
});

const statusResponse = (status, headers = {}) => ({
  status,
  headers: headersOf(headers),
  body: streamOf([Buffer.from('error page')]),
});

const redirectTo = (location) => statusResponse(302, { location });

const fetcherWith = (fetchFn, options = {}) =>
  createCanvasImageFetcher({
    hosts: new Set([HOST]),
    fetchFn,
    lookup: lookupReturning(LOOKUP_MAP),
    maxBytes: 64,
    ...options,
  });

// Settles only when the fetch's abort signal fires, rejecting with its reason as
// undici does for both a pending request and a body that is still streaming.
const untilAborted = (signal) =>
  new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason));
  });

let warnSpy;
beforeEach(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('canvasImageHostsFromEnv', () => {
  it('allows only canvas.ubc.ca when nothing is configured', () => {
    expect([...canvasImageHostsFromEnv({})]).toEqual(['canvas.ubc.ca']);
  });

  it('adds the host of CANVAS_DOMAIN however it is spelled', () => {
    expect([...canvasImageHostsFromEnv({ CANVAS_DOMAIN: 'HTTPS://Canvas.Example.Test/login' })]).toEqual([
      'canvas.ubc.ca',
      'canvas.example.test',
    ]);
    expect([...canvasImageHostsFromEnv({ CANVAS_DOMAIN: 'canvas.example.test' })]).toEqual([
      'canvas.ubc.ca',
      'canvas.example.test',
    ]);
  });

  it('keeps a non-default port so only that port is allowed', () => {
    expect([...canvasImageHostsFromEnv({ CANVAS_DOMAIN: 'https://canvas.example.test:8443' })]).toEqual([
      'canvas.ubc.ca',
      'canvas.example.test:8443',
    ]);
  });

  it('adds every CANVAS_IMPORT_IMAGE_HOSTS entry, trimmed and lower-cased, skipping blanks', () => {
    const hosts = canvasImageHostsFromEnv({
      CANVAS_DOMAIN: 'canvas.example.test',
      CANVAS_IMPORT_IMAGE_HOSTS: ' Files.Example.Test , ,https://other.example.test/ ',
    });
    expect([...hosts]).toEqual([
      'canvas.ubc.ca',
      'canvas.example.test',
      'files.example.test',
      'other.example.test',
    ]);
  });

  it('ignores an unparseable CANVAS_DOMAIN', () => {
    expect([...canvasImageHostsFromEnv({ CANVAS_DOMAIN: 'https://' })]).toEqual(['canvas.ubc.ca']);
  });
});

describe('isAllowedCanvasImageUrl', () => {
  const hosts = new Set([HOST]);

  it.each([
    [`https://${HOST}/assessment_questions/12/files/345/download?verifier=x`],
    [`https://${HOST}/assessment_questions/12/files/345`],
    [`https://${HOST}/courses/7/files/345/download?wrap=1`],
    [`https://${HOST}/courses/7/files/345/preview`],
    [`https://${HOST}/courses/7/files/345/`],
    [`https://${HOST}/files/345/download?download_frd=1`],
  ])('allows the Canvas file link %s', (url) => {
    expect(isAllowedCanvasImageUrl(url, hosts)).toBe(true);
  });

  it.each([
    [`http://${HOST}/assessment_questions/12/files/345/download`, 'plain http'],
    ['https://evil.example.test/assessment_questions/12/files/345/download', 'a host not on the list'],
    [`https://${HOST}.evil.test/files/345/download`, 'a look-alike host'],
    [`https://${HOST}:8443/files/345/download`, 'another port on the listed host'],
    [`https://${HOST}/equation_images/%255Cfrac%257B1%257D%257B2%257D`, 'an equation image'],
    [`https://${HOST}/api/v1/courses/7/files/345`, 'the API'],
    [`https://${HOST}/files/345`, 'a file page that is not a download'],
    [`https://${HOST}/courses/7/files/345/download/../../../../api/v1/users/self`, 'a dot-dot escape'],
    [`https://${HOST}/courses/abc/files/345/download`, 'a non-numeric id'],
    [`https://${HOST}/users/7/files/345/download`, 'another Canvas path'],
    [`https://user:pw@${HOST}/files/345/download`, 'embedded credentials'],
    ['$IMS-CC-FILEBASE$/assessment_questions/a.png', 'a bundled path'],
    ['not a url', 'garbage'],
  ])('rejects %s (%s)', (url) => {
    expect(isAllowedCanvasImageUrl(url, hosts)).toBe(false);
  });

  it('rejects a non-string or a missing host list', () => {
    expect(isAllowedCanvasImageUrl(undefined, hosts)).toBe(false);
    expect(isAllowedCanvasImageUrl(IMAGE_URL, undefined)).toBe(false);
  });

  it('allows a host listed through CANVAS_IMPORT_IMAGE_HOSTS', () => {
    const fromEnv = canvasImageHostsFromEnv({ CANVAS_IMPORT_IMAGE_HOSTS: 'files.example.test' });
    expect(isAllowedCanvasImageUrl('https://files.example.test/files/9/download', fromEnv)).toBe(true);
    expect(isAllowedCanvasImageUrl(IMAGE_URL, fromEnv)).toBe(false);
  });
});

describe('createCanvasImageFetcher', () => {
  describe('success', () => {
    it('downloads an allowed image and reports the sniffed type', async () => {
      const fetchFn = jest.fn(async () => okResponse(PNG));

      const result = await fetcherWith(fetchFn).fetchImage(IMAGE_URL);

      expect(result).toEqual({ ok: true, data: PNG, mimeType: 'image/png' });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      // The verifier must reach Canvas: it is what authorises the download.
      expect(fetchFn.mock.calls[0][0]).toBe(IMAGE_URL);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('reassembles a body that arrives in several chunks', async () => {
      const fetchFn = jest.fn(async () => okResponse([JPEG.subarray(0, 10), JPEG.subarray(10)]));

      const result = await fetcherWith(fetchFn).fetchImage(IMAGE_URL);

      expect(result).toEqual({ ok: true, data: JPEG, mimeType: 'image/jpeg' });
    });

    it('accepts a body of exactly maxBytes', async () => {
      const exact = Buffer.concat([PNG, Buffer.alloc(64 - PNG.length, 3)]);
      const fetchFn = jest.fn(async () => okResponse([exact.subarray(0, 40), exact.subarray(40)]));

      const result = await fetcherWith(fetchFn).fetchImage(IMAGE_URL);

      expect(result).toEqual({ ok: true, data: exact, mimeType: 'image/png' });
    });

    // Canvas never serves the bytes itself: /download 302s to a signed file host.
    it('follows a redirect to another public host', async () => {
      const fetchFn = jest
        .fn()
        .mockResolvedValueOnce(redirectTo(SIGNED_URL))
        .mockResolvedValueOnce(okResponse(PNG));

      const result = await fetcherWith(fetchFn).fetchImage(IMAGE_URL);

      expect(result).toEqual({ ok: true, data: PNG, mimeType: 'image/png' });
      expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([IMAGE_URL, SIGNED_URL]);
    });

    it('defaults the host list to the environment', async () => {
      const saved = process.env.CANVAS_IMPORT_IMAGE_HOSTS;
      process.env.CANVAS_IMPORT_IMAGE_HOSTS = 'files.example.test';
      try {
        const fetchFn = jest.fn(async () => okResponse(PNG));
        const fetcher = createCanvasImageFetcher({
          fetchFn,
          lookup: lookupReturning({ 'files.example.test': PUBLIC }),
        });

        const result = await fetcher.fetchImage('https://files.example.test/files/9/download');

        expect(result).toEqual({ ok: true, data: PNG, mimeType: 'image/png' });
      } finally {
        if (saved === undefined) delete process.env.CANVAS_IMPORT_IMAGE_HOSTS;
        else process.env.CANVAS_IMPORT_IMAGE_HOSTS = saved;
      }
    });
  });

  describe('refused before any request', () => {
    it.each([
      [IMAGE_URL.replace(HOST, 'evil.example.test'), 'other host'],
      [IMAGE_URL.replace('https:', 'http:'), 'plain http'],
      [`https://${HOST}/equation_images/%255Cfrac`, 'equation image'],
      [`https://${HOST}/api/v1/users/self`, 'API path'],
    ])('returns host-not-allowed for %s (%s)', async (url) => {
      const fetchFn = jest.fn();
      const lookup = jest.fn();
      const fetcher = createCanvasImageFetcher({ hosts: new Set([HOST]), fetchFn, lookup });

      await expect(fetcher.fetchImage(url)).resolves.toEqual({ ok: false, reason: 'host-not-allowed' });
      expect(fetchFn).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
    });

    it('matches allowed hosts case-insensitively when the caller passes mixed case', async () => {
      const fetchFn = jest.fn(async () => okResponse(PNG));
      const fetcher = fetcherWith(fetchFn, { hosts: new Set(['Canvas.Example.TEST']) });

      await expect(fetcher.fetchImage(IMAGE_URL)).resolves.toEqual({
        ok: true,
        data: PNG,
        mimeType: 'image/png',
      });
    });
  });

  describe('failures', () => {
    it('blocks a redirect to a private address and does not follow it', async () => {
      const fetchFn = jest.fn(async () => redirectTo('http://10.0.0.5/latest/meta-data/'));

      const result = await fetcherWith(fetchFn).fetchImage(IMAGE_URL);

      expect(result).toEqual({ ok: false, reason: 'blocked' });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith('Canvas image fetch failed: blocked; 1 failed in this import');
    });

    it('blocks a redirect to a name that resolves to cloud metadata', async () => {
      const fetchFn = jest.fn(async () => redirectTo('https://internal.example.test/secrets'));

      const result = await fetcherWith(fetchFn).fetchImage(IMAGE_URL);

      expect(result).toEqual({ ok: false, reason: 'blocked' });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('blocks an allowed host whose DNS points inside the network', async () => {
      const fetchFn = jest.fn();
      const fetcher = fetcherWith(fetchFn, {
        lookup: lookupReturning({ [HOST]: [{ address: '127.0.0.1', family: 4 }] }),
      });

      await expect(fetcher.fetchImage(IMAGE_URL)).resolves.toEqual({ ok: false, reason: 'blocked' });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('gives up after five redirects', async () => {
      const fetchFn = jest.fn(async () => redirectTo(SIGNED_URL));

      const result = await fetcherWith(fetchFn).fetchImage(IMAGE_URL);

      expect(result).toEqual({ ok: false, reason: 'blocked' });
      expect(fetchFn).toHaveBeenCalledTimes(6);
    });

    it.each([[401], [404], [500]])('reports HTTP %i as http-<status> without reading the body', async (status) => {
      const response = statusResponse(status);
      const fetchFn = jest.fn(async () => response);

      const result = await fetcherWith(fetchFn).fetchImage(IMAGE_URL);

      expect(result).toEqual({ ok: false, reason: `http-${status}` });
      expect(response.body.getReader).not.toHaveBeenCalled();
      expect(response.body.cancel).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        `Canvas image fetch failed: http-${status}; 1 failed in this import`
      );
    });

    // An expired verifier: Canvas answers 200 with its login page.
    it('rejects an HTML page served with 200 as not-an-image', async () => {
      const fetchFn = jest.fn(async () => okResponse(LOGIN_PAGE, { 'content-type': 'text/html' }));

      const result = await fetcherWith(fetchFn, { maxBytes: 1024 }).fetchImage(IMAGE_URL);

      expect(result).toEqual({ ok: false, reason: 'not-an-image' });
    });

    it('rejects an empty body as not-an-image', async () => {
      const fetchFn = jest.fn(async () => okResponse([]));

      await expect(fetcherWith(fetchFn).fetchImage(IMAGE_URL)).resolves.toEqual({
        ok: false,
        reason: 'not-an-image',
      });
    });

    it('rejects an oversized Content-Length before reading the body', async () => {
      const response = okResponse(PNG, { 'content-length': '65' });
      const fetchFn = jest.fn(async () => response);

      const result = await fetcherWith(fetchFn).fetchImage(IMAGE_URL);

      expect(result).toEqual({ ok: false, reason: 'too-large' });
      expect(response.body.getReader).not.toHaveBeenCalled();
      expect(response.body.cancel).toHaveBeenCalledTimes(1);
    });

    // No Content-Length (or a lying one): the stream itself must be capped.
    it('stops reading a body that streams past maxBytes', async () => {
      const chunk = Buffer.concat([PNG, Buffer.alloc(40 - PNG.length)]);
      const response = okResponse([chunk, chunk, chunk, chunk]);
      const fetchFn = jest.fn(async () => response);

      const result = await fetcherWith(fetchFn).fetchImage(IMAGE_URL);

      expect(result).toEqual({ ok: false, reason: 'too-large' });
      expect(response.body.reader.read).toHaveBeenCalledTimes(2);
      expect(response.body.reader.cancel).toHaveBeenCalledTimes(1);
    });

    it('reports a request that never answers as timeout', async () => {
      const fetchFn = jest.fn((url, { signal }) => untilAborted(signal));

      const result = await fetcherWith(fetchFn, { perImageTimeoutMs: 20 }).fetchImage(IMAGE_URL);

      expect(result).toEqual({ ok: false, reason: 'timeout' });
      expect(warnSpy).toHaveBeenCalledWith('Canvas image fetch failed: timeout; 1 failed in this import');
    });

    it('reports a body that stalls mid-stream as timeout', async () => {
      const fetchFn = jest.fn(async (url, { signal }) => ({
        status: 200,
        headers: headersOf({}),
        body: { getReader: () => ({ read: () => untilAborted(signal), cancel: async () => {} }) },
      }));

      const result = await fetcherWith(fetchFn, { perImageTimeoutMs: 20 }).fetchImage(IMAGE_URL);

      expect(result).toEqual({ ok: false, reason: 'timeout' });
      expect(warnSpy).toHaveBeenCalledWith('Canvas image fetch failed: timeout; 1 failed in this import');
    });

    it('reports a connection failure as network and logs only its code', async () => {
      const fetchFn = jest.fn(async () => {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
      });

      const result = await fetcherWith(fetchFn).fetchImage(IMAGE_URL);

      expect(result).toEqual({ ok: false, reason: 'network' });
      expect(warnSpy).toHaveBeenCalledWith(
        'Canvas image fetch failed: network (ECONNRESET); 1 failed in this import'
      );
    });

    it('counts failures across the import in the log line', async () => {
      const fetchFn = jest.fn(async () => statusResponse(404));
      const fetcher = fetcherWith(fetchFn);

      await fetcher.fetchImage(IMAGE_URL);
      await fetcher.fetchImage(OTHER_IMAGE_URL);

      expect(warnSpy.mock.calls).toEqual([
        ['Canvas image fetch failed: http-404; 1 failed in this import'],
        ['Canvas image fetch failed: http-404; 2 failed in this import'],
      ]);
    });
  });

  describe('memo', () => {
    it('downloads a URL once however many times it is asked for', async () => {
      const fetchFn = jest.fn(async () => okResponse(PNG));
      const fetcher = fetcherWith(fetchFn);

      const first = await fetcher.fetchImage(IMAGE_URL);
      const second = await fetcher.fetchImage(IMAGE_URL);

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });

    it('shares one download between concurrent requests for the same URL', async () => {
      const fetchFn = jest.fn(async () => okResponse(PNG));
      const fetcher = fetcherWith(fetchFn);

      const results = await Promise.all([
        fetcher.fetchImage(IMAGE_URL),
        fetcher.fetchImage(IMAGE_URL),
        fetcher.fetchImage(IMAGE_URL),
      ]);

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(results).toEqual([
        { ok: true, data: PNG, mimeType: 'image/png' },
        { ok: true, data: PNG, mimeType: 'image/png' },
        { ok: true, data: PNG, mimeType: 'image/png' },
      ]);
    });

    it('does not retry a URL that failed', async () => {
      const fetchFn = jest.fn(async () => statusResponse(404));
      const fetcher = fetcherWith(fetchFn);

      await fetcher.fetchImage(IMAGE_URL);
      const again = await fetcher.fetchImage(IMAGE_URL);

      expect(again).toEqual({ ok: false, reason: 'http-404' });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('treats URLs that differ only in the query as different images', async () => {
      const fetchFn = jest.fn(async () => okResponse(PNG));
      const fetcher = fetcherWith(fetchFn);

      await fetcher.fetchImage(`https://${HOST}/files/345/download?verifier=one`);
      await fetcher.fetchImage(`https://${HOST}/files/345/download?verifier=two`);

      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('keeps memos separate between fetchers (one per import)', async () => {
      const fetchFn = jest.fn(async () => okResponse(PNG));

      await fetcherWith(fetchFn).fetchImage(IMAGE_URL);
      await fetcherWith(fetchFn).fetchImage(IMAGE_URL);

      expect(fetchFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('concurrency', () => {
    // Each download stays in flight until its body has been read to the end, a
    // few event-loop turns after the request, so overlapping downloads show up.
    const trackingFetch = () => {
      const state = { inFlight: 0, maxInFlight: 0 };
      const fetchFn = jest.fn(async () => {
        state.inFlight += 1;
        state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        let sent = false;
        return {
          status: 200,
          headers: headersOf({}),
          body: {
            getReader: () => ({
              read: async () => {
                await new Promise((resolve) => setImmediate(resolve));
                if (sent) {
                  state.inFlight -= 1;
                  return { done: true };
                }
                sent = true;
                return { done: false, value: PNG };
              },
              cancel: async () => {},
            }),
          },
        };
      });
      return { fetchFn, state };
    };

    const urls = [1, 2, 3, 4, 5].map((id) => `https://${HOST}/files/${id}/download?verifier=${VERIFIER}`);

    it('never runs more downloads at once than the limit', async () => {
      const { fetchFn, state } = trackingFetch();
      const fetcher = fetcherWith(fetchFn, { concurrency: 2 });

      const results = await Promise.all(urls.map((url) => fetcher.fetchImage(url)));

      expect(state.maxInFlight).toBe(2);
      expect(fetchFn).toHaveBeenCalledTimes(5);
      expect(results.every((result) => result.ok)).toBe(true);
    });

    it('keeps the limit when more images are asked for while others are downloading', async () => {
      const { fetchFn, state } = trackingFetch();
      const fetcher = fetcherWith(fetchFn, { concurrency: 2 });
      const more = [6, 7].map((id) => `https://${HOST}/files/${id}/download`);

      const early = urls.slice(0, 3).map((url) => fetcher.fetchImage(url));
      await early[0];
      const late = [...urls.slice(3), ...more].map((url) => fetcher.fetchImage(url));
      await Promise.all([...early, ...late]);

      expect(state.maxInFlight).toBe(2);
      expect(fetchFn).toHaveBeenCalledTimes(7);
    });

    it('defaults to six at once', async () => {
      const { fetchFn, state } = trackingFetch();
      const fetcher = fetcherWith(fetchFn);
      const many = Array.from({ length: 9 }, (_, id) => `https://${HOST}/files/${id}/download`);

      await Promise.all(many.map((url) => fetcher.fetchImage(url)));

      expect(state.maxInFlight).toBe(6);
    });

    it('frees the slot of a failed download for the next one', async () => {
      const fetchFn = jest
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(okResponse(PNG));
      const fetcher = fetcherWith(fetchFn, { concurrency: 1 });

      const results = await Promise.all([fetcher.fetchImage(urls[0]), fetcher.fetchImage(urls[1])]);

      expect(results).toEqual([
        { ok: false, reason: 'network' },
        { ok: true, data: PNG, mimeType: 'image/png' },
      ]);
    });
  });

  describe('the URL and its verifier stay secret', () => {
    it('never puts the URL or verifier in a reason or on the console', async () => {
      const consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((method) =>
        method === 'warn' ? warnSpy : jest.spyOn(console, method).mockImplementation(() => {})
      );
      const url = (id) => `https://${HOST}/assessment_questions/12/files/${id}/download?verifier=${VERIFIER}`;
      const scenarios = [
        jest.fn(async () => statusResponse(403)),
        jest.fn(async () => okResponse(LOGIN_PAGE)),
        jest.fn(async () => okResponse(PNG, { 'content-length': '999999' })),
        jest.fn(async () => redirectTo(`http://10.0.0.5/?next=${encodeURIComponent(url(4))}`)),
        jest.fn(async (target, { signal }) => untilAborted(signal)),
        // Some fetch errors quote the URL they were given.
        jest.fn(async (target) => {
          throw new TypeError(`Failed to parse URL from ${target}`, { cause: new Error(target) });
        }),
      ];

      const reasons = [];
      for (const [i, fetchFn] of scenarios.entries()) {
        const fetcher = fetcherWith(fetchFn, { perImageTimeoutMs: 20 });
        reasons.push((await fetcher.fetchImage(url(i))).reason);
      }
      const refused = createCanvasImageFetcher({ hosts: new Set(['elsewhere.example.test']) });
      reasons.push((await refused.fetchImage(url(99))).reason);

      expect(reasons).toEqual([
        'http-403',
        'not-an-image',
        'too-large',
        'blocked',
        'timeout',
        'network',
        'host-not-allowed',
      ]);
      const printed = JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls));
      expect(printed).not.toContain(VERIFIER);
      expect(printed).not.toContain(HOST);
      expect(printed).not.toContain('/files/');
      expect(warnSpy).toHaveBeenCalledTimes(7);
    });
  });
});
