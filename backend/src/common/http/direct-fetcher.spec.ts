import { DirectFetcher } from './direct-fetcher';
import { FetchError } from './fetcher';
import { RateLimiter } from './rate-limiter';

const response = (
  status: number,
  body = '',
  headers: Record<string, string> = {},
): Response => new Response(status === 304 ? null : body, { status, headers });

const config = {
  userAgent: 'ExhibitionReminderBot/1.0 (+https://example.com/bot)',
  timeoutMs: 1000,
  ratePerSecond: 1000,
  maxRetries: 3,
  baseRetryDelayMs: 1,
};

/** Records sleeps instead of performing them, so tests stay instant. */
const recordingSleep = (log: number[]) => async (ms: number) => {
  log.push(ms);
};

describe('RateLimiter', () => {
  it('spaces requests to the same host', async () => {
    const slept: number[] = [];
    let clock = 0;
    const limiter = new RateLimiter(
      1000,
      async (ms) => {
        slept.push(ms);
        clock += ms;
      },
      () => clock,
    );

    await limiter.acquire('example.com');
    await limiter.acquire('example.com');
    await limiter.acquire('example.com');

    // First is free; each subsequent one waits the full interval.
    expect(slept).toEqual([1000, 1000]);
  });

  it('does not make one host wait for another', async () => {
    const slept: number[] = [];
    let clock = 0;
    const limiter = new RateLimiter(
      1000,
      async (ms) => {
        slept.push(ms);
        clock += ms;
      },
      () => clock,
    );

    await limiter.acquire('a.example');
    await limiter.acquire('b.example');

    expect(slept).toEqual([]);
  });

  it('keeps serving a host after a caller rejects', async () => {
    const limiter = new RateLimiter(0, async () => undefined);
    await limiter.acquire('example.com').then(() => {
      throw new Error('caller failed');
    }).catch(() => undefined);

    await expect(limiter.acquire('example.com')).resolves.toBeUndefined();
  });
});

describe('DirectFetcher', () => {
  it('sends the identifiable User-Agent required of a polite crawler', async () => {
    let seen: Record<string, string> = {};
    const fetcher = new DirectFetcher(config, async (_url, init) => {
      seen = init.headers as Record<string, string>;
      return response(200, 'ok');
    });

    await fetcher.get('https://example.com/a');

    expect(seen['User-Agent']).toContain('ExhibitionReminderBot');
    expect(seen['User-Agent']).toContain('example.com/bot');
  });

  it('sends conditional headers and reports a 304 without a body', async () => {
    let seen: Record<string, string> = {};
    const fetcher = new DirectFetcher(config, async (_url, init) => {
      seen = init.headers as Record<string, string>;
      return response(304, '', { etag: 'W/"abc"' });
    });

    const result = await fetcher.get('https://example.com/a', {
      etag: 'W/"abc"',
      lastModified: 'Wed, 21 Oct 2026 07:28:00 GMT',
    });

    expect(seen['If-None-Match']).toBe('W/"abc"');
    expect(seen['If-Modified-Since']).toBe('Wed, 21 Oct 2026 07:28:00 GMT');
    expect(result.notModified).toBe(true);
    expect(result.body).toBe('');
  });

  it('returns the body and caching headers on success', async () => {
    const fetcher = new DirectFetcher(config, async () =>
      response(200, '<html>hi</html>', { etag: 'W/"v2"', 'last-modified': 'yesterday' }),
    );

    const result = await fetcher.get('https://example.com/a');

    expect(result.status).toBe(200);
    expect(result.body).toBe('<html>hi</html>');
    expect(result.etag).toBe('W/"v2"');
    expect(result.lastModified).toBe('yesterday');
    expect(result.notModified).toBe(false);
  });

  it('retries a 500 and succeeds when the server recovers', async () => {
    let calls = 0;
    const fetcher = new DirectFetcher(config, async () => {
      calls += 1;
      return calls < 3 ? response(500) : response(200, 'recovered');
    });

    const result = await fetcher.get('https://example.com/a');

    expect(calls).toBe(3);
    expect(result.body).toBe('recovered');
  });

  it('backs off exponentially between retries', async () => {
    const slept: number[] = [];
    const fetcher = new DirectFetcher(
      { ...config, maxRetries: 4, baseRetryDelayMs: 100 },
      async () => response(503),
      recordingSleep(slept),
      // A limiter that never waits, so the array holds backoff delays only.
      new RateLimiter(0, async () => undefined),
    );

    await expect(fetcher.get('https://example.com/a')).rejects.toThrow(FetchError);

    expect(slept).toHaveLength(3);
    // Full jitter: delay n lies in [base, base + base * 2^(n-1)].
    expect(slept[0]).toBeGreaterThanOrEqual(100);
    expect(slept[0]).toBeLessThanOrEqual(200);
    expect(slept[2]).toBeLessThanOrEqual(500);
    // The ceiling grows, even though any single sample may not.
    expect(Math.max(...slept)).toBeGreaterThanOrEqual(slept[0]);
  });

  it('obeys Retry-After on a 429 instead of its own backoff', async () => {
    const slept: number[] = [];
    let calls = 0;
    const fetcher = new DirectFetcher(
      config,
      async () => {
        calls += 1;
        return calls === 1 ? response(429, '', { 'retry-after': '7' }) : response(200, 'ok');
      },
      recordingSleep(slept),
      new RateLimiter(0, async () => undefined),
    );

    await fetcher.get('https://example.com/a');

    expect(slept).toEqual([7000]);
  });

  it('does not retry a 404, which will not improve', async () => {
    let calls = 0;
    const fetcher = new DirectFetcher(config, async () => {
      calls += 1;
      return response(404);
    });

    await expect(fetcher.get('https://example.com/missing')).rejects.toThrow('HTTP 404');
    expect(calls).toBe(1);
  });

  it('gives up after maxRetries and reports the attempt count', async () => {
    let calls = 0;
    const fetcher = new DirectFetcher(
      config,
      async () => {
        calls += 1;
        throw new Error('ECONNRESET');
      },
      recordingSleep([]),
    );

    await expect(fetcher.get('https://example.com/a')).rejects.toThrow(/ECONNRESET/);
    expect(calls).toBe(3);
  });

  it('aborts a request that exceeds the timeout', async () => {
    const fetcher = new DirectFetcher(
      { ...config, timeoutMs: 10, maxRetries: 1 },
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      recordingSleep([]),
    );

    await expect(fetcher.get('https://example.com/slow')).rejects.toThrow(/aborted/);
  });

  it('rate limits across separate calls to the same host', async () => {
    const slept: number[] = [];
    let clock = 0;
    const limiter = new RateLimiter(
      1000,
      async (ms) => {
        slept.push(ms);
        clock += ms;
      },
      () => clock,
    );
    const fetcher = new DirectFetcher(
      config,
      async () => response(200, 'ok'),
      recordingSleep([]),
      limiter,
    );

    await Promise.all([
      fetcher.get('https://example.com/1'),
      fetcher.get('https://example.com/2'),
    ]);

    expect(slept).toEqual([1000]);
  });
});
