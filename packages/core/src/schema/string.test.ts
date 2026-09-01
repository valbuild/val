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
      string().render({ as: "inline" })["executeSerialize"](),
    ).toMatchObject({
      type: "string",
      render: { as: "inline" },
    });
  });

  test("render: absent when none is declared", () => {
    expect(string()["executeSerialize"]()).toMatchObject({ render: undefined });
  });

  /**
   * The guard `array` and `record` have had since a render could be dropped by
   * chaining, which `string` never had despite threading `renderInput` through
   * ten builders. It matters more now: a dropped render is no longer a missing
   * inline row in the Studio, it is a serialized schema that is wrong.
   */
  test("render: survives every chained builder", () => {
    const base = string().render({ as: "inline" });
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
      base.multiline(),
    ]) {
      expect(schema["executeSerialize"]()).toMatchObject({
        render: { as: "inline" },
      });
    }
  });

  test("render: does not mutate the schema it was called on", () => {
    const base = string();
    base.render({ as: "inline" });
    expect(base["executeSerialize"]()).toMatchObject({ render: undefined });
  });

  /**
   * `multiline` is a property of the schema, not a render variant, but it is
   * read the same way — straight off the serialized schema — so it has to
   * survive the same journeys.
   */
  test("multiline: serializes, and is absent when not declared", () => {
    expect(string().multiline()["executeSerialize"]()).toMatchObject({
      type: "string",
      multiline: true,
    });
    expect(string()["executeSerialize"]()).toMatchObject({
      multiline: undefined,
    });
  });

  test("multiline: survives every chained builder", () => {
    const base = string().multiline();
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
      base.render({ as: "inline" }),
    ]) {
      expect(schema["executeSerialize"]()).toMatchObject({ multiline: true });
    }
  });

  test("multiline: does not mutate the schema it was called on", () => {
    const base = string();
    base.multiline();
    expect(base["executeSerialize"]()).toMatchObject({ multiline: undefined });
  });

  /**
   * Round-tripping is what makes the serialized schema the source of truth: a
   * deserialized schema has no instance behind it, so anything it drops here is
   * gone for good.
   */
  test("render and multiline: round-trip through deserializeSchema", () => {
    for (const base of [
      string().render({ as: "inline" }),
      string().multiline(),
      string().multiline().render({ as: "inline" }),
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
    expect(string().multiline()["executePreview"]()).toEqual({});
  });
});
