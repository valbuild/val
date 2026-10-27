import type { ModuleFilePath } from "@valbuild/core";
import {
  batchJsonEntries,
  chunkJsonEntryKeys,
  JSON_ENTRY_KEYS_PER_REQUEST,
  JSON_ENTRY_KEYS_QUERY_BUDGET,
  type FetchJsonEntries,
  type JsonEntryResult,
} from "./jsonEntriesBatch";

const MODULE = "/content/authors.val.ts" as ModuleFilePath;
const OTHER = "/content/pages.val.ts" as ModuleFilePath;

/** The flush a test drives by hand, so nothing here waits on a timer. */
function manualSchedule(): {
  schedule: (flush: () => void) => void;
  run: () => void;
} {
  const queued: (() => void)[] = [];
  return {
    schedule: (flush) => queued.push(flush),
    run: () => {
      const toRun = queued.splice(0, queued.length);
      for (const flush of toRun) {
        flush();
      }
    },
  };
}

/** A seam that records what it was asked for and answers every key. */
function recordingSeam(
  answer: (key: string) => JsonEntryResult = (key) => ({
    status: "ok",
    content: key,
  }),
): { fetch: FetchJsonEntries; calls: { path: string; keys: string[] }[] } {
  const calls: { path: string; keys: string[] }[] = [];
  return {
    calls,
    fetch: async (moduleFilePath, keys) => {
      calls.push({ path: moduleFilePath, keys });
      return Object.fromEntries(keys.map((key) => [key, answer(key)]));
    },
  };
}

describe("chunkJsonEntryKeys", () => {
  test("keeps a small ask in one request", () => {
    expect(chunkJsonEntryKeys(["a", "b", "c"])).toEqual([["a", "b", "c"]]);
  });

  test("nothing asked for is nothing requested", () => {
    expect(chunkJsonEntryKeys([])).toEqual([]);
  });

  test("splits at the per-request key maximum", () => {
    // Short keys, so only the count can be what splits these.
    const keys = Array.from(
      { length: JSON_ENTRY_KEYS_PER_REQUEST + 5 },
      (_, i) => i.toString(),
    );
    const chunks = chunkJsonEntryKeys(keys);
    expect(chunks.map((chunk) => chunk.length)).toEqual([
      JSON_ENTRY_KEYS_PER_REQUEST,
      5,
    ]);
    expect(chunks.flat()).toEqual(keys);
  });

  test("no request is a long pole: none carries more than the cap", () => {
    const keys = Array.from({ length: 300 }, (_, i) => `key-${i}`);
    for (const chunk of chunkJsonEntryKeys(keys)) {
      expect(chunk.length).toBeLessThanOrEqual(JSON_ENTRY_KEYS_PER_REQUEST);
    }
  });

  test("splits on the URL budget before the key maximum when keys are long", () => {
    const keys = Array.from({ length: 40 }, (_, i) => `${"k".repeat(400)}${i}`);
    const chunks = chunkJsonEntryKeys(keys);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(keys);
    for (const chunk of chunks) {
      const query = chunk.map((key) => `&keys=${encodeURIComponent(key)}`);
      // One key on its own is allowed to exceed the budget; more than one is not.
      if (chunk.length > 1) {
        expect(query.join("").length).toBeLessThanOrEqual(
          JSON_ENTRY_KEYS_QUERY_BUDGET,
        );
      }
    }
  });

  test("a single key too long for any URL is still asked for", () => {
    const key = "k".repeat(JSON_ENTRY_KEYS_QUERY_BUDGET * 2);
    expect(chunkJsonEntryKeys([key])).toEqual([[key]]);
  });

  test("spends the budget on encoded length, not raw length", () => {
    // Each space encodes to three characters, so these cost 3x what they look
    // like — a chunker measuring raw length would fit them all in one request.
    const keys = Array.from({ length: 20 }, (_, i) => `${" ".repeat(30)}${i}`);
    expect(chunkJsonEntryKeys(keys).length).toBeGreaterThan(1);
  });
});

