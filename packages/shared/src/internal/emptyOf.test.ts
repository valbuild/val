import { initVal } from "@valbuild/core";
import { emptyOf } from "./emptyOf";

const { s } = initVal();

describe("emptyOf", () => {
  test("an enum starts as its first value", () => {
    expect(emptyOf(s.enum("sm", "md", "lg")["executeSerialize"]())).toBe("sm");
  });

  test("a discriminated union starts as its first variant", () => {
    const schema = s.discriminatedUnion(
      "type",
      s.object({ type: s.literal("text"), text: s.string() }),
      s.object({ type: s.literal("code"), code: s.string() }),
    );
    expect(emptyOf(schema["executeSerialize"]())).toEqual({
      type: "text",
      text: "",
    });
  });

  // `s.enum` and `s.discriminatedUnion` both require one, so an empty list is a
  // serialized schema nothing built. Returning `undefined` from here would put
  // a missing key into a patch instead of a value; the throw names the cause.
  test("an enum with no values is refused rather than answered with undefined", () => {
    expect(() => emptyOf({ type: "enum", values: [], opt: false })).toThrow(
      /enum with no values/,
    );
  });

  test("a discriminated union with no variants is refused", () => {
    expect(() =>
      emptyOf({
        type: "discriminated-union",
        key: "type",
        items: [],
        opt: false,
      }),
    ).toThrow(/no variants/);
  });
});
