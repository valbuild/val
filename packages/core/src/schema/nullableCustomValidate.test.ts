import { Schema } from ".";
import { initSchema } from "../initSchema";
import { define } from "../module";
import { nextAppRouter } from "../router";
import { SelectorSource } from "../selector";
import { SourcePath } from "../val";

const s = initSchema();
const path = '/test.val.ts?p="field"' as SourcePath;
const MESSAGE = "the validator ran";

/**
 * `.nullable()` returns a COPY of the schema, so every implementation has to
 * carry the user's `.validate(...)` closures over to it. Twelve of them passed
 * `[]` instead, which silently un-declared any validator written before the
 * `.nullable()` — the order most people write it in.
 *
 * The map is keyed by `keyof typeof s` on purpose: a new schema factory added
 * to `initSchema` does not compile until it is listed here, which is the only
 * way this stays honest as schemas are added.
 *
 * `settings` is the one factory excluded, because `SettingsSchema` declares no
 * `validate` at all; the test below pins that, so it fails if it gains one.
 */
const nullableAfterValidate: Record<
  Exclude<keyof typeof s, "settings">,
  Schema<SelectorSource>
> = {
  string: s
    .string()
    .validate(() => MESSAGE)
    .nullable(),
  boolean: s
    .boolean()
    .validate(() => MESSAGE)
    .nullable(),
  array: s
    .array(s.string())
    .validate(() => MESSAGE)
    .nullable(),
  object: s
    .object({ title: s.string() })
    .validate(() => MESSAGE)
    .nullable(),
  number: s
    .number()
    .validate(() => MESSAGE)
    .nullable(),
  discriminatedUnion: s
    .discriminatedUnion("type", s.object({ type: s.literal("a") }))
    .validate(() => MESSAGE)
    .nullable(),
  enum: s
    .enum("a", "b")
    .validate(() => MESSAGE)
    .nullable(),
  // Deprecated, and delegates to the two above — listed so the map stays keyed
  // by the whole of `s`, and because it is still what most existing schemas say.
  union: s
    .union(s.literal("a"), s.literal("b"))
    .validate(() => MESSAGE)
    .nullable(),
  richtext: s
    .richtext()
    .validate(() => MESSAGE)
    .nullable(),
  image: s
    .image()
    .validate(() => MESSAGE)
    .nullable(),
  literal: s
    .literal("a")
    .validate(() => MESSAGE)
    .nullable(),
  keyOf: s
    .keyOf(define("/gallery.val.ts", s.record(s.string()), { one: "One" }))
    .validate(() => MESSAGE)
    .nullable(),
  record: s
    .record(s.string())
    .validate(() => MESSAGE)
    .nullable(),
  file: s
    .file()
    .validate(() => MESSAGE)
    .nullable(),
  files: s
    .files({ accept: "application/pdf", directory: "/public/val/files" })
    .validate(() => MESSAGE)
    .nullable(),
  date: s
    .date()
    .validate(() => MESSAGE)
    .nullable(),
  datetime: s
    .datetime()
    .validate(() => MESSAGE)
    .nullable(),
  color: s
    .color()
    .validate(() => MESSAGE)
    .nullable(),
  code: s
    .code()
    .validate(() => MESSAGE)
    .nullable(),
  route: s
    .route()
    .validate(() => MESSAGE)
    .nullable(),
  router: s
    .router(nextAppRouter, s.object({ title: s.string() }))
    .validate(() => MESSAGE)
    .nullable(),
  images: s
    .images({ directory: "/public/val/images" })
    .validate(() => MESSAGE)
    .nullable(),
};

describe(".validate() survives .nullable()", () => {
  for (const [name, schema] of Object.entries(nullableAfterValidate)) {
    test(`s.${name}()`, () => {
      expect(schema["executeCustomValidateAt"](path, null)).toEqual([
        { message: MESSAGE, value: null },
      ]);
    });
  }

  test("s.settings() is excluded because it declares no validate", () => {
    expect("validate" in s.settings()).toBe(false);
  });

  test("the validator still sees a non-null value", () => {
    // The carry-over is not only about null: the same instance is what validates
    // every value the field ever holds.
    const schema = s
      .string()
      .validate((src) => (src === "ok" ? false : MESSAGE))
      .nullable();
    expect(schema["executeCustomValidateAt"](path, "ok")).toEqual([]);
    expect(schema["executeCustomValidateAt"](path, "nope")).toEqual([
      { message: MESSAGE, value: "nope" },
    ]);
  });

  test("a nullable schema's validator decides for itself what null means", () => {
    // Validators run on null rather than being skipped, so `.nullable()` does not
    // turn a required-ish check into a no-op the author cannot see.
    const schema = s
      .number()
      .nullable()
      .validate((src) => (src === null ? "must be set" : false));
    expect(schema["executeCustomValidateAt"](path, null)).toEqual([
      { message: "must be set", value: null },
    ]);
    expect(schema["executeCustomValidateAt"](path, 1)).toEqual([]);
  });

  test("validators declared on both sides of .nullable() both run", () => {
    const schema = s
      .string()
      .validate(() => "first")
      .nullable()
      .validate(() => "second");
    expect(schema["executeCustomValidateAt"](path, null)).toEqual([
      { message: "first", value: null },
      { message: "second", value: null },
    ]);
  });
});
