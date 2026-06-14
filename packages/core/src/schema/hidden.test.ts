import { initVal } from "../initVal";
import { SourcePath } from "../val";
import { deserializeSchema } from "./deserialize";

const { s } = initVal();

describe("Schema.hidden()", () => {
  test("serialize: defaults to hidden false", () => {
    const serialized = s.string()["executeSerialize"]();
    expect(serialized.hidden).toBe(false);
  });

  test("serialize: hidden() sets hidden true", () => {
    const serialized = s.string().hidden()["executeSerialize"]();
    expect(serialized.hidden).toBe(true);
  });

  test("hidden is preserved regardless of chaining order", () => {
    const before = s.string().hidden().minLength(3)["executeSerialize"]();
    const after = s.string().minLength(3).hidden()["executeSerialize"]();
    expect(before.hidden).toBe(true);
    expect(after.hidden).toBe(true);
  });

  test("hidden and readonly are independent and can be combined", () => {
    const serialized = s.string().hidden().readonly()["executeSerialize"]();
    expect(serialized.hidden).toBe(true);
    expect(serialized.readonly).toBe(true);
  });

  test("hidden is preserved through nullable()", () => {
    const serialized = s.string().hidden().nullable()["executeSerialize"]();
    expect(serialized.hidden).toBe(true);
    expect(serialized.opt).toBe(true);
  });

  test("hidden survives a serialize -> deserialize -> serialize round-trip", () => {
    const schema = s.string().hidden().readonly().maxLength(10);
    const serialized = schema["executeSerialize"]();
    const roundTripped = deserializeSchema(serialized)["executeSerialize"]();
    expect(roundTripped).toEqual(serialized);
    expect(roundTripped.hidden).toBe(true);
    expect(roundTripped.readonly).toBe(true);
  });

  test("hidden serializes across schema types", () => {
    expect(s.number().hidden()["executeSerialize"]().hidden).toBe(true);
    expect(s.boolean().hidden()["executeSerialize"]().hidden).toBe(true);
    expect(s.date().hidden()["executeSerialize"]().hidden).toBe(true);
    expect(s.array(s.string()).hidden()["executeSerialize"]().hidden).toBe(
      true,
    );
    expect(
      s.object({ a: s.string() }).hidden()["executeSerialize"]().hidden,
    ).toBe(true);
    expect(s.record(s.string()).hidden()["executeSerialize"]().hidden).toBe(
      true,
    );
    expect(
      s
        .union("type", s.object({ type: s.literal("a") }))
        .hidden()
        ["executeSerialize"]().hidden,
    ).toBe(true);
  });

  test("hidden is serialized on nested object properties", () => {
    const serialized = s
      .object({
        visible: s.string(),
        secret: s.string().hidden(),
      })
      ["executeSerialize"]();
    if (serialized.type !== "object") {
      throw new Error("expected object schema");
    }
    expect(serialized.items.visible.hidden).toBe(false);
    expect(serialized.items.secret.hidden).toBe(true);
  });

  test("hidden does not change validation results", () => {
    const path = "/test" as SourcePath;
    const plain = s.string().minLength(3);
    const hidden = s.string().minLength(3).hidden();
    expect(hidden["executeValidate"](path, "ok")).toEqual(
      plain["executeValidate"](path, "ok"),
    );
    expect(hidden["executeValidate"](path, "x")).toEqual(
      plain["executeValidate"](path, "x"),
    );
  });
});
