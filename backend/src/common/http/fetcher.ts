/**
 * The seam between an adapter and the network.
 *
 * Adapters depend on this interface and never on how a request actually
 * travels. That is what lets the Iranian relay be added later without touching
 * a single adapter: a source row's fetch_mode selects DirectFetcher or
 * RelayFetcher, and the adapter cannot tell the difference.
 */

export interface FetchOptions {
  /** Sent as If-None-Match so an unchanged page costs a 304 instead of a body. */
  etag?: string;
  /** Sent as If-Modified-Since, for servers that do not issue ETags. */
  lastModified?: string;
  timeoutMs?: number;
}

export interface RawResponse {
  url: string;
  status: number;
  body: string;
  headers: Record<string, string>;
  /** True when the server answered 304 and `body` is therefore empty. */
  notModified: boolean;
  etag?: string;
  lastModified?: string;
}

export interface Fetcher {
  get(url: string, options?: FetchOptions): Promise<RawResponse>;
}

export class FetchError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
    readonly attempts?: number,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}
