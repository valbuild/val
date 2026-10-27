import type { HistoricalPatchSet } from "@valbuild/shared/internal";
import { HistoryStore } from "./HistoryStore";

function patchSet(commitSha: string): HistoricalPatchSet {
  return {
    commit: {
      commitSha,
      parentCommitSha: "p",
      clientCommitSha: "c",
      branch: "main",
      createdBranch: null,
      creator: null,
      message: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      seqNum: "1",
      patchCount: 0,
      hasArchive: true,
    },
    modules: {},
    patches: [],
    jsonEntries: {},
    binaryFiles: [],
    warnings: [],
  };
}

describe("HistoryStore", () => {
  // The actual reason this exists: a consumer asking twice must get the same
  // object, so React can skip the re-render.
  test("returns the identical object on repeat reads", () => {
    const store = new HistoryStore();
    const value = patchSet("a");
    store.set("a", value);
    expect(store.get("a")).toBe(value);
    expect(store.get("a")).toBe(store.get("a"));
  });

  test("misses are undefined, not thrown", () => {
    expect(new HistoryStore().get("nope")).toBeUndefined();
  });

  test("evicts the least recently used once full", () => {
    const store = new HistoryStore();
    for (let i = 0; i < 20; i++) {
      store.set(`c${i}`, patchSet(`c${i}`));
    }
    // Touch the oldest, so the SECOND oldest becomes the eviction candidate.
    expect(store.get("c0")).toBeDefined();
    store.set("c20", patchSet("c20"));
    expect(store.size).toBe(20);
    expect(store.get("c0")).toBeDefined();
    expect(store.get("c1")).toBeUndefined();
  });

  test("re-setting a commit does not grow the cache", () => {
    const store = new HistoryStore();
    store.set("a", patchSet("a"));
    store.set("a", patchSet("a"));
    expect(store.size).toBe(1);
  });
});
