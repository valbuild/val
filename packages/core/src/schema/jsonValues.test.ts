import { SourcePath } from "../val";
import {
  json,
  isJson,
  getJsonImport,
  resolveJsonValues,
  JsonOf,
  JsonSource,
} from "../source/json";
import { Source } from "../source";
import { VAL_EXTENSION } from "../source";
import { deserializeSchema } from "./deserialize";
import { Schema, SelectorOfSchema } from ".";
import { ReplaceRawStringWithString } from "../module";
import { SelectorSource } from "../selector";
import { object } from "./object";
import { record } from "./record";
import { router } from "./router";
import { string } from "./string";
import { images } from "./images";
import { nextAppRouter } from "../router";
import { initVal } from "../initVal";

describe("c.json + .jsonValues()", () => {
  test("json() returns a JsonSource marker with a thunk", () => {
    const thunk = () => Promise.resolve({ default: { title: "hi" } });
    const src = json(thunk);
    expect(src[VAL_EXTENSION]).toBe("json");
    expect(getJsonImport(src)).toBe(thunk);
    expect(isJson(src)).toBe(true);
    expect(isJson({ title: "hi" })).toBe(false);
    expect(isJson(null)).toBe(false);
  });

  test(".jsonValues() serializes with jsonValues: true", () => {
    const schema = record(object({ title: string() })).jsonValues();
    const serialized = schema["executeSerialize"]();
    expect(serialized.type).toBe("record");
    expect(serialized.jsonValues).toBe(true);
    // item schema is still serialized so the UI/validation can use it
    expect(serialized.item.type).toBe("object");
  });

  test(".jsonValues() after .validate() throws instead of dropping the validator", () => {
    // `.jsonValues()` changes the source shape to JsonSource entries, so a
    // validator typed against the un-lazy shape cannot be carried over. It used to
    // be dropped silently, leaving a `.validate(...)` in the source file that ran
    // nowhere — client or server.
    expect(() =>
      record(object({ title: string() }))
        .validate(() => "never runs")
        .jsonValues(),
    ).toThrow(/must come BEFORE \.validate/);
  });

  test(".validate() AFTER .jsonValues() is the supported order and is kept", () => {
    const schema = record(object({ title: string() }))
      .jsonValues()
      .validate(() => "keys are wrong");
    expect(schema["executeSerialize"]().customValidate).toBe(true);
  });

  test("non-jsonValues record does not set jsonValues", () => {
    const schema = record(object({ title: string() }));
    const serialized = schema["executeSerialize"]();
    expect(serialized.jsonValues).toBeUndefined();
  });

  test("deserialize round-trips jsonValues flag", () => {
    const schema = record(object({ title: string() })).jsonValues();
    const serialized = schema["executeSerialize"]();
    const deserialized = deserializeSchema(serialized);
    const reserialized = deserialized["executeSerialize"]();
    expect(reserialized.type).toBe("record");
    if (reserialized.type === "record") {
      expect(reserialized.jsonValues).toBe(true);
    }
  });

  test(".jsonValues() composes with s.router()", () => {
    const schema = router(
      nextAppRouter,
      object({ title: string() }),
    ).jsonValues();
    const serialized = schema["executeSerialize"]();
    expect(serialized.jsonValues).toBe(true);
    expect(serialized.router).toBe("next-app-router");
  });

  test(".jsonValues() throws on image galleries", () => {
    expect(() => images().jsonValues()).toThrow(/jsonValues/);
  });

  describe("validation", () => {
    const schema = record(object({ title: string() })).jsonValues();
    // A loosely-typed reference so we can feed untyped values (as the server
    // does when validating sources loaded over the wire) without casts.
    const looseSchema: Schema<SelectorSource> = schema;

    test("accepts json markers and never loads content during validation", () => {
      let loaded = false;
      const src = {
        a: json(() => {
          // deep content is never inspected at the record level — deferred to
          // validateJsonEntryContent once the file is loaded.
          loaded = true;
          return Promise.resolve({ default: { title: "ok" } });
        }),
      };
      const errors = schema["executeValidate"](
        "/test.val.ts" as SourcePath,
        src,
      );
      expect(errors).toBe(false);
      expect(loaded).toBe(false);
    });

    test("validates inline (loaded) content against the item schema", () => {
      // valid inline content passes (this is what the UI sees once an entry's
      // *.val.json is loaded and substituted for its marker)
      expect(
        looseSchema["executeValidate"]("/test.val.ts" as SourcePath, {
          a: { title: "ok" },
        }),
      ).toBe(false);
      // invalid inline content (wrong leaf type) is caught
      expect(
        looseSchema["executeValidate"]("/test.val.ts" as SourcePath, {
          a: { title: 123 },
        }),
      ).not.toBe(false);
    });

    test("validateJsonEntryContent validates loaded content against item", () => {
      const okErrors = schema.validateJsonEntryContent(
        '/test.val.ts?p="a"' as SourcePath,
        { title: "ok" },
      );
      expect(okErrors).toBe(false);

      const badErrors = schema.validateJsonEntryContent(
        '/test.val.ts?p="a"' as SourcePath,
        // wrong leaf type
        { title: 123 },
      );
      expect(badErrors).not.toBe(false);
    });
  });
});

