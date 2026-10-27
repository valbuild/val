import { memoizePerRequest, type RequestScopedMemo } from "./requestScopedMemo";

describe("memoizePerRequest", () => {
  test("computes once for one box and one key", async () => {
    const box: RequestScopedMemo<number> = {};
    let calls = 0;
    const compute = async () => {
      calls++;
      return 42;
    };

    expect(await memoizePerRequest(box, "session-a", compute)).toBe(42);
    expect(await memoizePerRequest(box, "session-a", compute)).toBe(42);
    expect(await memoizePerRequest(box, "session-a", compute)).toBe(42);
    expect(calls).toBe(1);
  });

  test("concurrent callers share ONE computation", async () => {
    // The ordering that matters: React renders siblings at the same time, so
    // the second caller arrives before the first has resolved. Caching the
    // value rather than the promise would dedupe none of these.
    const box: RequestScopedMemo<number> = {};
    let calls = 0;
    let release!: (n: number) => void;
    const compute = () => {
      calls++;
      return new Promise<number>((resolve) => {
        release = resolve;
      });
    };

    const all = Promise.all([
      memoizePerRequest(box, "session-a", compute),
      memoizePerRequest(box, "session-a", compute),
      memoizePerRequest(box, "session-a", compute),
    ]);
    release(7);

    expect(await all).toStrictEqual([7, 7, 7]);
    expect(calls).toBe(1);
  });

  test("a DIFFERENT box is a different request, and shares nothing", async () => {
    // This is the whole safety property: the memoised body carries the
    // caller's own unpublished patches, so the next request must not see it.
    let calls = 0;
    const compute = async () => {
      calls++;
      return calls;
    };

    expect(await memoizePerRequest({}, "session-a", compute)).toBe(1);
    expect(await memoizePerRequest({}, "session-a", compute)).toBe(2);
    expect(calls).toBe(2);
  });

  test("a different key MISSES rather than serving the wrong session", async () => {
    const box: RequestScopedMemo<string> = {};
    const compute = (who: string) => async () => who;

    expect(await memoizePerRequest(box, "alice", compute("alice"))).toBe(
      "alice",
    );
    expect(await memoizePerRequest(box, "bob", compute("bob"))).toBe("bob");
    // ...and the box now holds bob's, not a stale alice.
    expect(await memoizePerRequest(box, "bob", compute("never"))).toBe("bob");
  });

  test("a null box computes every time, which is the pre-memo behaviour", async () => {
    // No request scope available is not an error: ineffective is safe here,
    // sharing is not.
    let calls = 0;
    const compute = async () => {
      calls++;
      return calls;
    };

    expect(await memoizePerRequest(null, "session-a", compute)).toBe(1);
    expect(await memoizePerRequest(null, "session-a", compute)).toBe(2);
    expect(calls).toBe(2);
  });

  test("a rejection is memoised too, so one failed read is not retried", async () => {
    const box: RequestScopedMemo<number> = {};
    let calls = 0;
    const compute = async (): Promise<number> => {
      calls++;
      throw new Error("boom");
    };

    await expect(memoizePerRequest(box, "s", compute)).rejects.toThrow("boom");
    await expect(memoizePerRequest(box, "s", compute)).rejects.toThrow("boom");
    expect(calls).toBe(1);
  });
});
