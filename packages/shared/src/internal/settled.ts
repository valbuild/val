/*
 * What a server keeps between requests is a VALUE, never the promise of one.
 *
 * A site on Val's hosting runs in a workerd isolate, which serves many
 * requests and keeps what a module holds between them. A promise there
 * belongs to the request that created it: workerd settles it in that
 * request's I/O context, and once that request has ended -- the visitor
 * closed the tab, which on a page that takes seconds is often -- a promise
 * still pending can never settle. Another request awaiting it fails at once
 * with "This promise was created by a request that has since ended, so it can
 * never settle." Kept in a module, that one pending promise fails every
 * request after it, for the life of the isolate.
 *
 * So a cache on the serving path keeps what a load SETTLED to. Until there is
 * a value, each caller makes a promise of its own -- concurrent first reads
 * do the work twice, which is the price -- unless they share a `scope` (a
 * request, or one render's read env), which is never shared between
 * requests. A load that rejects keeps nothing: the next caller tries again.
 */

/** See the top of this file. */
export class SettledCache<K, V> {
  private readonly values = new Map<K, { value: V }>();
  private readonly inFlight = new WeakMap<object, Map<K, Promise<V>>>();

  constructor(
    private readonly opts: {
      /** Whether to keep this value; default: every fulfilled one. */
      keep?: (value: V) => boolean;
      /** At most this many values, the oldest let go first. */
      max?: number;
    } = {},
  ) {}

  /** The kept value for `key`, without waiting for anything. */
  peek(key: K): { value: V } | undefined {
    return this.values.get(key);
  }

  /**
   * The kept value, in a promise made for this caller; otherwise `load`,
   * kept when it settles. A caller passing the `scope` another caller is
   * loading under joins that load: one promise per key and scope.
   */
  get(key: K, load: () => Promise<V>, scope?: object): Promise<V> {
    const kept = this.peek(key);
    if (kept !== undefined) {
      return Promise.resolve(kept.value);
    }
    const loads = scope === undefined ? undefined : this.loadsOf(scope);
    const joined = loads?.get(key);
    if (joined !== undefined) {
      return joined;
    }
    const loading = load().then(
      (value) => {
        loads?.delete(key);
        if (this.opts.keep === undefined || this.opts.keep(value)) {
          this.set(key, value);
        }
        return value;
      },
      (err: unknown) => {
        loads?.delete(key);
        throw err;
      },
    );
    loads?.set(key, loading);
    return loading;
  }

  /** Keep `value` for `key`, as a settled load would. */
  set(key: K, value: V): void {
    this.values.delete(key);
    this.values.set(key, { value });
    const max = this.opts.max;
    if (max !== undefined) {
      for (const oldest of this.values.keys()) {
        if (this.values.size <= max) break;
        this.values.delete(oldest);
      }
    }
  }

  /** Forget the value for `key`: the next `get` loads again. */
  delete(key: K): void {
    this.values.delete(key);
  }

  private loadsOf(scope: object): Map<K, Promise<V>> {
    let loads = this.inFlight.get(scope);
    if (loads === undefined) {
      loads = new Map();
      this.inFlight.set(scope, loads);
    }
    return loads;
  }
}

/**
 * `load`, made once its result is in and kept from then on: the value, not
 * the promise (see {@link SettledCache}). Until then every call loads, and a
 * rejection keeps nothing.
 */
export function settledOnce<V>(load: () => Promise<V>): () => Promise<V> {
  const cache = new SettledCache<true, V>();
  return () => cache.get(true, load);
}
