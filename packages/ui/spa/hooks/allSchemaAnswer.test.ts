import { allSchemaAnswer } from "./allSchemaAnswer";

describe("get_all_schema's answer", () => {
  const schemas = {
    "/a.val.ts": { type: "object" },
    "/b.val.ts": { type: "string" },
  };

  test("every module, or the ones asked for", () => {
    expect(allSchemaAnswer(schemas, undefined)).toBe(schemas);
    expect(allSchemaAnswer(schemas, ["/b.val.ts"])).toEqual({
      "/b.val.ts": schemas["/b.val.ts"],
    });
  });

  test("paths that are not modules are named, rather than answered with {}", () => {
    expect(allSchemaAnswer(schemas, ["/nope.val.ts", "/a.val.ts"])).toEqual({
      schemas: { "/a.val.ts": schemas["/a.val.ts"] },
      notFound: ["/nope.val.ts"],
      note: expect.stringContaining("/nope.val.ts"),
    });
  });

  test("a module too large to send, asked for alone, says so rather than to ask for it again", () => {
    const answer = allSchemaAnswer(
      { "/huge.val.ts": { fields: "x".repeat(10_000) } },
      ["/huge.val.ts"],
      5_000,
    );
    expect(answer).toMatchObject({
      truncated: expect.stringMatching(/Too large to send whole/),
    });
    expect(JSON.stringify(answer)).not.toMatch(/Ask for the modules left out/);
  });
});
