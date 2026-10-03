import { deserializeSchema } from "./deserialize";
import { string } from "./string";
import { SourcePath } from "../val";

const path = "/test.val.ts" as SourcePath;

describe("StringSchema", () => {
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
  test("multiline: round-trips through deserializeSchema", () => {
    for (const base of [string().multiline(), string()]) {
      const serialized = base["executeSerialize"]();
      expect(deserializeSchema(serialized)["executeSerialize"]()).toStrictEqual(
        serialized,
      );
    }
  });

  /** A string has no items, so it reifies nothing for anything below it. */
  test("preview: a string with no `.preview()` reifies nothing", () => {
    expect(string().multiline()["executePreview"](path, "hello there")).toEqual(
      {},
    );
  });

  /**
   * ...but it previews ITSELF when it declares one. A leaf has no container to
   * reify it, so before self previews existed a `.preview()` here was dead.
   */
  test("preview: a string with `.preview()` previews itself", () => {
    const schema = string().preview(({ val }) => ({ title: val.slice(0, 4) }));
    expect(schema["executePreview"](path, "hello there")).toEqual({
      [path]: {
        status: "success",
        data: {
          self: { title: "hell", subtitle: undefined, image: undefined },
        },
      },
    });
  });
});
