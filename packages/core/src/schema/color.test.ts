import { SourcePath } from "../val";
import { color } from "./color";
import { RawString } from "./string";

// Stored color values are raw strings; brand them for executeValidate, which
// is typed against the schema's branded source type.
const raw = (value: string): RawString => value as RawString;

describe("ColorSchema", () => {
  test("assert: should return success if src is a string", () => {
    const schema = color();
    expect(
      schema["executeAssert"]("path" as SourcePath, "hsl(0 100% 50%)"),
    ).toEqual({
      success: true,
      data: "hsl(0 100% 50%)",
    });
  });

  test("assert: should return success if src is any string (validation happens elsewhere)", () => {
    const schema = color();
    expect(
      schema["executeAssert"]("path" as SourcePath, "not a color"),
    ).toEqual({
      success: true,
      data: "not a color",
    });
  });

  test("assert: should return type error if src is null and not optional", () => {
    const schema = color();
    expect(schema["executeAssert"]("path" as SourcePath, null)).toEqual({
      success: false,
      errors: {
        path: [
          {
            message: "Expected 'string', got 'null'",
            typeError: true,
          },
        ],
      },
    });
  });

  test("assert: should return success if src is null and optional", () => {
    const schema = color().nullable();
    expect(schema["executeAssert"]("path" as SourcePath, null)).toEqual({
      success: true,
      data: null,
    });
  });

  test("assert: should return type error if src is not a string", () => {
    const schema = color();
    expect(schema["executeAssert"]("path" as SourcePath, 1)).toEqual({
      success: false,
      errors: {
        path: [
          {
            message: "Expected 'string', got 'number'",
            typeError: true,
          },
        ],
      },
    });
  });

  test("validate: hsl is the default format", () => {
    const schema = color();
    expect(
      schema["executeValidate"]("path" as SourcePath, raw("hsl(0 100% 50%)")),
    ).toBe(false);
  });

  test("validate: the legacy syntax of the configured format is accepted", () => {
    const schema = color();
    expect(
      schema["executeValidate"]("path" as SourcePath, raw("hsl(0, 100%, 50%)")),
    ).toBe(false);
  });

  test("validate: a short hex is accepted when the format is hex", () => {
    const schema = color({ format: "hex" });
    expect(schema["executeValidate"]("path" as SourcePath, raw("#f00"))).toBe(
      false,
    );
  });

  test("validate: every format accepts its own notation", () => {
    expect(
      color({ format: "hex" })["executeValidate"](
        "path" as SourcePath,
        raw("#3b82f6"),
      ),
    ).toBe(false);
    expect(
      color({ format: "rgb" })["executeValidate"](
        "path" as SourcePath,
        raw("rgb(59 130 246)"),
      ),
    ).toBe(false);
    expect(
      color({ format: "hsl" })["executeValidate"](
        "path" as SourcePath,
        raw("hsl(217.22 91.22% 59.8%)"),
      ),
    ).toBe(false);
    expect(
      color({ format: "oklch" })["executeValidate"](
        "path" as SourcePath,
        raw("oklch(0.6231 0.188 259.81)"),
      ),
    ).toBe(false);
  });

  test("validate: a color in another format is an error that suggests the conversion", () => {
    const schema = color();
    const res = schema["executeValidate"]("path" as SourcePath, raw("#ff0000"));
    expect(res).toEqual({
      path: [
        {
          message:
            "Expected a color in the 'hsl' format (e.g. 'hsl(217.22 91.22% 59.8%)'), got '#ff0000'. Did you mean 'hsl(0 100% 50%)'?",
          value: "#ff0000",
        },
      ],
    });
  });

  test("validate: an unparseable color is an error", () => {
    const schema = color();
    const res = schema["executeValidate"]("path" as SourcePath, raw("red"));
    expect(res).toEqual({
      path: [
        {
          message:
            "Invalid color: 'red'. Expected a CSS color in the 'hsl' format (e.g. 'hsl(217.22 91.22% 59.8%)')",
          value: "red",
        },
      ],
    });
  });

  test("validate: alpha is rejected unless it is enabled", () => {
    const schema = color();
    const res = schema["executeValidate"](
      "path" as SourcePath,
      raw("hsl(0 100% 50% / 0.5)"),
    );
    expect(res).toEqual({
      path: [
        {
          message:
            "Color 'hsl(0 100% 50% / 0.5)' has an alpha channel, but alpha is not enabled. Use s.color({ alpha: true }) to allow transparency",
          value: "hsl(0 100% 50% / 0.5)",
        },
      ],
    });
  });

  test("validate: the format suggestion is one that would actually validate", () => {
    // A transparent color pasted into a schema that disallows alpha reports two
    // errors: the wrong format, and the alpha. The format error's suggestion
    // used to carry the alpha through, so following it landed you straight back
    // on the alpha error - advice that cannot clear the thing it is advising on.
    const schema = color({ format: "rgb" });
    const res = schema["executeValidate"](
      "path" as SourcePath,
      raw("hsl(0 100% 50% / 0.5)"),
    );
    expect(res).not.toBe(false);
    if (res === false) return;
    const suggestion = res["path" as SourcePath]
      .map((e) => e.message)
      .join("\n")
      .match(/Did you mean '([^']+)'\?/)?.[1];
    expect(suggestion).toBeDefined();
    if (suggestion === undefined) return;
    // The suggestion is opaque...
    expect(suggestion).not.toContain("/");
    // ...so feeding it back validates clean.
    expect(
      schema["executeValidate"]("path" as SourcePath, raw(suggestion)),
    ).toBe(false);
  });

  test("validate: alpha is accepted when it is enabled", () => {
    const schema = color({ alpha: true });
    expect(
      schema["executeValidate"](
        "path" as SourcePath,
        raw("hsl(0 100% 50% / 0.5)"),
      ),
    ).toBe(false);
  });

  test("validate: a fully opaque color is fine without alpha enabled", () => {
    const schema = color();
    expect(
      schema["executeValidate"](
        "path" as SourcePath,
        raw("hsl(0 100% 50% / 1)"),
      ),
    ).toBe(false);
  });

  test("validate: null is only allowed when nullable", () => {
    expect(
      color()
        .nullable()
        ["executeValidate"]("path" as SourcePath, null),
    ).toBe(false);
    expect(
      color()["executeValidate"]("path" as SourcePath, null as never),
    ).toEqual({
      path: [
        {
          message: "Expected 'string', got 'object'",
          value: null,
        },
      ],
    });
  });

  test("validate: custom validate functions run", () => {
    const schema = color({ format: "hex" }).validate((src) =>
      src === "#000000" ? "Black is not allowed" : false,
    );
    expect(
      schema["executeValidate"]("path" as SourcePath, raw("#000000")),
    ).toEqual({
      path: [
        {
          message: "Black is not allowed",
          value: "#000000",
        },
      ],
    });
    expect(
      schema["executeValidate"]("path" as SourcePath, raw("#ffffff")),
    ).toBe(false);
  });

  test("serialize: options, opt and modifiers survive", () => {
    expect(
      color({ format: "oklch", alpha: true })
        .describe("Brand color")
        .nullable()
        .readonly()
        ["executeSerialize"](),
    ).toEqual({
      type: "color",
      opt: true,
      options: { format: "oklch", alpha: true },
      customValidate: false,
      readonly: true,
      hidden: false,
      description: "Brand color",
    });
  });

  test("serialize: no options means no format is pinned (hsl is the runtime default)", () => {
    expect(color()["executeSerialize"]()).toEqual({
      type: "color",
      opt: false,
      options: undefined,
      customValidate: false,
      readonly: false,
      hidden: false,
      description: undefined,
    });
  });

  test("nullable drops custom validate functions, like the other schemas", () => {
    const schema = color()
      .validate(() => "always fails")
      .nullable();
    expect(
      schema["executeValidate"]("path" as SourcePath, raw("hsl(0 100% 50%)")),
    ).toBe(false);
  });
});
