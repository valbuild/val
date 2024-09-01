import { object } from "./object";
import { union } from "./union";
import { literal } from "./literal";
import { SourcePath } from "../val";

describe("UnionSchema", () => {
  test("assert: should return true for valid tagged unions", () => {
    const schema = union("type", object({ type: literal("string") }));
    expect(schema.assert("foo" as SourcePath, { type: "string" })).toEqual({
      success: true,
      data: { type: "string" },
    });
  });
  test("assert: should return true for valid string unions", () => {
    const schema = union(literal("one"), literal("two"));
    expect(schema.assert("foo" as SourcePath, "one")).toEqual({
      success: true,
      data: "one",
    });
  });
  test("assert: should return false if value is a string", () => {
    const schema = union("type", object({ type: literal("string") }));
    expect(schema.assert("foo" as SourcePath, { type: "string" })).toEqual({
      success: true,
      data: { type: "string" },
    });
  });
});
