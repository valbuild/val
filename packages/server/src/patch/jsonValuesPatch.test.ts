import { initVal, type SerializedSchema } from "@valbuild/core";
import {
  classifyJsonValuesOp,
  expandJsonValuesRootOp,
  expandJsonValuesRootOpForKey,
  findNestedJsonValuesRecords,
  getNewJsonEntryPaths,
  isJsonValuesRootOp,
  rebaseContentOp,
  resolveExistingJsonPath,
  type CurrentJsonEntries,
} from "./jsonValuesPatch";
import { result } from "@valbuild/core/fp";
import type { JSONValue, Operation } from "@valbuild/core/patch";

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

describe("a write of the whole record at a jsonValues module's root", () => {
  const jsonValues: SerializedSchema = s
    .record(s.object({ title: s.string() }))
    .jsonValues()
    ["executeSerialize"]();
  const plain: SerializedSchema = s
    .record(s.object({ title: s.string() }))
    ["executeSerialize"]();

  const entries = (
    current: Record<string, JSONValue | undefined>,
  ): CurrentJsonEntries => new Map(Object.entries(current));

  const expand = (
    value: JSONValue,
    current: Record<string, JSONValue | undefined>,
  ): Operation[] => {
    const res = expandJsonValuesRootOp(
      { op: "replace", path: [], value },
      entries(current),
    );
    if (result.isErr(res)) {
      throw new Error(`Expected ok, got: ${res.error.message}`);
    }
    return res.value;
  };

  describe("which ops are it", () => {
    test("a root replace on a jsonValues record is", () => {
      expect(
        isJsonValuesRootOp(jsonValues, { op: "replace", path: [], value: {} }),
      ).toBe(true);
    });

    test("so is a root add: at the root both mean 'the record is now this'", () => {
      expect(
        isJsonValuesRootOp(jsonValues, { op: "add", path: [], value: {} }),
      ).toBe(true);
    });

    test("an op that names an entry key is NOT: it is already routable", () => {
      expect(
        isJsonValuesRootOp(jsonValues, {
          op: "replace",
          path: ["/a"],
          value: {},
        }),
      ).toBe(false);
    });

    test("a root replace with null is not: emptying a nullable record is a source edit", () => {
      /*
       * A `.jsonValues()` record can be nullable, and `null` at the root says
       * the module has no record at all - there are no entries to write, so it
       * is the ordinary `.val.ts` write it always was. Expanding it would mean
       * refusing a write that used to work.
       */
      expect(
        isJsonValuesRootOp(jsonValues, {
          op: "replace",
          path: [],
          value: null,
        }),
      ).toBe(false);
    });

    test("a root replace on an ordinary record is not, so it stays a source edit", () => {
      // The conversion has to be invisible to every module that is not
      // `.jsonValues()`: a plain record's root replace is an ordinary `.val.ts`
      // write and must go on being one.
      expect(
        isJsonValuesRootOp(plain, { op: "replace", path: [], value: {} }),
      ).toBe(false);
    });
  });

  test("fans out into one op per entry key", () => {
    expect(
      expand(
        {
          "/a": { title: "A (was)" },
          "/unchanged": { title: "Same" },
          "/new": { title: "New" },
        },
        {
          "/a": { title: "A" },
          "/unchanged": { title: "Same" },
          "/gone": { title: "Gone" },
        },
      ),
    ).toEqual([
      { op: "replace", path: ["/a"], value: { title: "A (was)" } },
      { op: "add", path: ["/new"], value: { title: "New" } },
      { op: "remove", path: ["/gone"] },
    ]);
  });

  test("an entry that is already what the write says gets NO op", () => {
    // Otherwise putting a module back rewrites every `*.val.json` in it with
    // the bytes it already holds, and reads as a change to all of them.
    expect(expand({ "/a": { title: "A" } }, { "/a": { title: "A" } })).toEqual(
      [],
    );
  });

  test("an entry whose content is unknown is replaced, not skipped", () => {
    // The Studio's draft source holds markers, so it can only say WHICH entries
    // exist. Unknown has to mean "write it": skipping would drop a real edit.
    expect(expand({ "/a": { title: "A" } }, { "/a": undefined })).toEqual([
      { op: "replace", path: ["/a"], value: { title: "A" } },
    ]);
  });

  test("an empty record removes every entry", () => {
    expect(expand({}, { "/a": { title: "A" }, "/b": { title: "B" } })).toEqual([
      { op: "remove", path: ["/a"] },
      { op: "remove", path: ["/b"] },
    ]);
  });

  describe("what it says about ONE entry", () => {
    /*
     * The read path is about one entry, and expanding the whole record to find
     * the op that names it costs an op per entry per entry read. It asks for
     * that one key instead - through the same rule, which is what these
     * assertions pin: the same answer as the full expansion, case for case.
     */
    const forKey = (
      value: JSONValue,
      entryKey: string,
      current: Record<string, JSONValue | undefined>,
    ): Operation | null => {
      const res = expandJsonValuesRootOpForKey(
        { op: "replace", path: [], value },
        entryKey,
        entries(current),
      );
      if (result.isErr(res)) {
        throw new Error(`Expected ok, got: ${res.error.message}`);
      }
      return res.value;
    };

    test.each([
      ["a key only the record has", "/new", { "/new": { title: "New" } }, {}],
      [
        "a key that changed",
        "/a",
        { "/a": { title: "A!" } },
        { "/a": { title: "A" } },
      ],
      [
        "a key the record leaves as it is",
        "/a",
        { "/a": { title: "A" } },
        { "/a": { title: "A" } },
      ],
      ["a key the record does not name", "/gone", {}, { "/gone": {} }],
      ["a key that is in neither", "/nope", {}, {}],
    ])("%s", (_name, entryKey, value, current) => {
      const whole = expandJsonValuesRootOp(
        { op: "replace", path: [], value },
        entries(current),
      );
      if (result.isErr(whole)) {
        throw new Error(`Expected ok, got: ${whole.error.message}`);
      }
      const fromWhole =
        whole.value.find((op) => op.path[0] === entryKey) ?? null;
      expect(forKey(value, entryKey, current)).toEqual(fromWhole);
    });

    test("a marker under ANOTHER key is refused here too", () => {
      // Otherwise the draft would show content for this entry from a patch that
      // publishing refuses outright.
      const res = expandJsonValuesRootOpForKey(
        {
          op: "replace",
          path: [],
          value: { "/a": { title: "A" }, "/b": { _type: "json" } },
        },
        "/a",
        entries({ "/a": { title: "was" } }),
      );
      expect(result.isErr(res)).toBe(true);
    });
  });

  describe("what it refuses", () => {
    test('a `{_type:"json"}` marker as an entry\'s content', () => {
      /*
       * This is the original bug, caught at the one place that can catch it: a
       * revert replaying a module's archived Source, which holds markers rather
       * than content. Written through, the markers land in the entries' files
       * and the content they stood for is gone.
       */
      const res = expandJsonValuesRootOp(
        {
          op: "replace",
          path: [],
          value: {
            "/a": { _type: "json", patch_id: "p1" },
            "/b": { _type: "json" },
          },
        },
        entries({ "/a": { title: "A" }, "/b": { title: "B" } }),
      );
      expect(result.isErr(res)).toBe(true);
      expect(result.isErr(res) && res.error.message).toContain("/a");
    });

    test("a value that is not a record of entries", () => {
      for (const value of [null, 42, "a string", [{ title: "A" }]]) {
        expect(
          result.isErr(
            expandJsonValuesRootOp(
              { op: "replace", path: [], value },
              entries({}),
            ),
          ),
        ).toBe(true);
      }
    });

    test("a root op that is not a whole-record write", () => {
      expect(
        result.isErr(
          expandJsonValuesRootOp(
            { op: "move", from: ["/a"], path: [] },
            entries({ "/a": { title: "A" } }),
          ),
        ),
      ).toBe(true);
    });
  });
});

