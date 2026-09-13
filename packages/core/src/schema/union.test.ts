import {
  discriminatedUnion,
  DiscriminatedUnionSchema,
} from "./discriminatedUnion";
import { EnumSchema, enumSchema } from "./enum";
import { literal, LiteralSchema } from "./literal";
import { object } from "./object";
import { string } from "./string";
import { union } from "./union";

/**
 * `s.union` is deprecated but still has to work: it dispatches on its first
 * argument to whichever of the two schemas the call meant. What it must NOT do
 * is keep a serialized shape of its own — a schema written with `s.union` and
 * the same schema written with `s.enum` / `s.discriminatedUnion` have to
 * serialize identically, or the Studio has two cases to handle forever.
 */
describe("the deprecated union()", () => {
  test("a string key gives a discriminated union, serialized the same way", () => {
    const schema = union(
      "type",
      object({ type: literal("a"), value: string() }),
      object({ type: literal("b") }),
    );
    expect(schema).toBeInstanceOf(DiscriminatedUnionSchema);
    expect(schema["executeSerialize"]()).toEqual(
      discriminatedUnion(
        "type",
        object({ type: literal("a"), value: string() }),
        object({ type: literal("b") }),
      )["executeSerialize"](),
    );
  });

  test("literal schemas give an enum, with the first literal among the values", () => {
    const schema = union(literal("one"), literal("two"), literal("three"));
    expect(schema).toBeInstanceOf(EnumSchema);
    expect(schema["executeSerialize"]()).toEqual(
      enumSchema("one", "two", "three")["executeSerialize"](),
    );
  });

  test("a single literal is still an enum", () => {
    expect(union(literal("only"))["executeSerialize"]()).toMatchObject({
      type: "enum",
      values: ["only"],
    });
  });

  test("something that is neither is refused rather than half-built", () => {
    // The overloads already reject this; the throw is what happens when the
    // call comes from untyped JavaScript.
    const notALiteral = string() as unknown as LiteralSchema<string>;
    expect(() => union(notALiteral)).toThrow(/expected either a string key/);
  });
});