describe("resolveJsonValues", () => {
  test("resolves a record of markers into inlined content", async () => {
    const source: Source = {
      "/a": json(() => Promise.resolve({ default: { title: "A" } })),
      "/b": json(() => Promise.resolve({ default: { title: "B" } })),
    };
    const resolved = await resolveJsonValues(source);
    expect(resolved).toEqual({ "/a": { title: "A" }, "/b": { title: "B" } });
  });

  test("resolves nested markers recursively", async () => {
    const source: Source = {
      "/outer": json(() =>
        Promise.resolve({
          default: {
            inner: json(() => Promise.resolve({ default: { deep: "value" } })),
          },
        }),
      ),
    };
    const resolved = await resolveJsonValues(source);
    expect(resolved).toEqual({ "/outer": { inner: { deep: "value" } } });
  });

  test("leaves transport markers (no thunk) as-is", async () => {
    const marker = { _type: "json" } as unknown as Source;
    const resolved = await resolveJsonValues({ "/a": marker });
    expect(resolved).toEqual({ "/a": { _type: "json" } });
  });
});

describe("c.define authoring surface (compile-time)", () => {
  test("define accepts c.json entries for a .jsonValues() router", () => {
    const { s, c } = initVal();
    // Simulates `import("./blogs/test.val.json")` whose JSON-inferred type is
    // the widened content shape.
    const mod = c.define(
      "/blogs/[slug]/page.val.ts",
      s.router(nextAppRouter, s.object({ title: s.string() })).jsonValues(),
      {
        "/blogs/test": c.json(() =>
          Promise.resolve({ default: { title: "Hello" } }),
        ),
      },
    );
    expect(mod).toBeDefined();
  });

  test("define accepts an entry written INLINE next to c.json entries", () => {
    const { s, c } = initVal();
    // Hand-authoring an entry inline is a mistake — but a TYPE error here is a
    // dead end for the author. It typechecks; `validateJsonValuesEntries`
    // reports it (jsonValues:extract-entry) and `val validate --fix` moves it
    // into its own `*.val.json`.
    const mod = c.define(
      "/test.val.ts",
      s.record(s.object({ field: s.string() })).jsonValues(),
      {
        test1: c.json(() =>
          Promise.resolve({ default: { field: "from json" } }),
        ),
        shouldbelegal: { field: "legal" },
      },
    );
    expect(mod).toBeDefined();
  });

  test("an inline entry that does NOT match the item schema is still rejected", () => {
    // Loosening the entry type to allow inline values must not turn the record
    // into an `any` sink. Asserted at the type level (a `c.define` call with a
    // bad inline value would simply fail to compile, which a test cannot
    // observe).
    const schema = record(object({ field: string() })).jsonValues();
    type Src = ReplaceRawStringWithString<SelectorOfSchema<typeof schema>>;
    type Assert<T extends true> = T;
    type Accepts<Value> = Value extends Src ? true : false;

    type MarkerAccepted = Assert<Accepts<{ a: JsonSource<{ field: string }> }>>;
    type InlineAccepted = Assert<Accepts<{ a: { field: string } }>>;
    type WrongLeafTypeRejected = Assert<
      Accepts<{ a: { field: number } }> extends false ? true : false
    >;

    const assertions: [MarkerAccepted, InlineAccepted, WrongLeafTypeRejected] =
      [true, true, true];
    expect(assertions).toEqual([true, true, true]);
    expect(schema["executeSerialize"]().jsonValues).toBe(true);
  });
});

describe("JsonOf<T> type transform", () => {
  test("widens literals, keeps structure (compile-time)", () => {
    // string-literal union -> string
    const a: JsonOf<"x" | "y"> = "anything";
    // number literal -> number
    const b: JsonOf<1 | 2> = 5;
    // object structure preserved, leaves widened
    const c: JsonOf<{ kind: "a"; n: 1 }> = { kind: "whatever", n: 42 };
    // array of widened
    const d: JsonOf<readonly ("a" | "b")[]> = ["x", "y"];
    // discriminated union (distributes + recurses)
    const e: JsonOf<{ k: "a"; x: number } | { k: "b"; y: string }> = {
      k: "a",
      x: 1,
    };
    expect([a, b, c, d, e]).toBeDefined();
  });
});
