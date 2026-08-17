/**
 * H4 guards on instructor-supplied URL fetching (utils/safe-fetch-url.js).
 *
 * The material routes hand a user-named URL to the server and return the body,
 * so an unguarded fetch reads cloud metadata and internal services. These tests
 * pin each guard against the concrete attack it exists to stop.
 */

const {
  BlockedUrlError,
  fetchReadableText,
  fetchGuarded,
  readTextCapped,
  isBlockedIPv4,
  isBlockedIPv6,
  assertPublicHost,
} = require('../../src/utils/safe-fetch-url');

// A DNS double: every hostname maps to whatever the test says.
const lookupReturning = (map) =>
  jest.fn(async (hostname) => {
    if (!(hostname in map)) throw new Error(`ENOTFOUND ${hostname}`);
    return map[hostname];
  });

const PUBLIC = [{ address: '93.184.216.34', family: 4 }];

const htmlResponse = (html, headers = {}) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: new Map(Object.entries({ 'content-type': 'text/html', ...headers })),
  body: null,
  text: async () => html,
});

// `new Map()` lacks .get semantics for missing keys returning null, which is what
// the Headers API does. Wrap it.
const withHeaders = (response) => ({
  ...response,
  headers: { get: (key) => response.headers.get(key.toLowerCase()) ?? null },
});

