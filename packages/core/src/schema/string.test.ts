import { deserializeSchema } from "./deserialize";
import { string } from "./string";

describe("StringSchema", () => {
  /**
   * A render is static configuration that lives in the SERIALIZED schema — the
   * editor reads it from there rather than from a pipeline. So what
   * `executeSerialize` produces is the whole contract, not a marker.
   */
  test("render: serializes whole, not as a marker", () => {
    expect(
      string().render({ as: "textarea" })["executeSerialize"](),
    ).toMatchObject({
      type: "string",
      render: { as: "textarea" },
    });
    expect(
      string()
        .render({ as: "code", language: "typescript" })
        ["executeSerialize"](),
    ).toMatchObject({
      type: "string",
      render: { as: "code", language: "typescript" },
    });
  });

  test("render: absent when none is declared", () => {
    expect(string()["executeSerialize"]()).toMatchObject({ render: undefined });
  });

  /**
   * The guard `array` and `record` have had since a render could be dropped by
   * chaining, which `string` never had despite threading `renderInput` through
   * ten builders. It matters more now: a dropped render is no longer a missing
   * textarea in the Studio, it is a serialized schema that is wrong.
   */
  test("render: survives every chained builder", () => {
    const base = string().render({ as: "code", language: "json" });
    for (const schema of [
      base,
      base.minLength(1),
      base.maxLength(10),
      base.regexp(/x/),
      base.validate(() => false),
      base.nullable(),
      base.readonly(),
      base.hidden(),
      base.raw(),
      base.describe("Some description"),
    ]) {
      expect(schema["executeSerialize"]()).toMatchObject({
        render: { as: "code", language: "json" },
      });
    }
  });

  test("render: does not mutate the schema it was called on", () => {
    const base = string();
    base.render({ as: "textarea" });
    expect(base["executeSerialize"]()).toMatchObject({ render: undefined });
  });

  /**
   * Round-tripping is what makes the serialized schema the source of truth: a
   * deserialized schema has no instance behind it, so anything it drops here is
   * gone for good.
   */
  test("render: round-trips through deserializeSchema", () => {
    for (const base of [
      string().render({ as: "textarea" }),
      string().render({ as: "code", language: "typescript" }),
      string(),
    ]) {
      const serialized = base["executeSerialize"]();
      expect(deserializeSchema(serialized)["executeSerialize"]()).toStrictEqual(
        serialized,
      );
    }
  });

  /** A string has no items, so it has nothing to preview. */
  test("preview: a string never previews, render or not", () => {
    expect(string().render({ as: "textarea" })["executePreview"]()).toEqual({});
  });
});
