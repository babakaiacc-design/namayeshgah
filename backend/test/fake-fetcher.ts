import { FetchOptions, Fetcher, RawResponse } from '../src/common/http/fetcher';

export interface FakeRequest {
  url: string;
  method: 'GET' | 'POST';
  form?: Record<string, string>;
}

export type FakeHandler = (request: FakeRequest) => RawResponse | Promise<RawResponse>;

/**
 * Builds a Fetcher for tests from a single handler.
 *
 * Every spec used to declare its own object literal implementing the interface,
 * so adding one method to Fetcher broke seven files at once. Routing them all
 * through here means the next change to the seam is a one-line edit.
 */
export function fakeFetcher(handler: FakeHandler): Fetcher {
  return {
    get(url: string, _options?: FetchOptions) {
      return Promise.resolve(handler({ url, method: 'GET' }));
    },
    post(url: string, form: Record<string, string>, _options?: FetchOptions) {
      return Promise.resolve(handler({ url, method: 'POST', form }));
    },
  };
}

/** Convenience for the common case: a body keyed by a substring of the url. */
export function fetcherServing(pages: () => Record<string, string>): Fetcher {
  return fakeFetcher(({ url }) => {
    const entries = Object.entries(pages());
    const match = entries.find(([key]) => url.includes(key));
    return {
      url,
      status: 200,
      body: match ? match[1] : '',
      headers: {},
      notModified: false,
    };
  });
}

export function okResponse(url: string, body: string): RawResponse {
  return { url, status: 200, body, headers: {}, notModified: false };
}