describe("batchJsonEntries", () => {
  test("one request for every key asked for in the same tick", async () => {
    const { schedule, run } = manualSchedule();
    const seam = recordingSeam();
    const fetchJsonEntry = batchJsonEntries(seam.fetch, schedule);

    const reads = [
      fetchJsonEntry(MODULE, "one"),
      fetchJsonEntry(MODULE, "two"),
      fetchJsonEntry(MODULE, "three"),
    ];
    run();

    expect(await Promise.all(reads)).toEqual([
      { status: "ok", content: "one" },
      { status: "ok", content: "two" },
      { status: "ok", content: "three" },
    ]);
    expect(seam.calls).toEqual([
      { path: MODULE, keys: ["one", "two", "three"] },
    ]);
  });

  test("one request per module: the endpoint takes one path", async () => {
    const { schedule, run } = manualSchedule();
    const seam = recordingSeam();
    const fetchJsonEntry = batchJsonEntries(seam.fetch, schedule);

    const reads = [
      fetchJsonEntry(MODULE, "a"),
      fetchJsonEntry(OTHER, "b"),
      fetchJsonEntry(MODULE, "c"),
    ];
    run();
    await Promise.all(reads);

    expect(seam.calls).toEqual([
      { path: MODULE, keys: ["a", "c"] },
      { path: OTHER, keys: ["b"] },
    ]);
  });

  test("the next wave is its own request", async () => {
    const { schedule, run } = manualSchedule();
    const seam = recordingSeam();
    const fetchJsonEntry = batchJsonEntries(seam.fetch, schedule);

    const first = fetchJsonEntry(MODULE, "a");
    run();
    await first;
    const second = fetchJsonEntry(MODULE, "b");
    run();
    await second;

    expect(seam.calls).toEqual([
      { path: MODULE, keys: ["a"] },
      { path: MODULE, keys: ["b"] },
    ]);
  });

  test("two readers of one key are one key in the request, and both get the answer", async () => {
    const { schedule, run } = manualSchedule();
    const seam = recordingSeam();
    const fetchJsonEntry = batchJsonEntries(seam.fetch, schedule);

    const reads = [fetchJsonEntry(MODULE, "a"), fetchJsonEntry(MODULE, "a")];
    run();

    expect(await Promise.all(reads)).toEqual([
      { status: "ok", content: "a" },
      { status: "ok", content: "a" },
    ]);
    expect(seam.calls).toEqual([{ path: MODULE, keys: ["a"] }]);
  });

  test("a key the response never mentions fails, rather than never settling", async () => {
    const { schedule, run } = manualSchedule();
    const fetchJsonEntry = batchJsonEntries(
      async (_, keys) =>
        // Answers the first key only: the shape a server produces for a key that
        // was deleted on disk between the source sync and this request.
        Object.fromEntries(
          keys.slice(0, 1).map((key) => [key, { status: "ok", content: key }]),
        ),
      schedule,
    );

    const reads = [
      fetchJsonEntry(MODULE, "here"),
      fetchJsonEntry(MODULE, "gone"),
    ];
    run();
    const [first, second] = await Promise.all(reads);

    expect(first).toEqual({ status: "ok", content: "here" });
    expect(second.status).toBe("error");
    expect(second.status === "error" && second.message).toContain("gone");
  });

  test("a throwing seam fails every key in the batch", async () => {
    const { schedule, run } = manualSchedule();
    const fetchJsonEntry = batchJsonEntries(async () => {
      throw new Error("offline");
    }, schedule);

    const reads = [fetchJsonEntry(MODULE, "a"), fetchJsonEntry(MODULE, "b")];
    run();

    expect(await Promise.all(reads)).toEqual([
      { status: "error", message: "offline" },
      { status: "error", message: "offline" },
    ]);
  });

  test("more keys than one request may carry are split, and every reader still answered", async () => {
    const { schedule, run } = manualSchedule();
    const seam = recordingSeam();
    const fetchJsonEntry = batchJsonEntries(seam.fetch, schedule);

    const keys = Array.from(
      { length: JSON_ENTRY_KEYS_PER_REQUEST + 3 },
      (_, i) => `key-${i}`,
    );
    const reads = keys.map((key) => fetchJsonEntry(MODULE, key));
    run();
    const results = await Promise.all(reads);

    expect(results).toEqual(
      keys.map((key) => ({ status: "ok", content: key })),
    );
    expect(seam.calls.map((call) => call.keys.length)).toEqual([
      JSON_ENTRY_KEYS_PER_REQUEST,
      3,
    ]);
  });

  test("chunks of one module go out together, not one after the other", async () => {
    const { schedule, run } = manualSchedule();
    let concurrent = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    const fetchJsonEntry = batchJsonEntries(async (_, keys) => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise<void>((resolve) => release.push(resolve));
      concurrent -= 1;
      return Object.fromEntries(
        keys.map((key) => [key, { status: "ok", content: key } as const]),
      );
    }, schedule);

    const keys = Array.from(
      { length: JSON_ENTRY_KEYS_PER_REQUEST * 3 },
      (_, i) => `key-${i}`,
    );
    const reads = keys.map((key) => fetchJsonEntry(MODULE, key));
    run();
    // Let every chunk get as far as its own await before any of them finishes.
    await Promise.resolve();
    await Promise.resolve();
    expect(peak).toBe(3);
    for (const resolve of release) {
      resolve();
    }
    await Promise.all(reads);
  });

  test("by default the flush is scheduled, not immediate", async () => {
    const seam = recordingSeam();
    const fetchJsonEntry = batchJsonEntries(seam.fetch);

    const reads = [fetchJsonEntry(MODULE, "a"), fetchJsonEntry(MODULE, "b")];
    // Nothing has gone out yet: the point of the default schedule is to let the
    // rest of the render's reads arrive first.
    expect(seam.calls).toEqual([]);
    await Promise.all(reads);
    expect(seam.calls).toEqual([{ path: MODULE, keys: ["a", "b"] }]);
  });
});
