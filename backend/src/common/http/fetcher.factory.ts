import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DirectFetcher } from './direct-fetcher';
import { Fetcher } from './fetcher';

export const FETCHER_FACTORY = 'FETCHER_FACTORY';

export interface FetchTarget {
  name: string;
  /** DIRECT for reachable hosts, RELAY for those only an Iranian egress can reach. */
  fetchMode: 'DIRECT' | 'RELAY';
  ratePerSecond?: number;
}

export interface FetcherFactory {
  forSource(target: FetchTarget): Fetcher;
}

/**
 * Chooses how a source is fetched.
 *
 * This is the seam described in ARCHITECTURE.md section 2. Adapters take a
 * Fetcher and cannot tell how the request travels, so adding the Iranian relay
 * later means implementing one more branch here and switching a source row to
 * RELAY, with no adapter changing.
 *
 * It also gives tests somewhere to substitute saved fixtures instead of the
 * network.
 */
@Injectable()
export class DefaultFetcherFactory implements FetcherFactory {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  forSource(target: FetchTarget): Fetcher {
    if (target.fetchMode === 'RELAY') {
      // Deliberately not implemented yet. Failing loudly is better than
      // silently fetching direct, which would time out against a blocked host
      // and look like the source being down rather than a missing relay.
      throw new Error(
        `source "${target.name}" requires the Iran relay, which is not configured yet`,
      );
    }

    return new DirectFetcher({
      userAgent: this.config.get<string>('fetch.userAgent', 'ExhibitionReminderBot/1.0'),
      timeoutMs: this.config.get<number>('fetch.timeoutMs', 60_000),
      // A per-source limit wins, so one slow site can be throttled without
      // slowing every other source down.
      ratePerSecond: target.ratePerSecond ?? this.config.get<number>('fetch.ratePerSecond', 1),
      maxRetries: this.config.get<number>('fetch.maxRetries', 3),
    });
  }
}