describe('address classification', () => {
  it.each([
    ['169.254.169.254', 'cloud instance metadata'],
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'private 10/8'],
    ['172.16.0.1', 'private 172.16/12'],
    ['172.31.255.254', 'private 172.16/12 upper bound'],
    ['192.168.1.1', 'private 192.168/16'],
    ['100.64.0.1', 'CGNAT'],
    ['0.0.0.0', 'this network'],
    ['224.0.0.1', 'multicast'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedIPv4(address)).toBe(true);
  });

  it.each([['93.184.216.34'], ['8.8.8.8'], ['172.32.0.1'], ['172.15.0.1']])(
    'allows public %s',
    (address) => {
      expect(isBlockedIPv4(address)).toBe(false);
    }
  );

  it.each([['::1'], ['::'], ['fe80::1'], ['fc00::1'], ['fd12::3'], ['::ffff:127.0.0.1']])(
    'blocks IPv6 %s',
    (address) => {
      expect(isBlockedIPv6(address)).toBe(true);
    }
  );

  it('allows a public IPv6 address', () => {
    expect(isBlockedIPv6('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
  });
});

describe('assertPublicHost', () => {
  it('rejects a hostname that resolves to link-local (the metadata attack)', async () => {
    const lookup = lookupReturning({ 'evil.example': [{ address: '169.254.169.254', family: 4 }] });
    await expect(assertPublicHost('evil.example', lookup)).rejects.toThrow(BlockedUrlError);
  });

  // A name with one public and one loopback record would otherwise be a coin
  // flip decided by connect order.
  it('rejects when ANY resolved address is non-public', async () => {
    const lookup = lookupReturning({
      'split.example': [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
    });
    await expect(assertPublicHost('split.example', lookup)).rejects.toThrow(/non-public/);
  });

  it('rejects a bare private IP given as the host', async () => {
    await expect(assertPublicHost('169.254.169.254', jest.fn())).rejects.toThrow(BlockedUrlError);
  });

  it('rejects a name that does not resolve', async () => {
    await expect(assertPublicHost('nope.invalid', lookupReturning({}))).rejects.toThrow(
      /Could not resolve/
    );
  });

  it('allows a public host', async () => {
    await expect(
      assertPublicHost('example.com', lookupReturning({ 'example.com': PUBLIC }))
    ).resolves.toBeUndefined();
  });
});

describe('fetchGuarded', () => {
  it('rejects a non-http scheme', async () => {
    await expect(
      fetchGuarded('file:///etc/passwd', { fetchFn: jest.fn(), lookup: jest.fn() })
    ).rejects.toThrow(/Unsupported URL scheme/);
  });

  it('rejects a malformed URL', async () => {
    await expect(fetchGuarded('not a url', { fetchFn: jest.fn(), lookup: jest.fn() })).rejects.toThrow(
      /Invalid URL format/
    );
  });

  it('never calls fetch for a blocked host', async () => {
    const fetchFn = jest.fn();
    await expect(
      fetchGuarded('http://169.254.169.254/latest/meta-data/', { fetchFn, lookup: jest.fn() })
    ).rejects.toThrow(BlockedUrlError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // The obvious bypass: a public host that redirects inward. Following redirects
  // manually is what lets hop 2 be checked as strictly as hop 1.
  it('re-checks the address on a redirect and blocks an inward hop', async () => {
    const lookup = lookupReturning({
      'public.example': PUBLIC,
      'internal.example': [{ address: '127.0.0.1', family: 4 }],
    });
    const fetchFn = jest.fn(async () =>
      withHeaders({
        status: 302,
        headers: new Map([['location', 'http://internal.example/admin']]),
        body: { cancel: async () => {} },
      })
    );

    await expect(
      fetchGuarded('http://public.example/', { fetchFn, lookup })
    ).rejects.toThrow(/non-public/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('blocks a redirect to a private IP literal', async () => {
    const lookup = lookupReturning({ 'public.example': PUBLIC });
    const fetchFn = jest.fn(async () =>
      withHeaders({
        status: 301,
        headers: new Map([['location', 'http://192.168.0.1/']]),
        body: { cancel: async () => {} },
      })
    );

    await expect(fetchGuarded('http://public.example/', { fetchFn, lookup })).rejects.toThrow(
      /non-public/
    );
  });

  it('gives up after the redirect cap', async () => {
    const lookup = lookupReturning({ 'public.example': PUBLIC });
    const fetchFn = jest.fn(async () =>
      withHeaders({
        status: 302,
        headers: new Map([['location', 'http://public.example/again']]),
        body: { cancel: async () => {} },
      })
    );

    await expect(
      fetchGuarded('http://public.example/', { fetchFn, lookup, maxRedirects: 2 })
    ).rejects.toThrow(/Too many redirects/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('follows a redirect between public hosts', async () => {
    const lookup = lookupReturning({ 'a.example': PUBLIC, 'b.example': PUBLIC });
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(
        withHeaders({
          status: 302,
          headers: new Map([['location', 'http://b.example/page']]),
          body: { cancel: async () => {} },
        })
      )
      .mockResolvedValueOnce(withHeaders(htmlResponse('<html><body>ok</body></html>')));

    const { finalUrl } = await fetchGuarded('http://a.example/', { fetchFn, lookup });
    expect(finalUrl.toString()).toBe('http://b.example/page');
  });

  it('passes an abort signal so a hanging host cannot pin the request', async () => {
    const lookup = lookupReturning({ 'slow.example': PUBLIC });
    const fetchFn = jest.fn(async () => withHeaders(htmlResponse('<html></html>')));

    await fetchGuarded('http://slow.example/', { fetchFn, lookup });

    expect(fetchFn.mock.calls[0][1].signal).toBeDefined();
    expect(fetchFn.mock.calls[0][1].redirect).toBe('manual');
  });

  it('surfaces a fetch timeout as a client-safe error', async () => {
    const lookup = lookupReturning({ 'slow.example': PUBLIC });
    const fetchFn = jest.fn(async () => {
      const error = new Error('aborted');
      error.name = 'TimeoutError';
      throw error;
    });

    await expect(fetchGuarded('http://slow.example/', { fetchFn, lookup })).rejects.toThrow(
      /Timed out/
    );
  });
});

describe('readTextCapped', () => {
  const streamOf = (...buffers) => {
    let i = 0;
    return {
      getReader: () => ({
        read: async () =>
          i < buffers.length ? { done: false, value: buffers[i++] } : { done: true },
        cancel: async () => {},
      }),
    };
  };

  it('rejects a non-text content type instead of downloading it', async () => {
    await expect(
      readTextCapped(
        withHeaders({ headers: new Map([['content-type', 'video/mp4']]) }),
        1000
      )
    ).rejects.toThrow(/not a web page/);
  });

  it('stops reading at the byte cap rather than buffering everything', async () => {
    const chunk = Buffer.alloc(64, 'a');
    const response = {
      headers: { get: () => 'text/html' },
      body: streamOf(chunk, chunk, chunk, chunk),
    };

    const { text, truncated } = await readTextCapped(response, 100);

    expect(truncated).toBe(true);
    expect(text.length).toBe(100);
  });

  it('reads a small body whole', async () => {
    const response = {
      headers: { get: () => 'text/html' },
      body: streamOf(Buffer.from('<html>hi</html>')),
    };

    const { text, truncated } = await readTextCapped(response, 1000);

    expect(text).toBe('<html>hi</html>');
    expect(truncated).toBe(false);
  });
});

describe('fetchReadableText', () => {
  it('extracts main content and drops chrome', async () => {
    const lookup = lookupReturning({ 'good.example': PUBLIC });
    const html = `<html><head><title>Lecture 3</title></head><body>
      <nav>skip me</nav><script>alert(1)</script>
      <main><p>Cellular respiration converts glucose.</p></main>
      <footer>skip me too</footer></body></html>`;
    const fetchFn = jest.fn(async () => withHeaders(htmlResponse(html)));

    const result = await fetchReadableText('http://good.example/lecture', { fetchFn, lookup });

    expect(result.text).toContain('Cellular respiration converts glucose.');
    expect(result.text).not.toContain('skip me');
    expect(result.text).not.toContain('alert(1)');
    expect(result.title).toBe('Lecture 3');
  });

  it('rejects a non-2xx response', async () => {
    const lookup = lookupReturning({ 'good.example': PUBLIC });
    const fetchFn = jest.fn(async () =>
      withHeaders({ ok: false, status: 404, statusText: 'Not Found', headers: new Map() })
    );

    await expect(
      fetchReadableText('http://good.example/missing', { fetchFn, lookup })
    ).rejects.toThrow(/404/);
  });

  it('rejects a page with no extractable text', async () => {
    const lookup = lookupReturning({ 'good.example': PUBLIC });
    const fetchFn = jest.fn(async () => withHeaders(htmlResponse('<html><body></body></html>')));

    await expect(fetchReadableText('http://good.example/', { fetchFn, lookup })).rejects.toThrow(
      /No text content/
    );
  });
});
