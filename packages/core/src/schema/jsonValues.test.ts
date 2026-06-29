import { SourcePath } from "../val";
import {
  json,
  isJson,
  getJsonImport,
  resolveJsonValues,
  JsonOf,
} from "../source/json";
import { Source } from "../source";
import { VAL_EXTENSION } from "../source";
import { deserializeSchema } from "./deserialize";
import { Schema } from ".";
import { SelectorSource } from "../selector";
import { object } from "./object";
import { record } from "./record";
import { router } from "./router";
import { string } from "./string";
import { images } from "./images";
import { nextAppRouter } from "../router";
import { initVal } from "../initVal";

describe("c.json + .jsonValues()", () => {
  test("json() returns a JsonSource marker with thunk + sha", () => {
    const thunk = () => Promise.resolve({ default: { title: "hi" } });
    const src = json(thunk, "abc123");
    expect(src[VAL_EXTENSION]).toBe("json");
    expect(src._sha).toBe("abc123");
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
        }, "s1"),
      };
      const errors = schema["executeValidate"](
        "/test.val.ts" as SourcePath,
        src,
      );
      expect(errors).toBe(false);
      expect(loaded).toBe(false);
    });

    test("rejects a non-json entry value", () => {
      const errors = looseSchema["executeValidate"](
        "/test.val.ts" as SourcePath,
        // deliberately an inline value, which is invalid for a jsonValues record
        { a: { title: "inline-not-allowed" } },
      );
      expect(errors).not.toBe(false);
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
      "/a": json(() => Promise.resolve({ default: { title: "A" } }), "sa"),
      "/b": json(() => Promise.resolve({ default: { title: "B" } }), "sb"),
    };
    const resolved = await resolveJsonValues(source);
    expect(resolved).toEqual({ "/a": { title: "A" }, "/b": { title: "B" } });
  });

  test("resolves nested markers recursively", async () => {
    const source: Source = {
      "/outer": json(
        () =>
          Promise.resolve({
            default: {
              inner: json(
                () => Promise.resolve({ default: { deep: "value" } }),
                "si",
              ),
            },
          }),
        "so",
      ),
    };
    const resolved = await resolveJsonValues(source);
    expect(resolved).toEqual({ "/outer": { inner: { deep: "value" } } });
  });

  test("leaves transport markers (no thunk) as-is", async () => {
    const marker = { _type: "json", _sha: "x" } as unknown as Source;
    const resolved = await resolveJsonValues({ "/a": marker });
    expect(resolved).toEqual({ "/a": { _type: "json", _sha: "x" } });
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
        "/blogs/test": c.json(
          () => Promise.resolve({ default: { title: "Hello" } }),
          "1232132",
        ),
      },
    );
    expect(mod).toBeDefined();
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
