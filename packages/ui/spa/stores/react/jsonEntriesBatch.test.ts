import {
  chunkJsonEntryKeys,
  JSON_ENTRY_KEYS_PER_REQUEST,
  JSON_ENTRY_KEYS_QUERY_BUDGET,
} from "./jsonEntriesBatch";

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
