/**
 * Per-host request spacing.
 *
 * Section 47 of the brief forbids hammering a source. The limiter is keyed by
 * host rather than by source so that two adapters pointed at the same site
 * still queue behind one another, and it serialises through a promise chain so
 * concurrent callers cannot all pass the gate in the same tick.
 */
export class RateLimiter {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly lastStart = new Map<string, number>();

  constructor(
    private readonly minIntervalMs: number,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    private readonly now: () => number = Date.now,
  ) {}

  /** Resolves once the caller is allowed to issue a request to `host`. */
  async acquire(host: string): Promise<void> {
    const previous = this.chains.get(host) ?? Promise.resolve();

    const current = previous.then(async () => {
      const last = this.lastStart.get(host);
      if (last !== undefined) {
        const elapsed = this.now() - last;
        const wait = this.minIntervalMs - elapsed;
        if (wait > 0) await this.sleep(wait);
      }
      this.lastStart.set(host, this.now());
    });

    // Keep the chain alive even if a caller later rejects, otherwise one
    // failure would wedge the queue for that host.
    this.chains.set(
      host,
      current.catch(() => undefined),
    );

    return current;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
