/**
 * A single-entry TTL cache with stale-while-revalidate and stale-if-error, used
 * to hold the live patch set fetched from Val.
 *
 * Live mode renders on every request, so without this every request would hit
 * Val. The states are:
 *
 * - fresh (`age < ttl`): return the entry
 * - stale (`ttl <= age < ttl + staleWhileRevalidate`): return the entry
 *   immediately and refresh in the background
 * - expired: await a refresh; if that fails, fall back to the stale entry
 *   (stale-if-error) and only return null when there is nothing at all
 *
 * `ttl === 0` means always refetch - concurrent callers within the same fetch
 * still share one request rather than stampeding.
 *
 * The key deliberately includes `baseSha` and not just the commit sha: the same
 * commit can be deployed several times with different evaluated sources (a
 * dependency bump changes baseSha without changing the commit), so a commit sha
 * alone does not identify a deploy and must never be treated as if it does. A
 * key change drops the previous entry, including for the stale-if-error path -
 * serving another deploy's patches is worse than serving no patches.
 */
export type LiveCacheOptions = {
  /** Seconds an entry is fresh. 0 = always refetch. */
  ttl: number;
  /** Seconds past `ttl` a stale entry may be served while it is refreshed. */
  staleWhileRevalidate: number;
  /** Milliseconds since the epoch. Injectable so tests do not need real timers. */
  now?: () => number;
};

type Entry<T> = {
  key: string;
  value: T;
  /** Milliseconds since the epoch at which `value` was fetched. */
  fetchedAt: number;
};

export class LiveCache<T> {
  private readonly ttlMs: number;
  private readonly staleWhileRevalidateMs: number;
  private readonly now: () => number;
  private entry: Entry<T> | null = null;
  /** In-flight refresh, so concurrent callers share one request. */
  private inFlight: { key: string; promise: Promise<T | null> } | null = null;

  constructor(options: LiveCacheOptions) {
    this.ttlMs = options.ttl * 1000;
    this.staleWhileRevalidateMs = options.staleWhileRevalidate * 1000;
    this.now = options.now ?? Date.now;
  }

  /**
   * Get the cached value for `key`, fetching if needed.
   *
   * `fetcher` must never throw for an expected failure (a network error, a bad
   * response): return null instead, and this falls back to a stale entry. A
   * thrown error is treated the same way, but is logged as unexpected.
   */
  async get(key: string, fetcher: () => Promise<T | null>): Promise<T | null> {
    const entry = this.entry?.key === key ? this.entry : null;
    const age = entry === null ? Infinity : this.now() - entry.fetchedAt;

    // ttl 0 means always refetch, so it skips the serve-without-awaiting
    // branches entirely - including staleWhileRevalidate, which would otherwise
    // reintroduce exactly the staleness ttl 0 asks us not to have. The cached
    // entry is still kept for stale-if-error below.
    if (this.ttlMs > 0) {
      if (entry !== null && age < this.ttlMs) {
        return entry.value;
      }
      if (entry !== null && age < this.ttlMs + this.staleWhileRevalidateMs) {
        // Stale: serve now, refresh behind the request. The refresh must not be
        // awaited and must not reject - a rejected floating promise would be an
        // unhandledRejection and take the process down in Node.
        this.refresh(key, fetcher).catch(() => {
          // handled in refresh()
        });
        return entry.value;
      }
    }
    // Expired or absent: we have to wait for the fetch.
    const value = await this.refresh(key, fetcher);
    if (value !== null) {
      return value;
    }
    // stale-if-error: an old patch set renders better content than none, and
    // "none" here means falling all the way back to the deployed content.
    return entry?.value ?? null;
  }

  private refresh(key: string, fetcher: () => Promise<T | null>) {
    if (this.inFlight && this.inFlight.key === key) {
      return this.inFlight.promise;
    }
    const promise = (async () => {
      try {
        return await fetcher();
      } catch (err) {
        // Expected failures are supposed to come back as null, so getting here
        // means something unforeseen: log it, but never fail the render.
        console.error(
          "Val: unexpected error while fetching live patches",
          err instanceof Error ? err.message : err,
        );
        return null;
      }
    })().then((value) => {
      if (this.inFlight?.promise === promise) {
        this.inFlight = null;
      }
      if (value !== null) {
        this.entry = { key, value, fetchedAt: this.now() };
      }
      return value;
    });
    this.inFlight = { key, promise };
    return promise;
  }

  /** Drop the cached entry. Exposed for tests and for a future invalidation hook. */
  clear() {
    this.entry = null;
    this.inFlight = null;
  }
}
