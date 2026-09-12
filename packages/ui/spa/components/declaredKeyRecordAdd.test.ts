import { initVal } from "@valbuild/core";
import { declaredKeySetOf } from "@valbuild/core";

const { s } = initVal();

/**
 * Which records offer "add a key", and which have none left to offer.
 *
 * A record whose key schema DECLARES its keys is already complete: every
 * declared key is an entry, an unwritten one as `null`. So the only key an Add
 * box could produce there is an undeclared one — a validation error the moment
 * it is written, and never what the editor meant. `ArrayAndRecordTools` and
 * `KeyOfField` both gate their create paths on exactly this question, so it is
 * pinned here once rather than in each of them.
 *
 * The predicate is `declaredKeySetOf` — the same one the validator asks to
 * decide which records must hold every key. Two answers to one question is how
 * a Studio ends up offering a control that writes content it then reports.
 */
describe("a record whose keys are declared has no key to add", () => {
  test("a locale-keyed record declares its keys", () => {
    const schema = s.record(s.locale(), s.string())["executeSerialize"]();
    expect(schema.type).toBe("record");
    if (schema.type !== "record") throw new Error("expected a record");
    expect(declaredKeySetOf(schema.key)).toEqual({ kind: "locale" });
  });

  test("an enum-keyed record declares its keys", () => {
    const schema = s.record(s.enum("a", "b"), s.string())["executeSerialize"]();
    if (schema.type !== "record") throw new Error("expected a record");
    expect(declaredKeySetOf(schema.key)).toEqual({
      kind: "literals",
      keys: ["a", "b"],
    });
  });

  test("a literal-keyed record declares its one key", () => {
    const schema = s
      .record(s.literal("only"), s.string())
      ["executeSerialize"]();
    if (schema.type !== "record") throw new Error("expected a record");
    expect(declaredKeySetOf(schema.key)).toEqual({
      kind: "literals",
      keys: ["only"],
    });
  });

  test("an open record does not: any string is a key someone could mean", () => {
    const schema = s.record(s.string(), s.string())["executeSerialize"]();
    if (schema.type !== "record") throw new Error("expected a record");
    expect(declaredKeySetOf(schema.key)).toBeNull();
  });

  test("a record with no key schema at all does not", () => {
    const schema = s.record(s.string())["executeSerialize"]();
    if (schema.type !== "record") throw new Error("expected a record");
    expect(declaredKeySetOf(schema.key)).toBeNull();
  });
});
