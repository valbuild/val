import {
  ChainProgress,
  describePendingChangesStall,
} from "./describePendingChangesStall";

/**
 * The report shown when unpublished changes never finish loading.
 *
 * The gate used to hold the fields behind a spinner with no deadline and no way
 * out: for one chain it never released, and the only recovery was to delete every
 * patch. Whatever is holding it has to be nameable, and the two halves — never
 * fetched, and fetched but not applied — are different faults in different
 * places, so they must not read the same.
 */
function progress(over: Partial<ChainProgress> = {}): ChainProgress {
  return {
    total: 0,
    settled: 0,
    unfetched: [],
    unapplied: [],
    failed: [],
    statSeen: true,
    ...over,
  };
}

describe("describePendingChangesStall", () => {
  test("no answer from the server at all is about reachability", () => {
    const stall = describePendingChangesStall(
      progress({ statSeen: false }),
      "Failed to fetch",
    );
    expect(stall.summary).toContain("Could not reach the server");
    // The error the transport reported, not a paraphrase of it.
    expect(stall.detail).toContain("Failed to fetch");
    expect(stall.detail).toContain("reload");
  });

  test("announced but undelivered changes are named, and counted", () => {
    const stall = describePendingChangesStall(
      progress({ total: 3, settled: 1, unfetched: ["a", "b"] }),
      null,
    );
    expect(stall.summary).toBe(
      "1 of 3 unpublished changes loaded. 2 never arrived.",
    );
    expect(stall.detail).toContain("a, b");
    // And the consequence of editing anyway, which is the part that matters.
    expect(stall.detail).toContain("may be lost");
  });

  test("a long list is truncated rather than dumped", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    const stall = describePendingChangesStall(
      progress({ total: 7, unfetched: ids }),
      null,
    );
    expect(stall.detail).toContain("a, b, c, d, e and 2 more");
  });

  test("the counts read as English when there is only one", () => {
    const one = describePendingChangesStall(
      progress({ total: 1, settled: 0, unfetched: ["a"] }),
      null,
    );
    expect(one.summary).toBe(
      "0 of 1 unpublished change loaded. 1 never arrived.",
    );
    const single = describePendingChangesStall(
      progress({ total: 2, settled: 1, unapplied: ["x"] }),
      null,
    );
    expect(single.summary).toContain("was not applied");
  });

  test("delivered but unapplied is a different fault, and says so", () => {
    const stall = describePendingChangesStall(
      progress({ total: 2, settled: 1, unapplied: ["x"] }),
      null,
    );
    expect(stall.summary).toContain("was not applied");
    expect(stall.detail).toContain("rather than at the network");
    expect(stall.detail).toContain("x");
  });

  test("the fetch half wins when both are outstanding", () => {
    // Nothing can be applied that has not been fetched, so the fetch is the
    // cause and the apply count is a consequence of it.
    const stall = describePendingChangesStall(
      progress({ total: 4, settled: 1, unfetched: ["a"], unapplied: ["b"] }),
      null,
    );
    expect(stall.summary).toContain("never arrived");
  });

  test("nothing outstanding reads as slow, not broken", () => {
    const stall = describePendingChangesStall(
      progress({ total: 2, settled: 2 }),
      null,
    );
    expect(stall.summary).toContain("longer than expected");
    expect(stall.detail).toContain("safe to dismiss");
  });
});
