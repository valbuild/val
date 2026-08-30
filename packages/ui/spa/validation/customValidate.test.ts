import {
  Internal,
  ModuleFilePath,
  SerializedSchema,
  Source,
  ValModule,
  initVal,
} from "@valbuild/core";
import {
  collectCustomValidateTargets,
  hasCustomValidate,
} from "./customValidate";

const { s, c } = initVal();

const MODULE = "/test.val.ts" as ModuleFilePath;

function serialize(valModule: ValModule<Source>): SerializedSchema {
  const schema = Internal.getSchema(valModule);
  if (!schema) {
    throw new Error("no schema");
  }
  return schema["executeSerialize"]();
}

function targetsOf(valModule: ValModule<Source>, source?: Source) {
  return collectCustomValidateTargets(
    MODULE,
    serialize(valModule),
    source ?? (Internal.getSource(valModule) as Source),
  );
}

describe("hasCustomValidate", () => {
  test("false for a tree with no validators (the gate's common case)", () => {
    const mod = c.define(
      MODULE,
      s.object({ title: s.string(), tags: s.array(s.string()) }),
      { title: "x", tags: [] },
    );
    expect(hasCustomValidate(serialize(mod))).toBe(false);
  });

  test("true wherever the validator sits: leaf, container, item or key", () => {
    const leaf = c.define(
      MODULE,
      s.object({ title: s.string().validate(() => false) }),
      { title: "x" },
    );
    expect(hasCustomValidate(serialize(leaf))).toBe(true);

    const container = c.define(
      MODULE,
      s.object({ title: s.string() }).validate(() => false),
      { title: "x" },
    );
    expect(hasCustomValidate(serialize(container))).toBe(true);

    const inArray = c.define(
      MODULE,
      s.object({ tags: s.array(s.string().validate(() => false)) }),
      { tags: [] },
    );
    expect(hasCustomValidate(serialize(inArray))).toBe(true);

    const inRecordKey = c.define(
      MODULE,
      s.record(
        s.string().validate(() => false),
        s.object({ title: s.string() }),
      ),
      {},
    );
    expect(hasCustomValidate(serialize(inRecordKey))).toBe(true);

    const inUnionBranch = c.define(
      MODULE,
      s.union(
        "type",
        s.object({ type: s.literal("a"), a: s.string() }),
        s.object({
          type: s.literal("b"),
          b: s.string().validate(() => false),
        }),
      ),
      { type: "a", a: "x" },
    );
    expect(hasCustomValidate(serialize(inUnionBranch))).toBe(true);
  });
});

describe("collectCustomValidateTargets", () => {
  test("reports the flagged nodes' paths, and nothing else", () => {
    const mod = c.define(
      MODULE,
      s.object({
        title: s.string().validate(() => false),
        subtitle: s.string(),
        tags: s.array(s.string().validate(() => false)),
      }),
      { title: "x", subtitle: "y", tags: ["a", "b"] },
    );
    expect(targetsOf(mod)).toEqual({
      paths: [
        '/test.val.ts?p="title"',
        '/test.val.ts?p="tags".0',
        '/test.val.ts?p="tags".1',
      ],
      needsJsonKeys: [],
    });
  });

  test("reports the module path itself for a module-level validator", () => {
    const mod = c.define(
      MODULE,
      s.object({ title: s.string() }).validate(() => false),
      { title: "x" },
    );
    expect(targetsOf(mod).paths).toEqual(["/test.val.ts"]);
  });

  test("only the union branch the value actually takes", () => {
    // Reporting the other branch's fields would name paths that do not exist in
    // this source, and the main thread would fail to resolve them.
    const schema = s.union(
      "type",
      s.object({ type: s.literal("a"), a: s.string().validate(() => false) }),
      s.object({ type: s.literal("b"), b: s.string().validate(() => false) }),
    );
    const mod = c.define(MODULE, schema, { type: "b", b: "hello" });
    expect(targetsOf(mod).paths).toEqual(['/test.val.ts?p="b"']);
  });

  test("a nullable node that IS null still reports (a validator may reject null)", () => {
    const mod = c.define(
      MODULE,
      s.object({
        title: s
          .string()
          .nullable()
          .validate(() => false),
      }),
      { title: null },
    );
    expect(targetsOf(mod).paths).toEqual(['/test.val.ts?p="title"']);
  });

  test("an absent optional field reports nothing", () => {
    const mod = c.define(
      MODULE,
      s.object({
        title: s.string().validate(() => false),
        maybe: s
          .string()
          .nullable()
          .validate(() => false),
      }),
      { title: "x", maybe: null },
    );
    // `maybe` exists (as null) so it is reported; a key missing from the source
    // entirely is not:
    expect(
      collectCustomValidateTargets(MODULE, serialize(mod), {
        title: "x",
      } as Source).paths,
    ).toEqual(['/test.val.ts?p="title"']);
  });

  describe("jsonValues: needs-keys", () => {
    const jsonValuesModule = (validateOn: "item" | "record") => {
      const item = s.object({
        title:
          validateOn === "item"
            ? s.string().validate(() => "item says no")
            : s.string(),
      });
      const record =
        validateOn === "record"
          ? s
              .record(item)
              .jsonValues()
              .validate(() => "record says no")
          : s.record(item).jsonValues();
      return c.define(MODULE, record, {});
    };

    test("an un-loaded entry is requested when the ITEM schema is flagged", () => {
      const mod = jsonValuesModule("item");
      const partiallyLoaded = {
        loaded: { title: "here" },
        unloaded: { _type: "json" },
      } as unknown as Source;

      expect(targetsOf(mod, partiallyLoaded)).toEqual({
        // the loaded entry can be validated right away...
        paths: ['/test.val.ts?p="loaded"."title"'],
        // ...and the marker has to be loaded before we can say anything about it
        needsJsonKeys: ["unloaded"],
      });
    });

    test("a RECORD-level validator needs every un-loaded entry", () => {
      // It is a statement about all entries, so it cannot run against markers.
      const mod = jsonValuesModule("record");
      const partiallyLoaded = {
        loaded: { title: "here" },
        a: { _type: "json" },
        b: { _type: "json" },
      } as unknown as Source;

      const targets = targetsOf(mod, partiallyLoaded);
      expect(targets.paths).toEqual(["/test.val.ts"]);
      expect(targets.needsJsonKeys.sort()).toEqual(["a", "b"]);
    });

    test("no validators anywhere ⇒ nothing to load, even with markers", () => {
      const mod = c.define(MODULE, s.record(s.string()).jsonValues(), {});
      expect(
        targetsOf(mod, { a: { _type: "json" } } as unknown as Source),
      ).toEqual({ paths: [], needsJsonKeys: [] });
    });

    test("fully loaded ⇒ paths only, no load round", () => {
      const mod = jsonValuesModule("item");
      expect(
        targetsOf(mod, { a: { title: "A" }, b: { title: "B" } } as Source),
      ).toEqual({
        paths: ['/test.val.ts?p="a"."title"', '/test.val.ts?p="b"."title"'],
        needsJsonKeys: [],
      });
    });
  });
});
