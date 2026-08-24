import { FetchError, FetchOptions, Fetcher, RawResponse } from './fetcher';
import { RateLimiter } from './rate-limiter';

export interface DirectFetcherConfig {
  userAgent: string;
  timeoutMs: number;
  ratePerSecond: number;
  maxRetries: number;
  /** Base backoff delay; each retry doubles it and adds jitter. */
  baseRetryDelayMs?: number;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Polite HTTP client for source adapters.
 *
 * Implements the obligations in section 47 of the brief: per-host rate
 * limiting, exponential backoff with jitter, hard timeouts, conditional
 * requests, and an identifiable User-Agent.
 */
export class DirectFetcher implements Fetcher {
  private readonly limiter: RateLimiter;
  private readonly baseRetryDelayMs: number;

  constructor(
    private readonly config: DirectFetcherConfig,
    private readonly fetchImpl: FetchLike = globalThis.fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    limiter?: RateLimiter,
  ) {
    const interval = Math.ceil(1000 / Math.max(1, config.ratePerSecond));
    this.limiter = limiter ?? new RateLimiter(interval, sleep);
    this.baseRetryDelayMs = config.baseRetryDelayMs ?? 1000;
  }

  async get(url: string, options: FetchOptions = {}): Promise<RawResponse> {
    return this.send('GET', url, undefined, options);
  }

  async post(
    url: string,
    form: Record<string, string>,
    options: FetchOptions = {},
  ): Promise<RawResponse> {
    return this.send('POST', url, new URLSearchParams(form).toString(), options);
  }

  private async send(
    method: 'GET' | 'POST',
    url: string,
    body: string | undefined,
    options: FetchOptions = {},
  ): Promise<RawResponse> {
    const host = new URL(url).host;
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;

    const headers: Record<string, string> = {
      'User-Agent': this.config.userAgent,
      Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8',
    };
    if (options.etag) headers['If-None-Match'] = options.etag;
    if (options.lastModified) headers['If-Modified-Since'] = options.lastModified;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt += 1) {
      await this.limiter.acquire(host);

      try {
        const response = await this.withTimeout(method, url, headers, body, timeoutMs);

        // 304 means our cached copy is still good — the cheapest possible sync.
        if (response.status === 304) {
          return {
            url,
            status: 304,
            body: '',
            headers: headerRecord(response),
            notModified: true,
            etag: response.headers.get('etag') ?? options.etag,
            lastModified: response.headers.get('last-modified') ?? options.lastModified,
          };
        }

        if (this.isRetryable(response.status)) {
          lastError = new FetchError(`HTTP ${response.status}`, url, response.status, attempt);
          if (attempt < this.config.maxRetries) {
            await this.sleep(this.retryDelay(attempt, response.headers.get('retry-after')));
            continue;
          }
          throw lastError;
        }

        if (!response.ok) {
          // 4xx other than 429 will not improve by asking again.
          throw new FetchError(`HTTP ${response.status}`, url, response.status, attempt);
        }

        return {
          url,
          status: response.status,
          body: await response.text(),
          headers: headerRecord(response),
          notModified: false,
          etag: response.headers.get('etag') ?? undefined,
          lastModified: response.headers.get('last-modified') ?? undefined,
        };
      } catch (error) {
        if (error instanceof FetchError && error.status !== undefined && !this.isRetryable(error.status)) {
          throw error;
        }

        lastError = error as Error;
        if (attempt < this.config.maxRetries) {
          await this.sleep(this.retryDelay(attempt));
          continue;
        }
      }
    }

    throw new FetchError(
      `Failed after ${this.config.maxRetries} attempts: ${lastError?.message ?? 'unknown error'}`,
      url,
      lastError instanceof FetchError ? lastError.status : undefined,
      this.config.maxRetries,
    );
  }

  private async withTimeout(
    method: 'GET' | 'POST',
    url: string,
    headers: Record<string, string>,
    body: string | undefined,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method,
        body,
        headers,
        signal: controller.signal,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private isRetryable(status: number): boolean {
    return status === 429 || status >= 500;
  }

  /**
   * Exponential backoff with full jitter. Jitter matters when several sources
   * fail at once — without it every retry lands in the same instant.
   * An explicit Retry-After always wins.
   */
  private retryDelay(attempt: number, retryAfter?: string | null): number {
    if (retryAfter) {
      const seconds = Number.parseInt(retryAfter, 10);
      if (!Number.isNaN(seconds) && seconds >= 0) return seconds * 1000;
    }
    const ceiling = this.baseRetryDelayMs * 2 ** (attempt - 1);
    return Math.floor(Math.random() * ceiling) + this.baseRetryDelayMs;
  }
}

function headerRecord(response: Response): Record<string, string> {
  const record: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return record;
}
