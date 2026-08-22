import { initVal } from "../initVal";
import { deserializeSchema } from "./deserialize";
import { svgVarsCss, SvgSchema } from "./svg";
import { SourcePath } from "../val";

const { s } = initVal();

const path = "/test" as SourcePath;

const iconSchema = s.svg({
  width: 24,
  height: 24,
  variables: { brand: "#0055ff", line: "currentColor" },
});

const icon = {
  viewBox: "0 0 24 24",
  width: 24,
  height: 24,
  children: [
    {
      tag: "path" as const,
      attrs: {
        d: "M4 12h16",
        stroke: { var: "line" as const },
        fill: "none" as const,
      },
      children: [],
    },
  ],
};

describe("SvgSchema.assert", () => {
  test("accepts a well formed svg", () => {
    expect(iconSchema["executeAssert"](path, icon)).toStrictEqual({
      success: true,
      data: icon,
    });
  });

  test("only checks the root type, not the nodes", () => {
    // A node with an unsupported tag still asserts: assert is a runtime type
    // check, validate is what checks values.
    const result = iconSchema["executeAssert"](path, {
      viewBox: "0 0 24 24",
      width: null,
      height: null,
      children: [{ tag: "script", attrs: {}, children: [] }],
    });
    expect(result.success).toBe(true);
  });

  test("rejects a non object", () => {
    expect(iconSchema["executeAssert"](path, "nope").success).toBe(false);
    expect(iconSchema["executeAssert"](path, []).success).toBe(false);
    expect(iconSchema["executeAssert"](path, null).success).toBe(false);
  });

  test("rejects an object without viewBox or children", () => {
    expect(iconSchema["executeAssert"](path, { children: [] }).success).toBe(
      false,
    );
    expect(
      iconSchema["executeAssert"](path, { viewBox: "0 0 1 1" }).success,
    ).toBe(false);
  });

  test("accepts null when nullable", () => {
    expect(iconSchema.nullable()["executeAssert"](path, null)).toStrictEqual({
      success: true,
      data: null,
    });
  });
});

describe("SvgSchema serialization", () => {
  test("serializes its options", () => {
    expect(iconSchema["executeSerialize"]()).toStrictEqual({
      type: "svg",
      opt: false,
      options: {
        width: 24,
        height: 24,
        variables: { brand: "#0055ff", line: "currentColor" },
      },
      customValidate: false,
      readonly: false,
      hidden: false,
      description: undefined,
    });
  });

  test("round trips through deserializeSchema", () => {
    const serialized = iconSchema["executeSerialize"]();
    const deserialized = deserializeSchema(serialized);
    expect(deserialized).toBeInstanceOf(SvgSchema);
    expect(deserialized["executeSerialize"]()).toStrictEqual(serialized);
    // and it still validates the same way
    expect(deserialized["executeValidate"](path, icon)).toBe(false);
  });

  test("renders nothing special", () => {
    expect(iconSchema["executeRender"]()).toStrictEqual({});
  });
});

describe("SvgSchema builders", () => {
  test("width / height / aspectRatio return new instances", () => {
    const base = s.svg({ variables: {} });
    const constrained = base.width(16).height(16).aspectRatio("1:1");
    expect(constrained["executeSerialize"]()).toMatchObject({
      options: { width: 16, height: 16, aspectRatio: "1:1" },
    });
    expect(base["executeSerialize"]()).toMatchObject({ options: {} });
  });

  test("describe / readonly / hidden are serialized", () => {
    expect(
      iconSchema.describe("An icon").readonly().hidden()["executeSerialize"](),
    ).toMatchObject({
      description: "An icon",
      readonly: true,
      hidden: true,
    });
  });

  test("custom validate functions run", () => {
    const schema = s
      .svg({ variables: {} })
      .validate((src) => (src.children.length === 0 ? "Icon is empty" : false));
    const errors = schema["executeValidate"](path, {
      viewBox: "0 0 24 24",
      width: null,
      height: null,
      children: [],
    });
    expect(errors).toStrictEqual({
      [path]: [{ message: "Icon is empty", value: expect.anything() }],
    });
  });
});

describe("svgVarsCss", () => {
  test("emits the declared example colors", () => {
    expect(svgVarsCss(iconSchema)).toBe(
      ":root{--val-svg-brand:#0055ff;--val-svg-line:currentColor}",
    );
  });

  test("accepts a custom selector, for dark mode blocks", () => {
    expect(
      svgVarsCss(
        s.svg({ variables: { brand: "#6699ff" } }),
        '[data-theme="dark"]',
      ),
    ).toBe('[data-theme="dark"]{--val-svg-brand:#6699ff}');
  });

  test("is empty when there are no variables", () => {
    expect(svgVarsCss(s.svg())).toBe("");
  });
});
