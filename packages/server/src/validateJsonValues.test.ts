import { initVal, ModuleFilePath } from "@valbuild/core";
import { validateJsonValuesEntries } from "./validateJsonValues";

const { s, c } = initVal();
const modulePath = "/blogs.val.ts" as ModuleFilePath;

describe("validateJsonValuesEntries", () => {
  const schema = s.record(s.object({ title: s.string() })).jsonValues();

  test("returns no errors when all entry content is valid", async () => {
    const source = {
      "/a": c.json(() => Promise.resolve({ default: { title: "ok" } })),
      "/b": c.json(() => Promise.resolve({ default: { title: "ok2" } })),
    };
    const errors = await validateJsonValuesEntries(schema, source, modulePath);
    expect(errors).toEqual({});
  });

  test("reports validation errors for invalid entry content", async () => {
    const source = {
      "/a": c.json(() => Promise.resolve({ default: { title: "ok" } })),
      // wrong leaf type for title — caught by the deferred content validation
      "/bad": c.json(() => Promise.resolve({ default: { title: 123 } })),
    };
    const errors = await validateJsonValuesEntries(schema, source, modulePath);
    const keys = Object.keys(errors);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((k) => k.includes("/bad"))).toBe(true);
  });

  test("reports a load error when the entry thunk rejects", async () => {
    const source = {
      "/boom": c.json(() => Promise.reject(new Error("disk gone"))),
    };
    const errors = await validateJsonValuesEntries(schema, source, modulePath);
    const keys = Object.keys(errors);
    expect(keys.length).toBe(1);
    expect(errors[keys[0] as keyof typeof errors][0].message).toContain(
      "Could not load JSON entry",
    );
  });

  test("reports an entry written inline in the .val.ts as fixable", async () => {
    const source = {
      "/a": c.json(() => Promise.resolve({ default: { title: "ok" } })),
      // hand-authored inline instead of c.json(() => import(...))
      "/inline": { title: "legal shape, wrong place" },
    };
    const errors = await validateJsonValuesEntries(schema, source, modulePath);
    const keys = Object.keys(errors);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain("/inline");
    const [error] = errors[keys[0] as keyof typeof errors];
    expect(error.fixes).toEqual(["jsonValues:extract-entry"]);
    expect(error.message).toContain("written inline");
  });

  describe("canonical entry path", () => {
    // The key↔file mapping of a jsonValues record is derived, not free: the file
    // is named after the key, under a folder named after the `.val.ts`. Every
    // WRITE already derives it with `getNewJsonEntryPaths`; these pin the read
    // side, which used to accept any path at all.
    const src = {
      "/a": c.json(() => Promise.resolve({ default: { title: "ok" } })),
    };

    test("accepts an entry whose file is at the path its key derives", async () => {
      const errors = await validateJsonValuesEntries(
        schema,
        src,
        modulePath,
        new Map([["/a", "./blogs/a.val.json"]]),
      );
      expect(errors).toEqual({});
    });

    test("accepts a specifier that resolves to the derived path", async () => {
      // The comparison is on the RESOLVED path, not the literal string: writing
      // the same file a different way is not a mistake worth reporting.
      const errors = await validateJsonValuesEntries(
        schema,
        src,
        modulePath,
        new Map([["/a", "blogs/./a.val.json"]]),
      );
      expect(errors).toEqual({});
    });

    test("reports an entry parked anywhere else, with the move fix", async () => {
      const errors = await validateJsonValuesEntries(
        schema,
        src,
        modulePath,
        new Map([["/a", "./hand-placed/a.val.json"]]),
      );
      const keys = Object.keys(errors);
      expect(keys).toHaveLength(1);
      expect(keys[0]).toContain("/a");
      const [error] = errors[keys[0] as keyof typeof errors];
      expect(error.fixes).toEqual(["jsonValues:rename-entry-file"]);
      // The message has to name BOTH paths: the author needs to see what the
      // module says and what the key requires.
      expect(error.message).toContain("./hand-placed/a.val.json");
      expect(error.message).toContain("./blogs/a.val.json");
    });

    test("reports the misplaced file ALONGSIDE a content error", async () => {
      // Two independent problems at the same source path. Assigning instead of
      // appending drops one, so the author fixes the path and only then learns
      // the content was never valid.
      const errors = await validateJsonValuesEntries(
        schema,
        { "/a": c.json(() => Promise.resolve({ default: { title: 123 } })) },
        modulePath,
        new Map([["/a", "./hand-placed/a.val.json"]]),
      );
      const entryPath = Object.keys(errors).find((k) => k.endsWith('"/a"'));
      expect(entryPath).toBeDefined();
      const messages = errors[entryPath as keyof typeof errors].map(
        (e) => e.message,
      );
      expect(messages.some((m) => m.includes("derived from its key"))).toBe(
        true,
      );
      expect(Object.values(errors).flat().length).toBeGreaterThan(1);
    });

    test("skips the check for a key the .val.ts has no import for", async () => {
      // A draft entry whose content lives in a patch has a thunk at runtime but
      // no `c.json(() => import(...))` in the module on disk. There is nothing to
      // compare against, and inventing a mismatch would fail every draft.
      const errors = await validateJsonValuesEntries(
        schema,
        src,
        modulePath,
        new Map([["/somethingelse", "./blogs/somethingelse.val.json"]]),
      );
      expect(errors).toEqual({});
    });

    test("skips the check entirely when the caller has no source file", async () => {
      // The ValOps/Studio path passes nothing: the specifier only exists in the
      // `.val.ts` AST, and a runtime `thunk.toString()` would report whatever the
      // bundler rewrote it to. Content validation still runs.
      const errors = await validateJsonValuesEntries(schema, src, modulePath);
      expect(errors).toEqual({});
    });
  });

  test("skips non-jsonValues records (no content loading)", async () => {
    const plainSchema = s.record(s.object({ title: s.string() }));
    let loaded = false;
    const source = {
      "/a": c.json(() => {
        loaded = true;
        return Promise.resolve({ default: { title: "ok" } });
      }),
    };
    const errors = await validateJsonValuesEntries(
      plainSchema,
      source,
      modulePath,
    );
    expect(errors).toEqual({});
    expect(loaded).toBe(false);
  });

  test("ROOT-ONLY contract: a nested jsonValues record is not visited", async () => {
    // Pins the documented limitation. Nested `.jsonValues()` records are
    // rejected up front as module errors (findNestedJsonValuesRecords), so they
    // never reach here — but if that guard is relaxed without making this a
    // recursive visitor, nested entries silently get NO content validation.
    const nestedSchema = s.object({
      pages: s.record(s.object({ title: s.string() })).jsonValues(),
    });
    let loaded = false;
    const source = {
      pages: {
        // invalid content: would be an error if it were visited
        "/a": c.json(() => {
          loaded = true;
          return Promise.resolve({ default: { title: 123 } });
        }),
      },
    };
    const errors = await validateJsonValuesEntries(
      nestedSchema,
      source,
      modulePath,
    );
    expect(errors).toEqual({});
    expect(loaded).toBe(false);
  });
});
