import { SourcePath } from "../val";
import { code, CodeSchema } from "./code";
import { deserializeSchema } from "./deserialize";
import { RawString } from "./string";

// Stored code values are raw strings; brand them for executeValidate, which is
// typed against the schema's branded source type.
const raw = (value: string): RawString => value as RawString;

describe("CodeSchema", () => {
  test("assert: succeeds on any string", () => {
    expect(
      code({ language: "typescript" })["executeAssert"](
        "path" as SourcePath,
        "const a = 1;",
      ),
    ).toEqual({ success: true, data: "const a = 1;" });
  });

  test("assert: type error on null when not optional", () => {
    expect(code()["executeAssert"]("path" as SourcePath, null)).toEqual({
      success: false,
      errors: {
        path: [{ message: "Expected 'string', got 'null'", typeError: true }],
      },
    });
  });

  test("assert: succeeds on null when nullable", () => {
    expect(
      code()
        .nullable()
        ["executeAssert"]("path" as SourcePath, null),
    ).toEqual({ success: true, data: null });
  });

  test("assert: type error on a non-string", () => {
    expect(code()["executeAssert"]("path" as SourcePath, 1)).toEqual({
      success: false,
      errors: {
        path: [{ message: "Expected 'string', got 'number'", typeError: true }],
      },
    });
  });

  /**
   * Code is not validated against its language: a half-written snippet is a
   * normal state to save an editor in, and the schema is not a compiler.
   */
  test("validate: any string passes, whatever the language says", () => {
    const schema = code({ language: "json" });
    expect(
      schema["executeValidate"]("path" as SourcePath, raw("{ not json")),
    ).toBe(false);
  });

  test("validate: null is an error unless nullable", () => {
    expect(
      code()
        .nullable()
        ["executeValidate"]("path" as SourcePath, null),
    ).toBe(false);
    // Typed `string | null` so that `null` can be handed to a schema that did
    // NOT opt in — which is the case under test.
    const notNullable = new CodeSchema<string | null>();
    expect(notNullable["executeValidate"]("path" as SourcePath, null)).toEqual({
      path: [{ message: "Expected 'string', got 'null'", value: null }],
    });
  });

  test("validate: custom validate functions run", () => {
    const schema = code({ language: "json" }).validate((src) =>
      src.includes("\t") ? "Use spaces, not tabs" : false,
    );
    expect(schema["executeValidate"]("path" as SourcePath, raw("{}"))).toBe(
      false,
    );
    expect(
      schema["executeValidate"]("path" as SourcePath, raw("{\n\t}")),
    ).toEqual({
      path: [{ message: "Use spaces, not tabs", value: "{\n\t}" }],
    });
  });

  test("serialize: carries the language, and omits it when there is none", () => {
    expect(
      code({ language: "typescript" })["executeSerialize"](),
    ).toMatchObject({
      type: "code",
      options: { language: "typescript" },
    });
    expect(code()["executeSerialize"]()).toMatchObject({
      type: "code",
      options: undefined,
    });
  });

  test("the language survives every chained builder", () => {
    const base = code({ language: "json" });
    for (const schema of [
      base,
      base.validate(() => false),
      base.nullable(),
      base.readonly(),
      base.hidden(),
      base.describe("Some description"),
      base.render({ as: "inline" }),
      base.preview(({ val }) => ({ title: val })),
    ]) {
      expect(schema["executeSerialize"]()).toMatchObject({
        options: { language: "json" },
      });
    }
  });

  test("round-trips through deserializeSchema", () => {
    for (const base of [
      code(),
      code({ language: "typescript" }),
      code({ language: "json" }).render({ as: "inline" }),
      code().nullable().readonly().hidden().describe("desc"),
    ]) {
      const serialized = base["executeSerialize"]();
      expect(deserializeSchema(serialized)["executeSerialize"]()).toStrictEqual(
        serialized,
      );
    }
  });

  /** Code has no items, so it has nothing to preview of its own. */
  test("preview: never previews", () => {
    expect(code()["executePreview"]()).toEqual({});
  });

  test("preview: an item preview is declared and runs", () => {
    const schema = code({ language: "json" }).preview(({ val }) => ({
      title: val.slice(0, 4),
    }));
    expect(schema["executeSerialize"]()).toMatchObject({ preview: true });
    expect(schema["executePreviewItem"](raw("{ hello: 1 }"))).toEqual({
      title: "{ he",
    });
  });
});
