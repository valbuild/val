import { initVal, type SerializedSchema } from "@valbuild/core";
import {
  classifyJsonValuesOp,
  findNestedJsonValuesRecords,
  getNewJsonEntryPaths,
  resolveExistingJsonPath,
} from "./jsonValuesPatch";

const { s } = initVal();

describe("classifyJsonValuesOp", () => {
  const rootJsonValues: SerializedSchema = s
    .record(s.object({ title: s.string(), order: s.number() }))
    .jsonValues()
    ["executeSerialize"]();

  test("field edit inside a root jsonValues entry → content sub-op", () => {
    const cls = classifyJsonValuesOp(rootJsonValues, ["/blog/hello", "title"]);
    expect(cls).toEqual({
      kind: "entry",
      recordPath: [],
      entryKey: "/blog/hello",
      subPath: ["title"],
    });
  });

  test("add/remove of an entry key → entry op with empty subPath", () => {
    expect(classifyJsonValuesOp(rootJsonValues, ["/blog/hello"])).toEqual({
      kind: "entry",
      recordPath: [],
      entryKey: "/blog/hello",
      subPath: [],
    });
  });

  test("nested jsonValues record under an object carries recordPath", () => {
    const nested: SerializedSchema = s
      .object({
        pages: s.record(s.object({ title: s.string() })).jsonValues(),
      })
      ["executeSerialize"]();
    expect(classifyJsonValuesOp(nested, ["pages", "/a/b", "title"])).toEqual({
      kind: "entry",
      recordPath: ["pages"],
      entryKey: "/a/b",
      subPath: ["title"],
    });
  });

  test("plain (non-jsonValues) record → normal", () => {
    const plain: SerializedSchema = s
      .record(s.object({ title: s.string() }))
      ["executeSerialize"]();
    expect(classifyJsonValuesOp(plain, ["/blog/hello", "title"])).toEqual({
      kind: "normal",
    });
  });

  test("op that does not reach the jsonValues record → normal", () => {
    const nested: SerializedSchema = s
      .object({
        title: s.string(),
        pages: s.record(s.object({ title: s.string() })).jsonValues(),
      })
      ["executeSerialize"]();
    expect(classifyJsonValuesOp(nested, ["title"])).toEqual({ kind: "normal" });
  });
});

describe("getNewJsonEntryPaths", () => {
  test("mirrors the entry key under a folder named after the .val.ts", () => {
    expect(getNewJsonEntryPaths("/test/pages.val.ts", "/blog/hello")).toEqual({
      jsonPath: "/test/pages/blog/hello.val.json",
      importPath: "./pages/blog/hello.val.json",
    });
  });

  test("handles nested module directories", () => {
    expect(
      getNewJsonEntryPaths("/app/support/[slug]/page.val.ts", "/support/faq"),
    ).toEqual({
      jsonPath: "/app/support/[slug]/page/support/faq.val.json",
      importPath: "./page/support/faq.val.json",
    });
  });
});

describe("findNestedJsonValuesRecords", () => {
  test("a root jsonValues record is allowed → no offenders", () => {
    const root: SerializedSchema = s
      .record(s.object({ title: s.string() }))
      .jsonValues()
      ["executeSerialize"]();
    expect(findNestedJsonValuesRecords(root)).toEqual([]);
  });

  test("a plain schema with no jsonValues → no offenders", () => {
    const plain: SerializedSchema = s
      .object({ pages: s.record(s.object({ title: s.string() })) })
      ["executeSerialize"]();
    expect(findNestedJsonValuesRecords(plain)).toEqual([]);
  });

  test("jsonValues nested under an object is reported", () => {
    const nested: SerializedSchema = s
      .object({
        title: s.string(),
        pages: s.record(s.object({ title: s.string() })).jsonValues(),
      })
      ["executeSerialize"]();
    expect(findNestedJsonValuesRecords(nested)).toEqual([["pages"]]);
  });

  test("jsonValues nested under an array is reported", () => {
    const nested: SerializedSchema = s
      .array(
        s.object({
          pages: s.record(s.object({ title: s.string() })).jsonValues(),
        }),
      )
      ["executeSerialize"]();
    expect(findNestedJsonValuesRecords(nested)).toEqual([["*", "pages"]]);
  });

  test("jsonValues nested under another record is reported", () => {
    const nested: SerializedSchema = s
      .record(
        s.object({
          pages: s.record(s.object({ title: s.string() })).jsonValues(),
        }),
      )
      ["executeSerialize"]();
    expect(findNestedJsonValuesRecords(nested)).toEqual([["*", "pages"]]);
  });

  test("multiple offenders are all reported", () => {
    const nested: SerializedSchema = s
      .object({
        a: s.record(s.object({ title: s.string() })).jsonValues(),
        b: s.object({
          c: s.record(s.object({ title: s.string() })).jsonValues(),
        }),
      })
      ["executeSerialize"]();
    expect(findNestedJsonValuesRecords(nested)).toEqual([["a"], ["b", "c"]]);
  });
});

describe("resolveExistingJsonPath", () => {
  test("resolves a hand-placed import path relative to the module dir", () => {
    expect(
      resolveExistingJsonPath("/test/pages.val.ts", "./content/hello.val.json"),
    ).toBe("/test/content/hello.val.json");
  });
});
