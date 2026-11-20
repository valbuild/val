import {
  capToolResult,
  cappedToolResult,
  MAX_CONTENT_TOOL_RESULT_CHARS,
} from "./capToolResult";

describe("capToolResult", () => {
  test("an answer that fits is handed back as it is", () => {
    const value = { "/a.val.ts": { type: "string" } };
    expect(capToolResult(value, { narrow: "n" })).toEqual({ value });
    expect(cappedToolResult(value, { narrow: "n" })).toBe(value);
  });

  test("a normal project's schemas fit: the bound is far above the showcase's 62k characters", () => {
    expect(MAX_CONTENT_TOOL_RESULT_CHARS).toBeGreaterThanOrEqual(150_000);
  });

  test("an object keeps whole entries that fit, names the rest, and says how to narrow", () => {
    const schemas = {
      "/a.val.ts": { fields: "a".repeat(2_800) },
      "/b.val.ts": { fields: "b".repeat(2_800) },
      "/c.val.ts": { fields: "c".repeat(2_800) },
      "/d.val.ts": { fields: "d".repeat(2_800) },
    };
    const capped = capToolResult(schemas, {
      narrow: "Ask with module_file_paths.",
      wholeDepth: 1,
      maxChars: 10_000,
    });
    expect(capped.value).toEqual({
      "/a.val.ts": schemas["/a.val.ts"],
      "/b.val.ts": schemas["/b.val.ts"],
    });
    expect(capped.omitted).toEqual([["/c.val.ts"], ["/d.val.ts"]]);
    expect(capped.truncated).toMatch(
      /2 parts were left out.*module_file_paths/,
    );
    expect(capped.truncated).not.toMatch(/Too large/);
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(10_000);
  });

  test("an entry too large to send even alone says so, with its size, and does not say to ask for it", () => {
    const schemas = {
      "/big.val.ts": { fields: "x".repeat(6_000) },
      "/a.val.ts": { fields: "a".repeat(100) },
    };
    const capped = capToolResult(schemas, {
      narrow: "Ask with module_file_paths.",
      wholeDepth: 1,
      maxChars: 5_000,
    });
    // Left out whole, never cut open, and it does not crowd out the small
    // one after it.
    expect(capped.value).toEqual({ "/a.val.ts": schemas["/a.val.ts"] });
    expect(capped.omitted).toEqual([["/big.val.ts"]]);
    expect(capped.truncated).toMatch(
      /Too large to send whole, even asked for alone: \["\/big\.val\.ts"\] \(60\d\d characters\)/,
    );
    expect(capped.truncated).not.toMatch(/module_file_paths/);
  });

  test("a single value too large is not answered as null: it is missing, and said to be too large", () => {
    const capped = cappedToolResult("x".repeat(10_000), {
      narrow: "Use a path.",
      maxChars: 5_000,
    });
    expect(capped).not.toHaveProperty("result", null);
    expect(JSON.stringify(capped)).not.toMatch(/"result"/);
    expect(capped).toMatchObject({
      truncated: expect.stringMatching(
        /Too large to send whole, even asked for alone: the value itself \(10002 characters\)/,
      ),
    });
    expect(JSON.stringify(capped)).not.toMatch(/Use a path/);
  });

  test("short omitted paths are named", () => {
    const record = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [`/m${i}.val.ts`, "v".repeat(100)]),
    );
    const capped = capToolResult(record, { narrow: "n", maxChars: 10_000 });
    expect(capped.omitted?.length).toBe(50);
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(10_000);
  });

  test("the bound holds however long the omitted paths are", () => {
    const longKey = (i: number) => `/${"k".repeat(1_500)}-${i}`;
    const record = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [longKey(i), "v".repeat(100)]),
    );
    for (const maxChars of [5_000, 20_000, 60_000]) {
      const capped = capToolResult(record, { narrow: "n", maxChars });
      expect(JSON.stringify(capped).length).toBeLessThanOrEqual(maxChars);
      expect(
        JSON.stringify(cappedToolResult(record, { narrow: "n", maxChars }))
          .length,
      ).toBeLessThanOrEqual(maxChars);
      expect(capped.truncated).toMatch(/left out/);
    }
  });

  test("an array keeps a prefix, so every index that is there is true", () => {
    const results = Array.from({ length: 100 }, (_, i) => ({
      i,
      text: "t".repeat(100),
    }));
    const capped = cappedToolResult(
      { results, total: 100 },
      { narrow: "Use limit.", maxChars: 6_000 },
    );
    if (
      typeof capped !== "object" ||
      capped === null ||
      !("results" in capped) ||
      !Array.isArray(capped.results)
    ) {
      throw new Error("expected results");
    }
    const kept = capped.results;
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(100);
    expect(kept).toEqual(results.slice(0, kept.length));
    expect(capped).toMatchObject({
      total: 100,
      truncated: expect.stringContaining("Use limit."),
      omitted: expect.arrayContaining([["results", String(kept.length)]]),
    });
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(6_000);
  });

  test("a container too big is cut open, and a string is never cut", () => {
    const source = {
      title: "Hello",
      body: "b".repeat(10_000),
      posts: Array.from({ length: 50 }, () => ({ text: "p".repeat(200) })),
    };
    const capped = capToolResult(source, { narrow: "n", maxChars: 8_000 });
    expect(capped.value).toMatchObject({ title: "Hello" });
    expect(capped.value).not.toHaveProperty("body");
    expect(capped.omitted).toContainEqual(["body"]);
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(8_000);
  });

  test("something that is not an object comes back under result", () => {
    const capped = cappedToolResult(
      Array.from({ length: 100 }, () => "x".repeat(100)),
      { narrow: "n", maxChars: 5_000 },
    );
    expect(capped).toMatchObject({
      result: expect.any(Array),
      truncated: expect.any(String),
    });
  });
});
