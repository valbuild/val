import { LiveCache } from "./LiveCache";

/** A clock we control, so the tests never need real timers. */
function fakeClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advanceSeconds: (seconds: number) => {
      current += seconds * 1000;
    },
  };
}

/** Resolve the microtask queue, so background refreshes get to run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("LiveCache", () => {
  const KEY = "project|main|commit1|base1|0.1.0";

  test("fetches on a miss and caches the result", async () => {
    const clock = fakeClock();
    const cache = new LiveCache<string>({
      ttl: 60,
      staleWhileRevalidate: 0,
      now: clock.now,
    });
    const fetcher = jest.fn(async () => "v1");

    expect(await cache.get(KEY, fetcher)).toBe("v1");
    expect(await cache.get(KEY, fetcher)).toBe("v1");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("serves the cached value while it is fresh", async () => {
    const clock = fakeClock();
    const cache = new LiveCache<string>({
      ttl: 60,
      staleWhileRevalidate: 0,
      now: clock.now,
    });
    const fetcher = jest.fn(async () => "v1");

    await cache.get(KEY, fetcher);
    clock.advanceSeconds(59);
    expect(await cache.get(KEY, fetcher)).toBe("v1");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("refetches once the ttl has passed", async () => {
    const clock = fakeClock();
    const cache = new LiveCache<string>({
      ttl: 60,
      staleWhileRevalidate: 0,
      now: clock.now,
    });
    let value = "v1";
    const fetcher = jest.fn(async () => value);

    await cache.get(KEY, fetcher);
    clock.advanceSeconds(61);
    value = "v2";
    expect(await cache.get(KEY, fetcher)).toBe("v2");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("stale-while-revalidate serves the stale value and refreshes in the background", async () => {
    const clock = fakeClock();
    const cache = new LiveCache<string>({
      ttl: 60,
      staleWhileRevalidate: 300,
      now: clock.now,
    });
    let value = "v1";
    const fetcher = jest.fn(async () => value);

    await cache.get(KEY, fetcher);
    clock.advanceSeconds(61);
    value = "v2";

    // Inside the swr window: the stale value comes back immediately...
    expect(await cache.get(KEY, fetcher)).toBe("v1");
    expect(fetcher).toHaveBeenCalledTimes(2);

    // ...and the background refresh has replaced it by the next call.
    await flush();
    expect(await cache.get(KEY, fetcher)).toBe("v2");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("awaits the refresh once past the swr window", async () => {
    const clock = fakeClock();
    const cache = new LiveCache<string>({
      ttl: 60,
      staleWhileRevalidate: 300,
      now: clock.now,
    });
    let value = "v1";
    const fetcher = jest.fn(async () => value);

    await cache.get(KEY, fetcher);
    clock.advanceSeconds(361);
    value = "v2";
    expect(await cache.get(KEY, fetcher)).toBe("v2");
  });

  test("stale-if-error: a failed refresh falls back to the stale value", async () => {
    const clock = fakeClock();
    const cache = new LiveCache<string>({
      ttl: 60,
      staleWhileRevalidate: 0,
      now: clock.now,
    });
    let value: string | null = "v1";
    const fetcher = jest.fn(async () => value);

    await cache.get(KEY, fetcher);
    clock.advanceSeconds(61);
    value = null; // the fetch failed

    expect(await cache.get(KEY, fetcher)).toBe("v1");
    // ...and keeps falling back, rather than caching the failure
    clock.advanceSeconds(10_000);
    expect(await cache.get(KEY, fetcher)).toBe("v1");
  });

  test("returns null when the first fetch fails and there is nothing stale", async () => {
    const cache = new LiveCache<string>({ ttl: 60, staleWhileRevalidate: 0 });
    expect(await cache.get(KEY, async () => null)).toBeNull();
  });

  test("a thrown fetcher is treated as a failure, not a crash", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const clock = fakeClock();
      const cache = new LiveCache<string>({
        ttl: 60,
        staleWhileRevalidate: 0,
        now: clock.now,
      });
      await cache.get(KEY, async () => "v1");
      clock.advanceSeconds(61);

      expect(
        await cache.get(KEY, async () => {
          throw new Error("boom");
        }),
      ).toBe("v1");
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  test("ttl 0 always refetches", async () => {
    const cache = new LiveCache<string>({ ttl: 0, staleWhileRevalidate: 0 });
    let value = "v1";
    const fetcher = jest.fn(async () => value);

    expect(await cache.get(KEY, fetcher)).toBe("v1");
    value = "v2";
    expect(await cache.get(KEY, fetcher)).toBe("v2");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("ttl 0 ignores staleWhileRevalidate rather than serving stale", async () => {
    const cache = new LiveCache<string>({ ttl: 0, staleWhileRevalidate: 300 });
    let value = "v1";
    const fetcher = jest.fn(async () => value);

    await cache.get(KEY, fetcher);
    value = "v2";
    expect(await cache.get(KEY, fetcher)).toBe("v2");
  });

  test("ttl 0 still falls back to a stale value on failure", async () => {
    const cache = new LiveCache<string>({ ttl: 0, staleWhileRevalidate: 0 });
    expect(await cache.get(KEY, async () => "v1")).toBe("v1");
    expect(await cache.get(KEY, async () => null)).toBe("v1");
  });

  test("concurrent expired reads share a single fetch", async () => {
    const cache = new LiveCache<string>({ ttl: 0, staleWhileRevalidate: 0 });
    let resolveFetch: (value: string) => void = () => {};
    const fetcher = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const all = Promise.all([
      cache.get(KEY, fetcher),
      cache.get(KEY, fetcher),
      cache.get(KEY, fetcher),
    ]);
    resolveFetch("v1");

    expect(await all).toEqual(["v1", "v1", "v1"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("concurrent stale reads only kick off one background refresh", async () => {
    const clock = fakeClock();
    const cache = new LiveCache<string>({
      ttl: 60,
      staleWhileRevalidate: 300,
      now: clock.now,
    });
    const fetcher = jest.fn(async () => "v1");

    await cache.get(KEY, fetcher);
    clock.advanceSeconds(61);
    await Promise.all([
      cache.get(KEY, fetcher),
      cache.get(KEY, fetcher),
      cache.get(KEY, fetcher),
    ]);
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(2); // the initial one + one refresh
  });

  test("a different key never reuses the previous entry, including on failure", async () => {
    const clock = fakeClock();
    const cache = new LiveCache<string>({
      ttl: 60,
      staleWhileRevalidate: 300,
      now: clock.now,
    });
    // Same commit, different baseSha: a redeploy whose evaluated sources differ.
    const otherKey = "project|main|commit1|base2|0.1.0";

    expect(await cache.get(KEY, async () => "v1")).toBe("v1");
    expect(await cache.get(otherKey, async () => "v2")).toBe("v2");
    // Serving another deploy's patches would be worse than serving none.
    expect(
      await cache.get("project|main|commit2|base3|0.1.0", async () => null),
    ).toBeNull();
  });

  test("a slow refresh for an old key never overwrites a newer entry", async () => {
    const cache = new LiveCache<string>({ ttl: 60, staleWhileRevalidate: 0 });
    let resolveSlow: (value: string) => void = () => {};
    const slow = () =>
      new Promise<string>((resolve) => {
        resolveSlow = resolve;
      });

    // keyA is in flight when keyB starts, and keyB lands first.
    const a = cache.get("keyA", slow);
    const b = await cache.get("keyB", async () => "fromB");
    expect(b).toBe("fromB");
    resolveSlow("fromA");
    // The caller that asked for keyA still gets keyA's value...
    expect(await a).toBe("fromA");

    // ...but keyB's entry survived, and a failing keyB refresh falls back to it
    // rather than to keyA's patch set.
    expect(await cache.get("keyB", async () => null)).toBe("fromB");
  });

  test("clear() also discards a refresh that is already in flight", async () => {
    const cache = new LiveCache<string>({ ttl: 60, staleWhileRevalidate: 0 });
    let resolveFetch: (value: string) => void = () => {};
    const pending = cache.get(
      KEY,
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    cache.clear();
    resolveFetch("v1");
    expect(await pending).toBe("v1");

    // The cleared entry must not have been resurrected by the in-flight write.
    expect(await cache.get(KEY, async () => null)).toBeNull();
  });

  test("clear() drops the entry", async () => {
    const cache = new LiveCache<string>({ ttl: 60, staleWhileRevalidate: 0 });
    const fetcher = jest.fn(async () => "v1");

    await cache.get(KEY, fetcher);
    cache.clear();
    await cache.get(KEY, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
