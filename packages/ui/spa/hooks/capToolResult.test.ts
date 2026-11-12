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
      "/big.val.ts": { fields: "x".repeat(6_000) },
      "/a.val.ts": { fields: "a".repeat(100) },
      "/b.val.ts": { fields: "b".repeat(100) },
    };
    const capped = capToolResult(schemas, {
      narrow: "Ask with module_file_paths.",
      wholeDepth: 1,
      maxChars: 5_000,
    });
    // The big module is left out whole, never cut open: and it does not
    // crowd out the small ones after it.
    expect(capped.value).toEqual({
      "/a.val.ts": schemas["/a.val.ts"],
      "/b.val.ts": schemas["/b.val.ts"],
    });
    expect(capped.omitted).toEqual([["/big.val.ts"]]);
    expect(capped.truncated).toMatch(/1 part was left out.*module_file_paths/);
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(5_000);
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