describe("getNewJsonEntryPaths", () => {
  const ok = (moduleFilePath: string, entryKey: string) => {
    const res = getNewJsonEntryPaths(moduleFilePath, entryKey);
    if (result.isErr(res)) {
      throw new Error(`Expected ok, got: ${JSON.stringify(res.error)}`);
    }
    return res.value;
  };

  test("mirrors the entry key under a folder named after the .val.ts", () => {
    expect(ok("/test/pages.val.ts", "/blog/hello")).toEqual({
      jsonPath: "/test/pages/blog/hello.val.json",
      importPath: "./pages/blog/hello.val.json",
    });
  });

  test("handles nested module directories", () => {
    expect(ok("/app/support/[slug]/page.val.ts", "/support/faq")).toEqual({
      jsonPath: "/app/support/[slug]/page/support/faq.val.json",
      importPath: "./page/support/faq.val.json",
    });
  });

  describe("rejects a key that would write outside the module's own folder", () => {
    // The entry key is client-supplied (a record key in a patch op) and this path
    // is what the commit writes, so an escape here is an arbitrary file write.
    test.each([
      ["parent traversal", "/../../../../../../tmp/pwn"],
      ["traversal mid-key", "/blog/../../../../etc/passwd"],
      ["bare traversal", "../outside"],
      ["backslash separator (a separator on Windows)", "/..\\..\\pwn"],
      ["NUL byte", "/blog/hello\u0000"],
      ["empty key", "/"],
    ])("%s", (_name, entryKey) => {
      const res = getNewJsonEntryPaths("/app/pages.val.ts", entryKey);
      expect(result.isErr(res)).toBe(true);
    });

    test("a key that merely LOOKS like traversal after normalizing is fine", () => {
      // `/blog/../hello` normalizes back inside the folder — allowed, and lands
      // where the normalized path says.
      expect(ok("/app/pages.val.ts", "/blog/../hello")).toEqual({
        jsonPath: "/app/pages/hello.val.json",
        importPath: "./pages/hello.val.json",
      });
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

describe("rebaseContentOp", () => {
  test("drops the record + entry-key prefix from path and from", () => {
    const res = rebaseContentOp(
      { op: "move", from: ["/a", "items", "0"], path: ["/a", "items", "2"] },
      1,
    );
    expect(result.isOk(res) && res.value).toEqual({
      op: "move",
      from: ["items", "0"],
      path: ["items", "2"],
    });
  });

  test("rejects removing the entry root", () => {
    const res = rebaseContentOp({ op: "remove", path: ["/a"] }, 1);
    expect(result.isErr(res)).toBe(true);
  });

  test("refuses a file op: it is not a content op", () => {
    const res = rebaseContentOp(
      {
        op: "file",
        path: ["/a", "img"],
        filePath: "/public/val/x.png",
        value: "data:...",
        remote: false,
      },
      1,
    );
    expect(result.isErr(res)).toBe(true);
  });
});

// `applyJsonValuesEntryPatches`'s cases moved to `engineConformance.test.ts`
// with it: they run against the old engine and the one that replaced it.

describe("resolveExistingJsonPath", () => {
  test("resolves a hand-placed import path relative to the module dir", () => {
    expect(
      resolveExistingJsonPath("/test/pages.val.ts", "./content/hello.val.json"),
    ).toBe("/test/content/hello.val.json");
  });
});
