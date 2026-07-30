import { initVal } from "../initVal";
import { SourcePath } from "../val";
import { deserializeSchema } from "./deserialize";

const { s } = initVal();

describe("Schema.readonly()", () => {
  test("serialize: defaults to readonly false", () => {
    const serialized = s.string()["executeSerialize"]();
    expect(serialized.readonly).toBe(false);
  });

  test("serialize: readonly() sets readonly true", () => {
    const serialized = s.string().readonly()["executeSerialize"]();
    expect(serialized.readonly).toBe(true);
  });

  test("readonly is preserved regardless of chaining order", () => {
    const before = s.string().readonly().minLength(3)["executeSerialize"]();
    const after = s.string().minLength(3).readonly()["executeSerialize"]();
    expect(before.readonly).toBe(true);
    expect(after.readonly).toBe(true);
  });

  test("readonly is preserved through nullable()", () => {
    const serialized = s.string().readonly().nullable()["executeSerialize"]();
    expect(serialized.readonly).toBe(true);
    expect(serialized.opt).toBe(true);
  });

  test("readonly survives a serialize -> deserialize -> serialize round-trip", () => {
    const schema = s.string().readonly().maxLength(10);
    const serialized = schema["executeSerialize"]();
    const roundTripped = deserializeSchema(serialized)["executeSerialize"]();
    expect(roundTripped).toEqual(serialized);
    expect(roundTripped.readonly).toBe(true);
  });

  test("readonly serializes across schema types", () => {
    expect(s.number().readonly()["executeSerialize"]().readonly).toBe(true);
    expect(s.boolean().readonly()["executeSerialize"]().readonly).toBe(true);
    expect(s.date().readonly()["executeSerialize"]().readonly).toBe(true);
    expect(s.array(s.string()).readonly()["executeSerialize"]().readonly).toBe(
      true,
    );
    expect(
      s.object({ a: s.string() }).readonly()["executeSerialize"]().readonly,
    ).toBe(true);
    expect(s.record(s.string()).readonly()["executeSerialize"]().readonly).toBe(
      true,
    );
    expect(
      s
        .union("type", s.object({ type: s.literal("a") }))
        .readonly()
        ["executeSerialize"]().readonly,
    ).toBe(true);
  });

  test("readonly is serialized on nested object properties", () => {
    const serialized = s
      .object({
        editable: s.string(),
        locked: s.string().readonly(),
      })
      ["executeSerialize"]();
    if (serialized.type !== "object") {
      throw new Error("expected object schema");
    }
    expect(serialized.items.editable.readonly).toBe(false);
    expect(serialized.items.locked.readonly).toBe(true);
  });

  test("readonly does not change validation results", () => {
    const path = "/test" as SourcePath;
    const plain = s.string().minLength(3);
    const ro = s.string().minLength(3).readonly();
    expect(ro["executeValidate"](path, "ok")).toEqual(
      plain["executeValidate"](path, "ok"),
    );
    expect(ro["executeValidate"](path, "x")).toEqual(
      plain["executeValidate"](path, "x"),
    );
  });
});
